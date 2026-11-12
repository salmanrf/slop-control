import { Injectable } from '@nestjs/common';
import type {
  ArtifactStatus,
  InputArtifact,
  LaunchablePhase,
  Phase,
  ScopeFlag,
  Session,
  SessionArtifact,
  SessionSetup,
  SessionStatus,
} from '@slop-control/shared';
import { isUuid } from '../common/uuid';
import { Database } from '../db/database';

interface SessionRow {
  id: string;
  workspace_id: string;
  linked_repo_id: string;
  ticket_source_id: string;
  ticket_key: string;
  ticket_title: string;
  phase: Phase;
  round: number;
  status: SessionStatus;
  status_reason: string | null;
  brief: string;
  setup: SessionSetup;
  worktree_path: string;
  branch: string;
  base_ref: string;
  base_commit: string | null;
  base_fetch_failed: boolean;
  input_artifacts: InputArtifact[];
  scope_flags: ScopeFlag[];
  worktree_removed_at: Date | null;
  runtime_session_id: string | null;
  transcript_path: string | null;
  artifact_status: ArtifactStatus | null;
  started_at: Date;
  ended_at: Date | null;
}

interface ArtifactRow {
  session_id: string;
  round: number;
  path: string;
  markdown: string;
  created_at: Date;
}

export interface NewSession {
  id: string;
  workspaceId: string;
  linkedRepoId: string;
  ticketSourceId: string;
  ticketKey: string;
  ticketTitle: string;
  phase: Phase;
  brief: string;
  setup: SessionSetup;
  worktreePath: string;
  branch: string;
  baseRef: string;
  baseCommit: string;
  baseFetchFailed: boolean;
  inputArtifacts: InputArtifact[];
}

export interface SessionEnd {
  status: 'ended' | 'failed' | 'stopped';
  reason: string | null;
  artifactStatus: ArtifactStatus;
  /** Added to the session's flags, which are never removed. */
  scopeFlags: ScopeFlag[];
}

/** The latest complete result of one phase of a ticket. */
export interface PhaseResult {
  sessionId: string;
  phase: LaunchablePhase;
  round: number;
  markdown: string;
}

const ACTIVE = `status in ('starting', 'running')`;
const TERMINAL = `status in ('ended', 'failed', 'stopped')`;

/** Every workspace-owned read is scoped by workspace, so another workspace's rows look missing (FR-3). */
@Injectable()
export class SessionStore {
  constructor(private readonly db: Database) {}

  async insert(session: NewSession): Promise<Session> {
    const { rows } = await this.db.query<SessionRow>(
      `insert into session
         (id, workspace_id, linked_repo_id, ticket_source_id, ticket_key, ticket_title, phase,
          status, brief, setup, worktree_path, branch, base_ref, base_commit, input_artifacts,
          base_fetch_failed)
       values ($1, $2, $3, $4, $5, $6, $7, 'starting', $8, $9, $10, $11, $12, $13, $14, $15)
       returning *`,
      [
        session.id,
        session.workspaceId,
        session.linkedRepoId,
        session.ticketSourceId,
        session.ticketKey,
        session.ticketTitle,
        session.phase,
        session.brief,
        JSON.stringify(session.setup),
        session.worktreePath,
        session.branch,
        session.baseRef,
        session.baseCommit,
        JSON.stringify(session.inputArtifacts),
        session.baseFetchFailed,
      ],
    );
    return toSession(rows[0]!);
  }

  async find(workspaceId: string, sessionId: string): Promise<Session | null> {
    const { rows } = await this.db.query<SessionRow>(
      'select * from session where workspace_id = $1 and id = $2',
      [workspaceId, sessionId],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  /** A ticket is its source and key, whichever repo its sessions ran in. Latest first. */
  async listForTicket(
    workspaceId: string,
    sourceId: string,
    ticketKey: string,
  ): Promise<Session[]> {
    const { rows } = await this.db.query<SessionRow>(
      `select * from session
       where workspace_id = $1 and ticket_source_id = $2 and ticket_key = $3
       order by started_at desc, id`,
      [workspaceId, sourceId, ticketKey],
    );
    return rows.map(toSession);
  }

  /** Like `find`, for IDs that came from a URL and may not be UUIDs at all. */
  async findScoped(workspaceId: string, sessionId: string): Promise<Session | null> {
    if (!isUuid(workspaceId) || !isUuid(sessionId)) return null;
    return this.find(workspaceId, sessionId);
  }

  async listActive(): Promise<Session[]> {
    const { rows } = await this.db.query<SessionRow>(`select * from session where ${ACTIVE}`);
    return rows.map(toSession);
  }

  async markRunning(
    sessionId: string,
    runtimeSessionId: string,
    transcriptPath: string | null,
  ): Promise<Session | null> {
    const { rows } = await this.db.query<SessionRow>(
      `update session
       set status = 'running', runtime_session_id = $2,
           transcript_path = coalesce($3, transcript_path)
       where id = $1 and ${ACTIVE} returning *`,
      [sessionId, runtimeSessionId, transcriptPath],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  /** Takes effect only once per round: a round that already ended, or a later one, is left as it was. */
  async markEnded(sessionId: string, round: number, end: SessionEnd): Promise<Session | null> {
    const { rows } = await this.db.query<SessionRow>(
      `update session
       set status = $2, status_reason = $3, artifact_status = $4, ended_at = now(),
           scope_flags = array(select distinct unnest(scope_flags || $5::text[]))
       where id = $1 and round = $6 and ${ACTIVE} returning *`,
      [sessionId, end.status, end.reason, end.artifactStatus, end.scopeFlags, round],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  /**
   * Moves an ended session into its next round. One statement, so of two requests at once only
   * one gets the session back.
   */
  async beginRound(workspaceId: string, sessionId: string): Promise<Session | null> {
    const { rows } = await this.db.query<SessionRow>(
      `update session
       set round = round + 1, status = 'running', status_reason = null, ended_at = null,
           artifact_status = null, worktree_removed_at = null
       where workspace_id = $1 and id = $2 and ${TERMINAL} and runtime_session_id is not null
       returning *`,
      [workspaceId, sessionId],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  async markWorktreeRemoved(sessionId: string): Promise<Session> {
    const { rows } = await this.db.query<SessionRow>(
      'update session set worktree_removed_at = now() where id = $1 returning *',
      [sessionId],
    );
    return toSession(rows[0]!);
  }

  async saveArtifact(
    sessionId: string,
    round: number,
    path: string,
    markdown: string,
  ): Promise<void> {
    await this.db.query(
      `insert into session_artifact (session_id, round, path, markdown) values ($1, $2, $3, $4)
       on conflict (session_id, round) do nothing`,
      [sessionId, round, path, markdown],
    );
  }

  async latestArtifact(sessionId: string): Promise<SessionArtifact | null> {
    const { rows } = await this.db.query<ArtifactRow>(
      'select * from session_artifact where session_id = $1 order by round desc limit 1',
      [sessionId],
    );
    return rows[0] ? toArtifact(rows[0]) : null;
  }

  async artifactOfRound(sessionId: string, round: number): Promise<SessionArtifact | null> {
    const { rows } = await this.db.query<ArtifactRow>(
      'select * from session_artifact where session_id = $1 and round = $2',
      [sessionId, round],
    );
    return rows[0] ? toArtifact(rows[0]) : null;
  }

  /**
   * For each phase, the most recently stored artifact among the ticket's sessions whose result
   * is complete. An incomplete or running session is passed over for an earlier complete one.
   */
  async latestCompleteResults(
    workspaceId: string,
    sourceId: string,
    ticketKey: string,
  ): Promise<PhaseResult[]> {
    const { rows } = await this.db.query<{
      session_id: string;
      phase: LaunchablePhase;
      round: number;
      markdown: string;
    }>(
      `select distinct on (s.phase) s.id as session_id, s.phase, a.round, a.markdown
       from session s
       join lateral (
         select round, markdown, created_at from session_artifact
         where session_id = s.id order by round desc limit 1
       ) a on true
       where s.workspace_id = $1 and s.ticket_source_id = $2 and s.ticket_key = $3
         and s.artifact_status = 'complete'
       order by s.phase, a.created_at desc, s.started_at desc, s.id`,
      [workspaceId, sourceId, ticketKey],
    );
    return rows.map((row) => ({
      sessionId: row.session_id,
      phase: row.phase,
      round: row.round,
      markdown: row.markdown,
    }));
  }
}

function toArtifact(row: ArtifactRow): SessionArtifact {
  return {
    sessionId: row.session_id,
    round: row.round,
    path: row.path,
    markdown: row.markdown,
    createdAt: row.created_at.toISOString(),
  };
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    linkedRepoId: row.linked_repo_id,
    ticketSourceId: row.ticket_source_id,
    ticketKey: row.ticket_key,
    ticketTitle: row.ticket_title,
    phase: row.phase,
    round: row.round,
    status: row.status,
    statusReason: row.status_reason,
    brief: row.brief,
    setup: row.setup,
    worktreePath: row.worktree_path,
    branch: row.branch,
    baseRef: row.base_ref,
    baseCommit: row.base_commit,
    baseFetchFailed: row.base_fetch_failed,
    inputArtifacts: row.input_artifacts,
    scopeFlags: row.scope_flags,
    worktreeRemovedAt: row.worktree_removed_at?.toISOString() ?? null,
    runtimeSessionId: row.runtime_session_id,
    transcriptPath: row.transcript_path,
    resumeCommand: resumeCommand(row),
    artifactStatus: row.artifact_status,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
  };
}

function resumeCommand(row: SessionRow): string | null {
  const active = row.status === 'starting' || row.status === 'running';
  if (active || row.worktree_removed_at || !row.runtime_session_id) return null;
  return `cd ${shellQuote(row.worktree_path)} && claude --resume ${shellQuote(row.runtime_session_id)}`;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./@%+=:,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}
