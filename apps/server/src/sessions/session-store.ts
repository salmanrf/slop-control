import { Injectable } from '@nestjs/common';
import type {
  ArtifactStatus,
  Phase,
  Session,
  SessionArtifact,
  SessionStatus,
} from '@slop-control/shared';
import { Database } from '../db/database';

interface SessionRow {
  id: string;
  workspace_id: string;
  linked_repo_id: string;
  ticket_key: string;
  phase: Phase;
  status: SessionStatus;
  status_reason: string | null;
  brief: string;
  worktree_path: string;
  branch: string;
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
  ticketKey: string;
  phase: Phase;
  brief: string;
  worktreePath: string;
  branch: string;
}

export interface SessionEnd {
  status: 'ended' | 'failed' | 'stopped';
  reason: string | null;
  artifactStatus: ArtifactStatus;
}

const ACTIVE = `status in ('starting', 'running')`;

/** Every workspace-owned read is scoped by workspace, so another workspace's rows look missing (FR-3). */
@Injectable()
export class SessionStore {
  constructor(private readonly db: Database) {}

  async insert(session: NewSession): Promise<Session> {
    const { rows } = await this.db.query<SessionRow>(
      `insert into session (id, workspace_id, linked_repo_id, ticket_key, phase, status, brief, worktree_path, branch)
       values ($1, $2, $3, $4, $5, 'starting', $6, $7, $8) returning *`,
      [
        session.id,
        session.workspaceId,
        session.linkedRepoId,
        session.ticketKey,
        session.phase,
        session.brief,
        session.worktreePath,
        session.branch,
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

  async listForTicket(workspaceId: string, ticketKey: string): Promise<Session[]> {
    const { rows } = await this.db.query<SessionRow>(
      `select * from session where workspace_id = $1 and ticket_key = $2
       order by started_at desc, id`,
      [workspaceId, ticketKey],
    );
    return rows.map(toSession);
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
      `update session set status = 'running', runtime_session_id = $2, transcript_path = $3
       where id = $1 and ${ACTIVE} returning *`,
      [sessionId, runtimeSessionId, transcriptPath],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  /** Takes effect only once: a session that already ended is left as it was. */
  async markEnded(sessionId: string, end: SessionEnd): Promise<Session | null> {
    const { rows } = await this.db.query<SessionRow>(
      `update session set status = $2, status_reason = $3, artifact_status = $4, ended_at = now()
       where id = $1 and ${ACTIVE} returning *`,
      [sessionId, end.status, end.reason, end.artifactStatus],
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
    const row = rows[0];
    return row
      ? {
          sessionId: row.session_id,
          round: row.round,
          path: row.path,
          markdown: row.markdown,
          createdAt: row.created_at.toISOString(),
        }
      : null;
  }
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    linkedRepoId: row.linked_repo_id,
    ticketKey: row.ticket_key,
    phase: row.phase,
    status: row.status,
    statusReason: row.status_reason,
    brief: row.brief,
    worktreePath: row.worktree_path,
    branch: row.branch,
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
