import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { RuntimeEvent, RuntimeHandle, Session, SessionArtifact } from '@slop-control/shared';
import { randomUUID } from 'node:crypto';
import { ApiException, notFound, validationFailed } from '../common/api-exception';
import { Redactor } from '../common/redactor';
import { repoForKey, TicketsService } from '../tickets/tickets.service';
import { WorkspacesService, isUuid } from '../workspaces/workspaces.service';
import {
  WorktreeCreateError,
  WorktreeDirtyError,
  WorktreeManager,
} from '../worktrees/worktree-manager';
import { readArtifact } from './artifact-reader';
import { buildBrief, isLaunchablePhase, requiredArtifactPath } from './phases';
import { SessionRuntime } from './runtime';
import { SessionStore, type SessionEnd } from './session-store';
import { SessionUpdates } from './session-updates';

const FIRST_ROUND = 1;
const SHUTDOWN_GRACE_MS = 2000;
const STREAM_CLOSED_REASON = 'The runtime closed its event stream before the session ended.';

const isActive = (session: Session) => session.status === 'starting' || session.status === 'running';

@Injectable()
export class SessionsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Sessions');
  private readonly handles = new Map<string, RuntimeHandle>();
  private readonly tracking = new Set<Promise<void>>();
  private shuttingDown = false;

  constructor(
    private readonly store: SessionStore,
    private readonly updates: SessionUpdates,
    private readonly runtime: SessionRuntime,
    private readonly worktrees: WorktreeManager,
    private readonly workspaces: WorkspacesService,
    private readonly tickets: TicketsService,
    private readonly redactor: Redactor,
  ) {}

  /** The server owns the child processes, so it assumes they didn't survive a restart. */
  async onApplicationBootstrap(): Promise<void> {
    for (const session of await this.store.listActive()) {
      await this.finish(session, 'failed', 'server_restarted');
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

  async start(workspaceId: string, ticketKey: string, phase: unknown): Promise<Session> {
    await this.workspaces.get(workspaceId);
    const repos = await this.workspaces.listRepos(workspaceId);
    if (repos.length === 0) {
      throw new ApiException(409, 'NO_LINKED_REPO', 'Link a repo to this workspace first.');
    }
    if (!isLaunchablePhase(phase)) {
      throw validationFailed('Choose investigation, planning, implementation, or code review.');
    }
    const readiness = await this.runtime.checkReady();
    if (!readiness.ready) throw new ApiException(503, 'RUNTIME_NOT_READY', readiness.message);

    const repo = repoForKey(repos, ticketKey);
    if (!repo) throw notFound(`No linked repo holds ticket ${ticketKey}.`);
    const ticket = await this.tickets.read(repo, ticketKey);

    const id = randomUUID();
    const worktree = await this.createWorktree({
      repoPath: repo.localPath,
      baseRef: `origin/${repo.defaultBranch}`,
      workspaceId,
      ticketKey,
      sessionId: id,
    });

    const session = await this.store.insert({
      id,
      workspaceId,
      linkedRepoId: repo.id,
      ticketKey,
      phase,
      brief: buildBrief(ticket, phase),
      worktreePath: worktree.path,
      branch: worktree.branch,
    });
    this.updates.publish(session);
    this.launch(session);
    return session;
  }

  async get(workspaceId: string, sessionId: string): Promise<Session> {
    if (!isUuid(workspaceId) || !isUuid(sessionId)) throw notFound('Session not found.');
    const session = await this.store.find(workspaceId, sessionId);
    if (!session) throw notFound('Session not found.');
    return session;
  }

  async listForTicket(workspaceId: string, ticketKey: string): Promise<Session[]> {
    await this.workspaces.get(workspaceId);
    return this.store.listForTicket(workspaceId, ticketKey);
  }

  async artifact(workspaceId: string, sessionId: string): Promise<SessionArtifact> {
    await this.get(workspaceId, sessionId);
    const artifact = await this.store.latestArtifact(sessionId);
    if (!artifact) throw notFound('This session has no stored artifact.');
    return artifact;
  }

  async stop(workspaceId: string, sessionId: string): Promise<Session> {
    const session = await this.get(workspaceId, sessionId);
    if (isActive(session)) await this.handles.get(sessionId)?.stop();
    return this.get(workspaceId, sessionId);
  }

  async removeWorktree(workspaceId: string, sessionId: string, force: boolean): Promise<Session> {
    const session = await this.get(workspaceId, sessionId);
    if (session.worktreeRemovedAt) return session;
    if (isActive(session)) {
      throw new ApiException(409, 'SESSION_ACTIVE', 'Stop the session before removing its worktree.');
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

  /** Starts the runtime without waiting for it; every outcome reaches the session's record. */
  private launch(session: Session): void {
    const tracked = this.run(session)
      .catch((error: unknown) => {
        this.logger.error(`Lost track of session ${session.id}: ${this.describe(error)}`);
      })
      .finally(() => {
        this.handles.delete(session.id);
        this.tracking.delete(tracked);
      });
    this.tracking.add(tracked);
  }

  private async run(session: Session): Promise<void> {
    let ended = false;
    try {
      const handle = this.runtime.start({
        brief: session.brief,
        cwd: session.worktreePath,
        setup: { permissionMode: 'auto' },
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
    }
    if (!ended && !this.shuttingDown) await this.finish(session, 'failed', STREAM_CLOSED_REASON);
  }

  private async apply(session: Session, event: RuntimeEvent): Promise<void> {
    if (event.type === 'session_started') {
      const running = await this.store.markRunning(session.id, event.runtimeSessionId, event.transcriptPath);
      if (running) this.updates.publish(running);
      return;
    }
    if (event.outcome === 'success') await this.finish(session, 'ended', null);
    else if (event.outcome === 'stopped') await this.finish(session, 'stopped', null);
    else await this.finish(session, 'failed', event.message ?? 'The runtime reported an error.');
  }

  /** Stores the artifact first, then the final status, and publishes last. */
  private async finish(session: Session, status: SessionEnd['status'], reason: string | null): Promise<void> {
    const redactedReason = reason === null ? null : this.redactor.redact(reason);
    if (status === 'failed') this.logger.warn(`Session ${session.id} failed: ${redactedReason}`);

    const path = requiredArtifactPath(session.phase);
    const markdown = path ? await readArtifact(session.worktreePath, path) : null;
    if (path && markdown !== null) {
      await this.store.saveArtifact(session.id, FIRST_ROUND, path, markdown);
    }

    const updated = await this.store.markEnded(session.id, {
      status,
      reason: redactedReason,
      artifactStatus: markdown !== null ? 'complete' : 'incomplete',
    });
    if (updated) this.updates.publish(updated);
  }

  private describe(error: unknown): string {
    return this.redactor.redact(error instanceof Error ? error.message : String(error));
  }
}
