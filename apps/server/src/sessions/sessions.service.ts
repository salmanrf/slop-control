import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type {
  InputArtifact,
  LaunchPreview,
  LaunchablePhase,
  LinkedRepo,
  NextPhaseSuggestion,
  RuntimeEvent,
  RuntimeHandle,
  RuntimeSetup,
  ScopeFlag,
  Session,
  SessionArtifact,
  SessionSetup,
  TicketSource,
} from '@slop-control/shared';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppConfig } from '../config';
import { ApiException, notFound, validationFailed } from '../common/api-exception';
import { Redactor } from '../common/redactor';
import { isUuid } from '../common/uuid';
import { LAUNCHABLE_PHASES, isLaunchablePhase } from '../phase-setups/phase-defaults';
import { PhaseSetupsService, toSessionSetup } from '../phase-setups/phase-setups.service';
import { TicketSourcesService, sourceDisconnected } from '../tickets/ticket-sources.service';
import { TicketsService } from '../tickets/tickets.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  WorktreeCreateError,
  WorktreeDirtyError,
  WorktreeManager,
} from '../worktrees/worktree-manager';
import { readArtifact } from './artifact-reader';
import { buildBrief } from './brief';
import { suggestNextPhase } from './next-phase';
import { SessionRuntime } from './runtime';
import { SessionStore, type SessionEnd } from './session-store';
import { SessionUpdates } from './session-updates';

const SHUTDOWN_GRACE_MS = 2000;
const STREAM_CLOSED_REASON = 'The runtime closed its event stream before the session ended.';
const CONTEXT_DIR = '.slop/context';
const INVALID_PHASE = 'Choose investigation, planning, implementation, or code review.';

const isActive = (session: Session) =>
  session.status === 'starting' || session.status === 'running';

/** An earlier artifact with its content, which the session record doesn't keep. */
interface GivenArtifact extends InputArtifact {
  markdown: string;
}

/** What a launch on a ticket would use. The launch and the preview both come from this. */
interface LaunchResolution {
  suggestion: NextPhaseSuggestion;
  /** Null when the developer must choose a repo. */
  repo: LinkedRepo | null;
  baseRef: string | null;
  compareRef: string | null;
  setup: SessionSetup;
  given: GivenArtifact[];
}

@Injectable()
export class SessionsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Sessions');
  private readonly handles = new Map<string, RuntimeHandle>();
  private readonly tracking = new Set<Promise<void>>();
  /** The running round of each session, settled once its end has been recorded, or the server is shutting down. */
  private readonly rounds = new Map<string, Promise<void>>();
  /** Sessions with a follow-up being accepted right now. */
  private readonly resuming = new Set<string>();
  private shuttingDown = false;

  constructor(
    private readonly store: SessionStore,
    private readonly updates: SessionUpdates,
    private readonly runtime: SessionRuntime,
    private readonly worktrees: WorktreeManager,
    private readonly workspaces: WorkspacesService,
    private readonly sources: TicketSourcesService,
    private readonly tickets: TicketsService,
    private readonly phaseSetups: PhaseSetupsService,
    private readonly redactor: Redactor,
    private readonly config: AppConfig,
  ) {}

  /** The server owns the child processes, so nothing can re-attach to one after a restart. */
  async onApplicationBootstrap(): Promise<void> {
    for (const session of await this.store.listActive()) {
      await this.terminateLeftovers(session);
      await this.finish(session, 'failed', 'server_restarted');
    }
  }

  /** After a crash an agent can outlive the server, so it must stop before its session is closed. */
  private async terminateLeftovers(session: Session): Promise<void> {
    try {
      await this.runtime.terminateLeftovers(session.worktreePath);
    } catch (error) {
      this.logger.warn(
        `Couldn't check for a leftover agent in session ${session.id}: ${this.describe(error)}`,
      );
    }
  }

  /** Leaves rows as they are, so the next boot records them as interrupted. */
  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    await Promise.allSettled([...this.handles.values()].map((handle) => handle.stop()));
    let timer: NodeJS.Timeout | undefined;
    const grace = new Promise((resolve) => (timer = setTimeout(resolve, SHUTDOWN_GRACE_MS)));
    await Promise.race([Promise.allSettled(this.tracking), grace]);
    clearTimeout(timer);
  }

  /**
   * @params workspaceId: the workspace; sourceId: the ticket's source; ticketKey: the ticket; body: the phase and optional repo
   * @return the session, or throws an ApiException listed under the start endpoint
   * Resolves the repo, phase setup, starting point, and earlier artifacts, creates the worktree, and starts the runtime without waiting for it.
   */
  async start(
    workspaceId: string,
    sourceId: string,
    ticketKey: string,
    body: unknown,
  ): Promise<Session> {
    this.refuseWhileShuttingDown();
    const source = await this.sources.get(workspaceId, sourceId);
    if (source.disconnectedAt !== null) throw sourceDisconnected(source);
    const repos = await this.workspaces.listRepos(workspaceId);
    if (repos.length === 0) {
      throw new ApiException(409, 'NO_LINKED_REPO', 'Link a repo to this workspace first.');
    }
    const { phase, linkedRepoId } = (body ?? {}) as { phase?: unknown; linkedRepoId?: unknown };
    if (!isLaunchablePhase(phase)) throw validationFailed(INVALID_PHASE);
    if (linkedRepoId !== undefined && typeof linkedRepoId !== 'string') {
      throw validationFailed('The repo must be a linked repo ID.');
    }
    await this.requireReadyRuntime();

    const resolved = await this.resolveLaunch(source, ticketKey, phase, repos, linkedRepoId);
    const { repo, baseRef } = resolved;
    if (!repo || !baseRef) {
      throw new ApiException(
        409,
        'REPO_CHOICE_REQUIRED',
        'Choose the repo this session should run in.',
      );
    }
    const ticket = await this.tickets.read(source, ticketKey);

    const id = randomUUID();
    const worktree = await this.createWorktree({
      repoPath: repo.localPath,
      baseRef,
      workspaceId,
      ticketKey,
      sessionId: id,
    });
    const inputArtifacts = resolved.given.map(toInputArtifact);
    try {
      await writeContextFiles(worktree.path, resolved.given);
    } catch (error) {
      await this.worktrees.remove(repo.localPath, worktree.path, true).catch(() => undefined);
      throw error;
    }

    const session = await this.store.insert({
      id,
      workspaceId,
      linkedRepoId: repo.id,
      ticketSourceId: source.id,
      ticketKey,
      ticketTitle: this.redactor.redact(ticket.title),
      phase,
      brief: this.redactor.redact(
        buildBrief({
          ticket,
          setup: resolved.setup,
          inputArtifacts,
          review: resolved.compareRef ? { branch: baseRef, compareRef: resolved.compareRef } : null,
        }),
      ),
      setup: resolved.setup,
      worktreePath: worktree.path,
      branch: worktree.branch,
      baseRef,
      baseCommit: worktree.baseCommit,
      inputArtifacts,
    });
    this.updates.publish(session);
    this.launch(session, (setup) =>
      this.runtime.start({ brief: session.brief, cwd: session.worktreePath, setup }),
    );
    return session;
  }

  /**
   * @params workspaceId: the workspace; sourceId: the ticket's source; ticketKey: the ticket; phase: the phase to preview, if chosen; linkedRepoId: the repo to preview, if chosen
   * @return what a launch would use, with a null repo if the developer must choose
   * Applies the same resolution as `start` without creating anything.
   */
  async launchPreview(
    workspaceId: string,
    sourceId: string,
    ticketKey: string,
    phase?: unknown,
    linkedRepoId?: string,
  ): Promise<LaunchPreview> {
    const source = await this.sources.get(workspaceId, sourceId);
    if (source.disconnectedAt !== null) throw sourceDisconnected(source);
    if (phase !== undefined && !isLaunchablePhase(phase)) throw validationFailed(INVALID_PHASE);
    const repos = await this.workspaces.listRepos(workspaceId);

    const resolved = await this.resolveLaunch(source, ticketKey, phase, repos, linkedRepoId);
    return {
      suggestion: resolved.suggestion,
      phase: phase ?? resolved.suggestion.phase ?? 'investigation',
      linkedRepoId: resolved.repo?.id ?? null,
      baseRef: resolved.baseRef,
      compareRef: resolved.compareRef,
      setup: resolved.setup,
      inputArtifacts: resolved.given.map(toInputArtifact),
    };
  }

  /**
   * @params workspaceId: the workspace; sessionId: a session that has ended; body: the follow-up message
   * @return the session as `running` in its next round, or throws an ApiException listed under the messages endpoint
   * Restores the worktree if it was removed, then resumes the session with its stored setup, without waiting for it.
   */
  async sendMessage(workspaceId: string, sessionId: string, body: unknown): Promise<Session> {
    this.refuseWhileShuttingDown();
    const session = await this.get(workspaceId, sessionId);
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message !== 'string' || message.trim().length === 0) {
      throw validationFailed('A follow-up needs a message.');
    }
    const active = new ApiException(
      409,
      'SESSION_ACTIVE',
      'This session is still running. Wait for it to end, or stop it, before sending a follow-up.',
    );
    if (isActive(session)) throw active;
    const runtimeSessionId = session.runtimeSessionId;
    if (!runtimeSessionId) {
      throw new ApiException(
        409,
        'SESSION_NOT_RESUMABLE',
        "Claude Code never started this session, so there's nothing to resume. Start a new session instead.",
      );
    }
    // One process owns every session, so this is enough to keep two follow-ups from restoring
    // the same worktree at once. The round itself is still claimed in one database statement.
    if (this.resuming.has(sessionId)) throw active;
    this.resuming.add(sessionId);
    try {
      // Checked before anything changes, so a host that isn't ready leaves the session as it was.
      await this.requireReadyRuntime();
      if (session.worktreeRemovedAt) await this.restoreWorktree(session);

      const resumed = await this.store.beginRound(workspaceId, sessionId);
      if (!resumed) throw active;
      this.updates.publish(resumed);
      this.launch(resumed, (setup) =>
        this.runtime.resume({ runtimeSessionId, message, cwd: resumed.worktreePath, setup }),
      );
      return resumed;
    } finally {
      this.resuming.delete(sessionId);
    }
  }

  async get(workspaceId: string, sessionId: string): Promise<Session> {
    if (!isUuid(workspaceId) || !isUuid(sessionId)) throw notFound('Session not found.');
    const session = await this.store.find(workspaceId, sessionId);
    if (!session) throw notFound('Session not found.');
    return session;
  }

  /** Works on a disconnected source too, so its history stays reachable. */
  async listForTicket(
    workspaceId: string,
    sourceId: string,
    ticketKey: string,
  ): Promise<Session[]> {
    await this.sources.get(workspaceId, sourceId);
    return this.store.listForTicket(workspaceId, sourceId, ticketKey);
  }

  /** The latest stored copy, so an earlier round's result stays readable while a new round runs. */
  async artifact(workspaceId: string, sessionId: string): Promise<SessionArtifact> {
    await this.get(workspaceId, sessionId);
    const artifact = await this.store.latestArtifact(sessionId);
    if (!artifact) throw notFound('This session has no stored artifact.');
    return artifact;
  }

  /**
   * @params workspaceId: the workspace; sessionId: the session to stop
   * @return the session once its round has ended, or as it is after the grace period; throws NOT_FOUND if it isn't in this workspace
   * Tells the runtime to stop an active session and waits for the round to be recorded as ended. Does nothing to a session that has already ended.
   */
  async stop(workspaceId: string, sessionId: string): Promise<Session> {
    const session = await this.get(workspaceId, sessionId);
    if (!isActive(session)) return session;

    // Taken before stopping, so a follow-up accepted meanwhile can't put its round here instead.
    const round = this.rounds.get(sessionId);
    const stopped = (async () => {
      await this.handles.get(sessionId)?.stop();
      await round;
    })();
    // A process that is slow to end must not hold the request open.
    let timer: NodeJS.Timeout | undefined;
    const grace = new Promise((resolve) => (timer = setTimeout(resolve, this.config.stopGraceMs)));
    try {
      await Promise.race([stopped, grace]);
    } finally {
      clearTimeout(timer);
      // Still running after the grace period; a late failure to stop must not go unhandled.
      stopped.catch(() => undefined);
    }
    return this.get(workspaceId, sessionId);
  }

  async removeWorktree(workspaceId: string, sessionId: string, force: boolean): Promise<Session> {
    const session = await this.get(workspaceId, sessionId);
    if (session.worktreeRemovedAt) return session;
    if (isActive(session)) {
      throw new ApiException(
        409,
        'SESSION_ACTIVE',
        'Stop the session before removing its worktree.',
      );
    }

    const repo = await this.workspaces.getRepo(workspaceId, session.linkedRepoId);
    try {
      await this.worktrees.remove(repo.localPath, session.worktreePath, force);
    } catch (error) {
      if (error instanceof WorktreeDirtyError) {
        throw new ApiException(409, 'WORKTREE_DIRTY', error.message);
      }
      throw error;
    }
    const updated = await this.store.markWorktreeRemoved(sessionId);
    this.updates.publish(updated);
    return updated;
  }

  private refuseWhileShuttingDown(): void {
    if (this.shuttingDown) {
      throw new ApiException(503, 'RUNTIME_NOT_READY', 'The server is shutting down.');
    }
  }

  private async requireReadyRuntime(): Promise<void> {
    const readiness = await this.runtime.checkReady();
    if (!readiness.ready) {
      throw new ApiException(503, 'RUNTIME_NOT_READY', this.redactor.redact(readiness.message));
    }
  }

  /** Resolves everything a launch needs that doesn't depend on reading the ticket. Creates nothing. */
  private async resolveLaunch(
    source: TicketSource,
    ticketKey: string,
    requestedPhase: LaunchablePhase | undefined,
    repos: LinkedRepo[],
    linkedRepoId: string | undefined,
  ): Promise<LaunchResolution> {
    const workspaceId = source.workspaceId;
    const sessions = await this.store.listForTicket(workspaceId, source.id, ticketKey);
    const suggestion = suggestNextPhase(sessions);
    const phase = requestedPhase ?? suggestion.phase ?? 'investigation';

    const repo = linkedRepoId
      ? await this.workspaces.getRepo(workspaceId, linkedRepoId)
      : preselectRepo(source, sessions, repos);
    const setup = toSessionSetup(await this.phaseSetups.get(workspaceId, phase));

    // Without this a review would start from the default branch and see none of the code.
    const implementation =
      phase === 'code_review' && repo
        ? sessions.find(
            (session) => session.phase === 'implementation' && session.linkedRepoId === repo.id,
          )
        : undefined;

    const results = await this.store.latestCompleteResults(workspaceId, source.id, ticketKey);
    const given = LAUNCHABLE_PHASES.filter((other) => other !== phase).flatMap((other) => {
      const result = results.find((item) => item.phase === other);
      return result
        ? [
            {
              sessionId: result.sessionId,
              round: result.round,
              phase: other,
              path: `${CONTEXT_DIR}/${other}.md`,
              markdown: result.markdown,
            },
          ]
        : [];
    });

    return {
      suggestion,
      repo,
      baseRef: repo ? (implementation?.branch ?? `origin/${repo.defaultBranch}`) : null,
      compareRef: implementation?.baseRef ?? null,
      setup,
      given,
    };
  }

  private async createWorktree(input: Parameters<WorktreeManager['create']>[0]) {
    try {
      return await this.worktrees.create(input);
    } catch (error) {
      if (error instanceof WorktreeCreateError) {
        throw new ApiException(500, 'WORKTREE_CREATE_FAILED', this.redactor.redact(error.message));
      }
      throw error;
    }
  }

  /** Brings back the worktree with the files git doesn't hold: the artifact and the context files. */
  private async restoreWorktree(session: Session): Promise<void> {
    const repo = await this.workspaces.getRepo(session.workspaceId, session.linkedRepoId);
    try {
      await this.worktrees.restore(repo.localPath, session.worktreePath, session.branch);
    } catch (error) {
      if (error instanceof WorktreeCreateError) {
        throw new ApiException(500, 'WORKTREE_CREATE_FAILED', this.redactor.redact(error.message));
      }
      throw error;
    }

    const artifact = await this.store.latestArtifact(session.id);
    if (artifact) await writeUnder(session.worktreePath, artifact.path, artifact.markdown);
    // The round the session was given, even if its source session has stored a newer one since.
    for (const input of session.inputArtifacts) {
      const given = await this.store.artifactOfRound(input.sessionId, input.round);
      if (given) await writeUnder(session.worktreePath, input.path, given.markdown);
    }
  }

  /** Runs one round without waiting for it; every outcome reaches the session's record. */
  private launch(session: Session, open: (setup: RuntimeSetup) => RuntimeHandle): void {
    const tracked = this.run(session, open)
      .catch((error: unknown) => {
        this.logger.error(`Lost track of session ${session.id}: ${this.describe(error)}`);
      })
      .finally(() => {
        this.tracking.delete(tracked);
        // A later round of the same session may already hold this slot.
        if (this.rounds.get(session.id) === tracked) this.rounds.delete(session.id);
      });
    this.tracking.add(tracked);
    this.rounds.set(session.id, tracked);
  }

  private async run(session: Session, open: (setup: RuntimeSetup) => RuntimeHandle): Promise<void> {
    let ended = false;
    let handle: RuntimeHandle | undefined;
    try {
      // Always the session's own snapshot, so a later round can't gain scope from an edited setup.
      handle = open({
        permissionMode: 'auto',
        scope: session.setup.scope,
        userLevelSource: session.setup.userLevelSource,
      });
      this.handles.set(session.id, handle);

      for await (const event of handle.events) {
        if (this.shuttingDown) return;
        await this.apply(session, event);
        if (event.type === 'session_ended') ended = true;
      }
    } catch (error) {
      if (this.shuttingDown) return;
      await this.finish(session, 'failed', this.describe(error));
      return;
    } finally {
      // A later round of the same session may already hold this slot.
      if (this.handles.get(session.id) === handle) this.handles.delete(session.id);
    }
    if (!ended && !this.shuttingDown) await this.finish(session, 'failed', STREAM_CLOSED_REASON);
  }

  private async apply(session: Session, event: RuntimeEvent): Promise<void> {
    if (event.type === 'session_started') {
      const running = await this.store.markRunning(
        session.id,
        event.runtimeSessionId,
        event.transcriptPath,
      );
      if (running) this.updates.publish(running);
      return;
    }
    if (event.outcome === 'success') await this.finish(session, 'ended', null);
    else if (event.outcome === 'stopped') await this.finish(session, 'stopped', null);
    else await this.finish(session, 'failed', event.message ?? 'The runtime reported an error.');
  }

  /** Stores the artifact first, then the final status and any scope flag, and publishes last. */
  private async finish(
    session: Session,
    status: SessionEnd['status'],
    reason: string | null,
  ): Promise<void> {
    const redactedReason = reason === null ? null : this.redactor.redact(reason);
    if (status === 'failed') this.logger.warn(`Session ${session.id} failed: ${redactedReason}`);

    const produced = await this.storeNewArtifact(session);
    const updated = await this.store.markEnded(session.id, session.round, {
      status,
      reason: redactedReason,
      artifactStatus: produced ? 'complete' : 'incomplete',
      scopeFlags: await this.scopeFlags(session),
    });
    if (updated) this.updates.publish(updated);
  }

  /**
   * The artifact counts for this round only if its content differs from the previous stored copy.
   * Content is compared rather than file times, because a restored file would look new.
   */
  private async storeNewArtifact(session: Session): Promise<boolean> {
    const path = session.setup.stopCondition.requiredArtifactPath;
    if (!path) return false;
    const raw = await readArtifact(session.worktreePath, path);
    if (raw === null) return false;
    // Stored copies are shown in the dashboard and handed to later sessions (NFR-4).
    const markdown = this.redactor.redact(raw);
    const previous = await this.store.latestArtifact(session.id);
    if (previous && previous.round < session.round && previous.markdown === markdown) return false;
    await this.store.saveArtifact(session.id, session.round, path, markdown);
    return true;
  }

  /** Flags a read-only phase that changed code. Sessions with no starting commit are never checked. */
  private async scopeFlags(session: Session): Promise<ScopeFlag[]> {
    if (session.setup.scope.mayChangeCode || !session.baseCommit) return [];
    try {
      const changed = await this.worktrees.hasCodeChanges(session.worktreePath, session.baseCommit);
      return changed ? ['code_changed'] : [];
    } catch (error) {
      this.logger.warn(
        `Couldn't check session ${session.id} for code changes: ${this.describe(error)}`,
      );
      return [];
    }
  }

  private describe(error: unknown): string {
    return this.redactor.redact(error instanceof Error ? error.message : String(error));
  }
}

/** The preselection order of FR-11a: last used, the source's default, a matching clone, the only repo. */
function preselectRepo(
  source: TicketSource,
  sessions: Session[],
  repos: LinkedRepo[],
): LinkedRepo | null {
  const byId = (id: string | null | undefined) => repos.find((repo) => repo.id === id) ?? null;
  const lastUsed = byId(sessions[0]?.linkedRepoId);
  if (lastUsed) return lastUsed;
  const sourceDefault = byId(source.defaultLinkedRepoId);
  if (sourceDefault) return sourceDefault;
  if (source.scope && 'githubOwner' in source.scope) {
    const { githubOwner, githubRepo } = source.scope;
    // `repos` is oldest first, so several clones of one repo resolve to the oldest.
    const sameRepo = repos.find(
      (repo) =>
        repo.githubOwner.toLowerCase() === githubOwner.toLowerCase() &&
        repo.githubRepo.toLowerCase() === githubRepo.toLowerCase(),
    );
    if (sameRepo) return sameRepo;
  }
  return repos.length === 1 ? repos[0]! : null;
}

function toInputArtifact({ sessionId, round, phase, path }: GivenArtifact): InputArtifact {
  return { sessionId, round, phase, path };
}

/** `/.slop/` is excluded from git, so these never show in a diff or a commit. */
async function writeContextFiles(worktreePath: string, given: GivenArtifact[]): Promise<void> {
  for (const artifact of given) await writeUnder(worktreePath, artifact.path, artifact.markdown);
}

async function writeUnder(worktreePath: string, relativePath: string, content: string) {
  const target = join(worktreePath, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}
