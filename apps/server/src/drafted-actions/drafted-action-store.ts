import { Injectable } from '@nestjs/common';
import type {
  DraftedAction,
  DraftedActionStatus,
  DraftedActionType,
  Phase,
} from '@slop-control/shared';
import { isUuid } from '../common/uuid';
import { Database, isUniqueViolation } from '../db/database';

interface ActionRow {
  id: string;
  workspace_id: string;
  session_id: string;
  ticket_source_id: string;
  ticket_key: string;
  ticket_title: string;
  phase: Phase;
  round: number;
  type: DraftedActionType;
  payload: unknown;
  status: DraftedActionStatus;
  edited: boolean;
  result: unknown;
  error: string | null;
  created_at: Date;
  updated_at: Date;
  decided_at: Date | null;
  dispatched_at: Date | null;
}

export interface NewDraftedAction {
  sessionId: string;
  workspaceId: string;
  ticketSourceId: string;
  ticketKey: string;
  round: number;
  type: DraftedActionType;
  payload: object;
}

/** The ticket's title and the phase come from the action's session, which never changes them. */
const SELECT_ACTION = `
  select a.*, s.ticket_title, s.phase
  from drafted_action a join session s on s.id = a.session_id`;

/** Wraps a write so its row comes back with the session's fields, like every read. */
const returning = (write: string) => `
  with a as (${write} returning *)
  select a.*, s.ticket_title, s.phase from a join session s on s.id = a.session_id`;

const UNDECIDED = `status in ('pending', 'failed')`;

export const INTERRUPTED_DISPATCH =
  'The server stopped during the dispatch. Check GitHub or the ticket before approving again.';

/** Every read is scoped by workspace, so another workspace's actions look missing (FR-3). */
@Injectable()
export class DraftedActionStore {
  constructor(private readonly db: Database) {}

  /** Null if the session already has an action of this type waiting, which the database enforces. */
  async insert(action: NewDraftedAction): Promise<DraftedAction | null> {
    try {
      const { rows } = await this.db.query<ActionRow>(
        returning(
          `insert into drafted_action
             (session_id, workspace_id, ticket_source_id, ticket_key, round, type, payload)
           values ($1, $2, $3, $4, $5, $6, $7)`,
        ),
        [
          action.sessionId,
          action.workspaceId,
          action.ticketSourceId,
          action.ticketKey,
          action.round,
          action.type,
          JSON.stringify(action.payload),
        ],
      );
      return toAction(rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async find(workspaceId: string, actionId: string): Promise<DraftedAction | null> {
    if (!isUuid(workspaceId) || !isUuid(actionId)) return null;
    const { rows } = await this.db.query<ActionRow>(
      `${SELECT_ACTION} where a.workspace_id = $1 and a.id = $2`,
      [workspaceId, actionId],
    );
    return rows[0] ? toAction(rows[0]) : null;
  }

  /** Newest first, for the approvals inbox. */
  async list(workspaceId: string, statuses: DraftedActionStatus[]): Promise<DraftedAction[]> {
    const { rows } = await this.db.query<ActionRow>(
      `${SELECT_ACTION} where a.workspace_id = $1 and a.status = any($2)
       order by a.created_at desc, a.id`,
      [workspaceId, statuses],
    );
    return rows.map(toAction);
  }

  /** Oldest first, in every status, for the session page. */
  async listForSession(workspaceId: string, sessionId: string): Promise<DraftedAction[]> {
    const { rows } = await this.db.query<ActionRow>(
      `${SELECT_ACTION} where a.workspace_id = $1 and a.session_id = $2
       order by a.created_at, a.id`,
      [workspaceId, sessionId],
    );
    return rows.map(toAction);
  }

  /** The session's action of this type that is waiting on the developer or on a dispatch, if any. */
  async findOpen(sessionId: string, type: DraftedActionType): Promise<DraftedAction | null> {
    const { rows } = await this.db.query<ActionRow>(
      `${SELECT_ACTION} where a.session_id = $1 and a.type = $2
         and a.status in ('pending', 'failed', 'dispatching')`,
      [sessionId, type],
    );
    return rows[0] ? toAction(rows[0]) : null;
  }

  async hasSucceeded(sessionId: string, type: DraftedActionType): Promise<boolean> {
    const { rows } = await this.db.query(
      `select 1 from drafted_action where session_id = $1 and type = $2 and status = 'succeeded'`,
      [sessionId, type],
    );
    return rows.length > 0;
  }

  /**
   * Replaces a pending draft the developer hasn't touched. Null if it was edited or decided
   * meanwhile. A failed action is never redrafted: its payload is the record of what was sent.
   */
  async redraft(actionId: string, payload: object, round: number): Promise<DraftedAction | null> {
    return this.write(
      `update drafted_action set payload = $2, round = $3, updated_at = now()
       where id = $1 and status = 'pending' and not edited`,
      [actionId, JSON.stringify(payload), round],
    );
  }

  /** Null if the action was decided meanwhile. */
  async edit(actionId: string, payload: object): Promise<DraftedAction | null> {
    return this.write(
      `update drafted_action set payload = $2, edited = true, updated_at = now()
       where id = $1 and ${UNDECIDED}`,
      [actionId, JSON.stringify(payload)],
    );
  }

  /**
   * Claims an action for dispatch. One statement, so of two approvals at once only one gets the
   * action back.
   */
  async claim(actionId: string): Promise<DraftedAction | null> {
    return this.write(
      `update drafted_action
       set status = 'dispatching', error = null, decided_at = now(), updated_at = now()
       where id = $1 and ${UNDECIDED}`,
      [actionId],
    );
  }

  async reject(actionId: string): Promise<DraftedAction | null> {
    return this.write(
      `update drafted_action set status = 'rejected', decided_at = now(), updated_at = now()
       where id = $1 and ${UNDECIDED}`,
      [actionId],
    );
  }

  async markSucceeded(actionId: string, result: object): Promise<DraftedAction | null> {
    return this.write(
      `update drafted_action
       set status = 'succeeded', result = $2, error = null, dispatched_at = now(),
           updated_at = now()
       where id = $1 and status = 'dispatching'`,
      [actionId, JSON.stringify(result)],
    );
  }

  async markFailed(actionId: string, error: string): Promise<DraftedAction | null> {
    return this.write(
      `update drafted_action
       set status = 'failed', error = $2, dispatched_at = now(), updated_at = now()
       where id = $1 and status = 'dispatching'`,
      [actionId, error],
    );
  }

  /** At startup nothing is dispatching, so whatever says it is was cut off. */
  async failInterrupted(): Promise<number> {
    const { rowCount } = await this.db.query(
      `update drafted_action
       set status = 'failed', error = $1, dispatched_at = now(), updated_at = now()
       where status = 'dispatching'`,
      [INTERRUPTED_DISPATCH],
    );
    return rowCount ?? 0;
  }

  private async write(statement: string, values: unknown[]): Promise<DraftedAction | null> {
    const { rows } = await this.db.query<ActionRow>(returning(statement), values);
    return rows[0] ? toAction(rows[0]) : null;
  }
}

function toAction(row: ActionRow): DraftedAction {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    ticketSourceId: row.ticket_source_id,
    ticketKey: row.ticket_key,
    ticketTitle: row.ticket_title,
    phase: row.phase,
    round: row.round,
    type: row.type,
    payload: row.payload,
    status: row.status,
    edited: row.edited,
    result: row.result ?? null,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    decidedAt: row.decided_at?.toISOString() ?? null,
    dispatchedAt: row.dispatched_at?.toISOString() ?? null,
    // The type column and its payload's shape are written together, by `drafts.ts` and `edit`.
  } as DraftedAction;
}
