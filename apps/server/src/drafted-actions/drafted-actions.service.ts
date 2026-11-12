import {
  HttpException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type {
  BranchState,
  DraftedAction,
  DraftedActionDetail,
  DraftedActionStatus,
  DraftedActionType,
  LinkedRepo,
  OpenPrPayload,
  Session,
  TicketTransition,
} from '@slop-control/shared';
import { ApiException, notFound, validationFailed } from '../common/api-exception';
import { Redactor } from '../common/redactor';
import { CredentialsService, credentialNotSet } from '../credentials/credentials.service';
import { RepoHost, RepoHostAuthError } from '../repo-host/repo-host';
import { SessionStore } from '../sessions/session-store';
import { SessionUpdates } from '../sessions/session-updates';
import { TicketSourcesService } from '../tickets/ticket-sources.service';
import { TrackerAuthError } from '../tickets/tracker';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { BranchNotFoundError, WorktreeManager } from '../worktrees/worktree-manager';
import { DraftedActionStore } from './drafted-action-store';
import { IN_REVIEW, applyEdit, draftOpenPr, draftTicketComment } from './drafts';

const STATUSES: DraftedActionStatus[] = [
  'pending',
  'rejected',
  'dispatching',
  'succeeded',
  'failed',
];
const WAITING: DraftedActionStatus[] = ['pending', 'failed'];

const isActive = (session: Session) =>
  session.status === 'starting' || session.status === 'running';

/**
 * Drafts the outward-facing actions that follow from a session's round, and dispatches one only
 * when the developer approves it (FR-27 to FR-30). Dispatch runs here, in the server process,
 * outside any session and never through the session runtime.
 */
@Injectable()
export class DraftedActionsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('DraftedActions');
  private shuttingDown = false;

  constructor(
    private readonly store: DraftedActionStore,
    private readonly sessions: SessionStore,
    private readonly updates: SessionUpdates,
    private readonly worktrees: WorktreeManager,
    private readonly workspaces: WorkspacesService,
    private readonly sources: TicketSourcesService,
    private readonly credentials: CredentialsService,
    private readonly host: RepoHost,
    private readonly redactor: Redactor,
  ) {}

  /** Nothing can re-attach to a dispatch after a restart, so it's recorded as failed, to be checked by hand. */
  async onApplicationBootstrap(): Promise<void> {
    const interrupted = await this.store.failInterrupted();
    if (interrupted > 0) {
      this.logger.warn(
        `${interrupted} drafted action(s) were mid-dispatch when the server stopped.`,
      );
    }
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
  }

  /**
   * @params session: a session whose round has just reached a terminal status, after its artifact check
   * @return the actions drafted or redrafted, which may be none
   * Applies the drafting rules for the session's phase. Never throws: a failure to draft is logged and drafts nothing.
   */
  async draftForRound(session: Session): Promise<DraftedAction[]> {
    // A failed or stopped round, or one without its artifact, drafts nothing.
    if (session.status !== 'ended' || session.artifactStatus !== 'complete') return [];
    try {
      const drafted =
        session.phase === 'implementation'
          ? await this.openPrDraft(session)
          : session.phase === 'code_review'
            ? await this.ticketCommentDraft(session)
            : null;
      return drafted ? [drafted] : [];
    } catch (error) {
      this.logger.warn(`Couldn't draft for session ${session.id}: ${this.describe(error)}`);
      return [];
    }
  }

  /**
   * @params workspaceId: the workspace; statuses: the statuses to include, `pending` and `failed` if omitted
   * @return the workspace's matching actions, newest first
   * Lists actions for the approvals inbox.
   */
  async list(workspaceId: string, statuses?: unknown): Promise<DraftedAction[]> {
    await this.workspaces.get(workspaceId);
    return this.store.list(workspaceId, parseStatuses(statuses));
  }

  /**
   * @params workspaceId: the workspace; sessionId: one of its sessions
   * @return every action of the session, oldest first, or throws NOT_FOUND
   * Lists a session's actions for its page.
   */
  async listForSession(workspaceId: string, sessionId: string): Promise<DraftedAction[]> {
    await this.session(workspaceId, sessionId);
    return this.store.listForSession(workspaceId, sessionId);
  }

  /**
   * @params workspaceId: the workspace; actionId: one of its actions
   * @return the action, with its branch's current state or its ticket's possible moves, or throws NOT_FOUND
   * Reads an action with what the developer needs to decide on it.
   */
  async get(workspaceId: string, actionId: string): Promise<DraftedActionDetail> {
    const action = await this.find(workspaceId, actionId);
    return {
      action,
      branch: action.type === 'open_pr' ? await this.branchState(action) : null,
      transitions: action.type === 'ticket_transition' ? await this.transitions(action) : null,
    };
  }

  /**
   * @params workspaceId: the workspace; actionId: an action that is pending or failed; body: the fields to change
   * @return the edited action, or throws an ApiException listed under the PATCH endpoint
   * Changes the editable fields of an action's payload and marks it edited.
   */
  async update(workspaceId: string, actionId: string, body: unknown): Promise<DraftedAction> {
    const action = await this.find(workspaceId, actionId);
    if (!WAITING.includes(action.status)) throw alreadyDecided(action);
    const payload = this.redacted(applyEdit(action.type, action.payload, body));
    const edited = await this.store.edit(action.id, payload);
    if (!edited) throw alreadyDecided(action);
    this.updates.publishAction(edited);
    return edited;
  }

  /**
   * @params workspaceId: the workspace; actionId: an action that is pending or failed; body: the head commit shown, for an open PR
   * @return the action as succeeded or failed, or throws an ApiException listed under the approve endpoint
   * Claims the action, dispatches it outside any session, and records the result or the redacted error. Drafts what follows from a success.
   */
  async approve(workspaceId: string, actionId: string, body: unknown): Promise<DraftedAction> {
    const action = await this.find(workspaceId, actionId);
    if (this.shuttingDown) {
      throw new ApiException(503, 'RUNTIME_NOT_READY', 'The server is shutting down.');
    }
    if (!WAITING.includes(action.status)) throw alreadyDecided(action);

    // An open PR's refusals come before the claim, so they leave the action as it was. A ticket
    // action has none: what stops it, such as a disconnected source, is recorded as a failed dispatch.
    const openPr = action.type === 'open_pr' ? await this.prepareOpenPr(action, body) : null;

    const claimed = await this.store.claim(action.id);
    if (!claimed) throw alreadyDecided(action);
    this.updates.publishAction(claimed);

    let finished: DraftedAction | null;
    try {
      // What's dispatched is the payload stored at the claim, not one read before a late edit.
      const outcome =
        openPr && claimed.type === 'open_pr'
          ? await openPr(claimed.payload)
          : await this.dispatchToTicket(claimed);
      finished = await this.store.markSucceeded(action.id, outcome);
    } catch (error) {
      const reason = this.describe(error);
      this.logger.warn(`Dispatching drafted action ${action.id} failed: ${reason}`);
      finished = await this.store.markFailed(action.id, reason);
    }
    // Only a restart's cleanup can have taken the action meanwhile, and it has recorded it.
    const result = finished ?? (await this.find(workspaceId, actionId));
    this.updates.publishAction(result);
    if (result.status === 'succeeded' && result.type === 'open_pr') {
      await this.draftTransition(result);
    }
    return result;
  }

  /**
   * @params workspaceId: the workspace; actionId: an action that is pending or failed
   * @return the action as rejected, or throws NOT_FOUND or ACTION_ALREADY_DECIDED
   * Rejects an action. It is never dispatched afterwards.
   */
  async reject(workspaceId: string, actionId: string): Promise<DraftedAction> {
    const action = await this.find(workspaceId, actionId);
    const rejected = await this.store.reject(action.id);
    if (!rejected) throw alreadyDecided(action);
    this.updates.publishAction(rejected);
    return rejected;
  }

  private async find(workspaceId: string, actionId: string): Promise<DraftedAction> {
    const action = await this.store.find(workspaceId, actionId);
    if (!action) throw notFound('Drafted action not found.');
    return action;
  }

  private async session(workspaceId: string, sessionId: string): Promise<Session> {
    const session = await this.sessions.findScoped(workspaceId, sessionId);
    if (!session) throw notFound('Session not found.');
    return session;
  }

  /** An open PR is drafted only for a branch that holds commits, and only until one has been opened. */
  private async openPrDraft(session: Session): Promise<DraftedAction | null> {
    if (await this.store.hasSucceeded(session.id, 'open_pr')) return null;
    const repo = await this.workspaces.getRepo(session.workspaceId, session.linkedRepoId);
    const branch = await this.branchOf(session, repo);
    if (branch.commitCount === 0) return null;

    const report = await this.sessions.latestArtifact(session.id);
    if (!report) return null;
    const source = await this.sources.get(session.workspaceId, session.ticketSourceId);
    return this.draft(session, 'open_pr', draftOpenPr(session, report.markdown, source, repo));
  }

  private async ticketCommentDraft(session: Session): Promise<DraftedAction | null> {
    const report = await this.sessions.latestArtifact(session.id);
    if (!report) return null;
    return this.draft(session, 'ticket_comment', draftTicketComment(report.markdown));
  }

  /** Drafted only where the ticket's tracker has an *In review* status the ticket can move to. Never throws. */
  private async draftTransition(opened: DraftedAction): Promise<void> {
    try {
      const session = await this.session(opened.workspaceId, opened.sessionId);
      const target = (await this.readTransitions(opened)).find(
        (transition) => transition.status.trim().toLowerCase() === IN_REVIEW,
      );
      if (target) await this.draft(session, 'ticket_transition', { toStatus: target.status });
    } catch (error) {
      this.logger.warn(
        `Couldn't draft a status change after action ${opened.id}: ${this.describe(error)}`,
      );
    }
  }

  /**
   * A session has at most one action of each type waiting. A later round replaces a pending draft
   * the developer never edited, and leaves alone one they did, one that failed, or one being dispatched.
   */
  private async draft(
    session: Session,
    type: DraftedActionType,
    draft: object,
  ): Promise<DraftedAction | null> {
    const payload = this.redacted(draft);
    const waiting = await this.store.findOpen(session.id, type);
    const saved = waiting
      ? waiting.edited || waiting.status !== 'pending'
        ? null
        : await this.store.redraft(waiting.id, payload, session.round)
      : await this.store.insert({
          sessionId: session.id,
          workspaceId: session.workspaceId,
          ticketSourceId: session.ticketSourceId,
          ticketKey: session.ticketKey,
          round: session.round,
          type,
          payload,
        });
    if (saved) this.updates.publishAction(saved);
    return saved;
  }

  /**
   * Checks everything an open PR approval can be refused for, and returns the dispatch.
   * The push names the commit the developer was shown, so the check and the push can't disagree.
   */
  private async prepareOpenPr(
    action: DraftedAction & { type: 'open_pr' },
    body: unknown,
  ): Promise<(payload: OpenPrPayload) => Promise<object>> {
    const expected = (body as { expectedHeadCommit?: unknown } | null)?.expectedHeadCommit;
    if (typeof expected !== 'string' || expected.trim().length === 0) {
      throw validationFailed('Approving a pull request needs the head commit you were shown.');
    }
    const workspaceId = action.workspaceId;
    // A credential that can't be opened is as good as none, and is fixed the same way.
    const token = await this.credentials.token(workspaceId).catch((error: unknown) => {
      if (error instanceof ApiException && error.getStatus() === 503) return null;
      throw error;
    });
    if (token === null) {
      throw credentialNotSet(
        'This workspace has no GitHub credential it can use. Add one to push the branch and open the pull request.',
      );
    }
    const session = await this.session(workspaceId, action.sessionId);
    if (isActive(session)) {
      throw new ApiException(
        409,
        'SESSION_ACTIVE',
        'This session is still running. Wait for it to end, or stop it, before approving.',
      );
    }
    const repo = await this.workspaces.getRepo(workspaceId, session.linkedRepoId);
    const stale = new ApiException(
      409,
      'ACTION_STALE',
      'The branch has moved since you looked. Read the changes again before approving.',
    );
    let head: string;
    try {
      head = (await this.branchOf(session, repo)).headCommit;
    } catch (error) {
      if (error instanceof BranchNotFoundError) throw stale;
      throw error;
    }
    if (head !== expected.trim()) throw stale;

    const target = { owner: repo.githubOwner, repo: repo.githubRepo };
    return async ({ title, body: text, baseBranch, headBranch }) => {
      try {
        // Run in the linked clone, so it works when the worktree is gone. Uncommitted work is
        // never part of it, and nothing here commits.
        await this.host.pushBranch({
          repoPath: repo.localPath,
          target,
          branch: headBranch,
          commit: head,
          token,
        });
        let pull;
        try {
          pull = await this.host.openPullRequest({
            target,
            headBranch,
            baseBranch,
            title,
            body: text,
            token,
          });
        } catch (error) {
          if (error instanceof Error) {
            error.message = `The branch ${headBranch} was pushed, but the pull request wasn't opened: ${error.message} Approve again to finish.`;
          }
          throw error;
        }
        await this.credentials.recordUse(workspaceId, 'ok', null);
        return { number: pull.number, url: pull.url, commit: head };
      } catch (error) {
        if (error instanceof RepoHostAuthError) {
          await this.credentials.recordUse(workspaceId, 'auth_failed', error.message);
        }
        throw error;
      }
    };
  }

  /** Comments and status changes go to the ticket's own source, with that source's credential. */
  private async dispatchToTicket(action: DraftedAction): Promise<object> {
    const source = await this.sources.get(action.workspaceId, action.ticketSourceId);
    // Throws for a disconnected source, before anything reaches the tracker.
    const adapter = await this.sources.adapterFor(source);
    if (source.type !== 'built_in' && !source.credential.isSet) {
      throw new Error(
        `${source.label} has no credential, so nothing can be written to its tickets. Add one on the Sources page.`,
      );
    }
    try {
      if (action.type === 'ticket_comment') {
        const { url } = await adapter.addComment(action.ticketKey, action.payload.body);
        await this.sources.recordCredentialUse(source.id, 'ok', null);
        return { url };
      }
      if (action.type === 'ticket_transition') {
        const ticket = await adapter.transition(action.ticketKey, action.payload.toStatus);
        await this.sources.recordCredentialUse(source.id, 'ok', null);
        return { status: ticket.status };
      }
      throw new Error(`A ${action.type} action isn't dispatched to a ticket.`);
    } catch (error) {
      if (error instanceof TrackerAuthError) {
        await this.sources.recordCredentialUse(source.id, 'auth_failed', error.message);
      }
      throw error;
    }
  }

  private async branchState(
    action: DraftedAction & { type: 'open_pr' },
  ): Promise<BranchState | null> {
    try {
      const session = await this.session(action.workspaceId, action.sessionId);
      const repo = await this.workspaces.getRepo(action.workspaceId, session.linkedRepoId);
      const branch = await this.branchOf(session, repo);
      return {
        ...branch,
        uncommitted: session.worktreeRemovedAt
          ? null
          : await this.worktrees.uncommitted(session.worktreePath),
      };
    } catch (error) {
      if (error instanceof BranchNotFoundError) return null;
      throw error;
    }
  }

  private async branchOf(
    session: Session,
    repo: LinkedRepo,
  ): Promise<{ headCommit: string; commitCount: number }> {
    const baseCommit =
      session.baseCommit ??
      (await this.worktrees.mergeBase(repo.localPath, session.baseRef, session.branch));
    return this.worktrees.branchState(repo.localPath, session.branch, baseCommit);
  }

  /** Null when the source can't be read, e.g. when it's disconnected. */
  private async transitions(action: DraftedAction): Promise<TicketTransition[] | null> {
    try {
      return await this.readTransitions(action);
    } catch {
      return null;
    }
  }

  private async readTransitions(action: DraftedAction): Promise<TicketTransition[]> {
    const source = await this.sources.get(action.workspaceId, action.ticketSourceId);
    const adapter = await this.sources.adapterFor(source);
    return adapter.listTransitions(action.ticketKey);
  }

  /** Nothing in a drafted action holds a credential (NFR-4). */
  private redacted<T extends object>(payload: T): T {
    return Object.fromEntries(
      Object.entries(payload).map(([field, value]) => [
        field,
        typeof value === 'string' ? this.redactor.redact(value) : value,
      ]),
    ) as T;
  }

  /** What went wrong, as the developer should read it on the action. */
  private describe(error: unknown): string {
    let message = error instanceof Error ? error.message : String(error);
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'object' && response !== null && 'message' in response) {
        message = String((response as { message: unknown }).message);
      }
    }
    return this.redactor.redact(message);
  }
}

function alreadyDecided(action: DraftedAction): ApiException {
  return new ApiException(
    409,
    'ACTION_ALREADY_DECIDED',
    `This action is ${action.status}, so it can't be changed, approved, or rejected.`,
  );
}

function parseStatuses(raw: unknown): DraftedActionStatus[] {
  if (raw === undefined) return WAITING;
  const values = Array.isArray(raw) ? raw : [raw];
  for (const value of values) {
    if (!STATUSES.includes(value as DraftedActionStatus)) {
      throw validationFailed(`Choose statuses from: ${STATUSES.join(', ')}.`);
    }
  }
  return values as DraftedActionStatus[];
}
