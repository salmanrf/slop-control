import { Injectable } from '@nestjs/common';
import type {
  BuiltInTicketComment,
  BuiltInTicketStatus,
  StatusCategory,
  Ticket,
  TicketPage,
  TicketQuery,
  TicketSource,
  TicketTransition,
} from '@slop-control/shared';
import { ApiException, notFound, validationFailed } from '../common/api-exception';
import { isUuid } from '../common/uuid';
import { Database } from '../db/database';
import { BUILT_IN_SCOPE_KEY, TicketSourceStore } from './ticket-source-store';
import {
  TICKET_PAGE_SIZE,
  TicketNotFoundError,
  TrackerAdapter,
  TransitionNotAllowedError,
} from './tracker';

interface TicketRow {
  id: string;
  ticket_source_id: string;
  number: number;
  title: string;
  body: string;
  status: BuiltInTicketStatus;
  updated_at: Date;
}

interface CommentRow {
  id: string;
  body: string;
  created_at: Date;
}

const STATUSES: Record<BuiltInTicketStatus, { label: string; category: StatusCategory }> = {
  todo: { label: 'To do', category: 'open' },
  in_progress: { label: 'In progress', category: 'in_progress' },
  in_review: { label: 'In review', category: 'in_progress' },
  done: { label: 'Done', category: 'done' },
  cancelled: { label: 'Cancelled', category: 'done' },
};

const KEY = /^T-([1-9]\d{0,8})$/;

/**
 * The tracker every workspace has without any setup (FR-6e). Only the developer writes to it: from
 * the dashboard, or by approving a drafted action. No session can (FR-6f).
 */
@Injectable()
export class BuiltInTracker {
  constructor(
    private readonly db: Database,
    private readonly sources: TicketSourceStore,
  ) {}

  /** Shaped like any connected tracker, so lists, sessions, and drafted actions treat it the same. */
  adapterFor(source: TicketSource): TrackerAdapter {
    const held = async (key: string): Promise<TicketRow> => {
      const row = await this.findRow(source.id, key);
      if (!row) throw new TicketNotFoundError(`Ticket ${key} doesn't exist.`);
      return row;
    };
    return {
      verify: async () => undefined,
      list: (query) => this.list(source.id, query),
      get: async (key) => toTicket(await held(key)),
      addComment: async (key, body) => {
        await this.insertComment((await held(key)).id, body);
        return { url: null };
      },
      // Any status can follow any other, as in the dashboard's own status control.
      listTransitions: async (key) => transitionsFrom((await held(key)).status),
      transition: async (key, toStatus) => {
        const row = await held(key);
        const target = statusNamed(toStatus);
        if (!target || target === row.status) {
          throw new TransitionNotAllowedError(
            `Ticket ${key} can't move to "${toStatus}" from "${STATUSES[row.status].label}".`,
          );
        }
        const { rows } = await this.db.query<TicketRow>(
          'update built_in_ticket set status = $2, updated_at = now() where id = $1 returning *',
          [row.id, target],
        );
        return toTicket(rows[0]!);
      },
    };
  }

  /**
   * @params workspaceId: the workspace; body: the title and optional body
   * @return the ticket, or throws BUILT_IN_CREATION_OFF if the workspace has a connected source
   * Creates a ticket with the next key and the status *To do*.
   */
  async create(workspaceId: string, body: unknown): Promise<Ticket> {
    const source = await this.source(workspaceId);
    const fields = parseFields(body);
    if (fields.title === undefined) throw validationFailed('A ticket needs a title.');
    if (!source.canCreateTickets) {
      throw new ApiException(
        409,
        'BUILT_IN_CREATION_OFF',
        'New tickets come from your connected sources. Disconnect them to create built-in tickets again.',
      );
    }

    const row = await this.db.transaction(async (tx) => {
      const allocated = await tx.query<{ number: number }>(
        `update ticket_source set next_ticket_number = next_ticket_number + 1
         where id = $1 returning next_ticket_number - 1 as number`,
        [source.id],
      );
      const inserted = await tx.query<TicketRow>(
        `insert into built_in_ticket (ticket_source_id, number, title, body)
         values ($1, $2, $3, $4) returning *`,
        [source.id, allocated.rows[0]!.number, fields.title, fields.body ?? ''],
      );
      return inserted.rows[0]!;
    });
    return toTicket(row);
  }

  /**
   * @params workspaceId: the workspace; key: the ticket key; body: the fields to change
   * @return the updated ticket, or throws NOT_FOUND
   * Edits a ticket from the dashboard, which is the only caller.
   */
  async update(workspaceId: string, key: string, body: unknown): Promise<Ticket> {
    const source = await this.source(workspaceId);
    const existing = await this.requireRow(source.id, key);
    const fields = parseFields(body);
    const { rows } = await this.db.query<TicketRow>(
      `update built_in_ticket
       set title = coalesce($2, title), body = coalesce($3, body), status = coalesce($4, status),
           updated_at = now()
       where id = $1 returning *`,
      [existing.id, fields.title ?? null, fields.body ?? null, fields.status ?? null],
    );
    return toTicket(rows[0]!);
  }

  /**
   * @params workspaceId: the workspace; key: the ticket key
   * @return its comments, oldest first, or throws NOT_FOUND
   * Lists a ticket's comments.
   */
  async listComments(workspaceId: string, key: string): Promise<BuiltInTicketComment[]> {
    const source = await this.source(workspaceId);
    const ticket = await this.requireRow(source.id, key);
    const { rows } = await this.db.query<CommentRow>(
      'select * from built_in_ticket_comment where ticket_id = $1 order by created_at, id',
      [ticket.id],
    );
    return rows.map(toComment);
  }

  /**
   * @params workspaceId: the workspace; key: the ticket key; body: the comment
   * @return the comment, or throws NOT_FOUND
   * Adds a comment and updates the ticket's `updatedAt`.
   */
  async addComment(workspaceId: string, key: string, body: unknown): Promise<BuiltInTicketComment> {
    const source = await this.source(workspaceId);
    const ticket = await this.requireRow(source.id, key);
    const text = (body as { body?: unknown } | null)?.body;
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw validationFailed('A comment needs some text.');
    }
    return this.insertComment(ticket.id, text.trim());
  }

  private insertComment(ticketId: string, body: string): Promise<BuiltInTicketComment> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx.query<CommentRow>(
        'insert into built_in_ticket_comment (ticket_id, body) values ($1, $2) returning *',
        [ticketId, body],
      );
      await tx.query('update built_in_ticket set updated_at = now() where id = $1', [ticketId]);
      return toComment(inserted.rows[0]!);
    });
  }

  /** There are no assignees and one user, so `mine` is ignored and counts as applied. */
  private async list(
    sourceId: string,
    query: TicketQuery,
  ): Promise<TicketPage & { mineApplied: boolean }> {
    const offset = decodeOffset(query.cursor);
    const search = query.search?.trim() ?? '';
    const statuses = statusesFor(query.category ?? 'not_done');
    const { rows } = await this.db.query<TicketRow>(
      `select * from built_in_ticket
       where ticket_source_id = $1 and status = any($2)
         and ($3 = '' or strpos(lower(title), lower($3)) > 0 or strpos(lower(body), lower($3)) > 0)
       order by updated_at desc, number desc
       limit $4 offset $5`,
      [sourceId, statuses, search, TICKET_PAGE_SIZE + 1, offset],
    );
    return {
      items: rows.slice(0, TICKET_PAGE_SIZE).map(toSummary),
      nextCursor: rows.length > TICKET_PAGE_SIZE ? encodeOffset(offset + TICKET_PAGE_SIZE) : null,
      mineApplied: true,
    };
  }

  private async source(workspaceId: string): Promise<TicketSource> {
    const source = isUuid(workspaceId)
      ? await this.sources.findByScope(workspaceId, BUILT_IN_SCOPE_KEY)
      : null;
    if (!source) throw notFound('Workspace not found.');
    return source;
  }

  private async requireRow(sourceId: string, key: string): Promise<TicketRow> {
    const row = await this.findRow(sourceId, key);
    if (!row) throw notFound(`Ticket ${key} doesn't exist.`);
    return row;
  }

  private async findRow(sourceId: string, key: string): Promise<TicketRow | null> {
    const number = KEY.exec(key)?.[1];
    if (!number) return null;
    const { rows } = await this.db.query<TicketRow>(
      'select * from built_in_ticket where ticket_source_id = $1 and number = $2',
      [sourceId, Number(number)],
    );
    return rows[0] ?? null;
  }
}

function parseFields(body: unknown): {
  title?: string;
  body?: string;
  status?: BuiltInTicketStatus;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw validationFailed('Send the ticket fields.');
  }
  const { title, body: text, status } = body as Record<string, unknown>;
  const fields: ReturnType<typeof parseFields> = {};
  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0) {
      throw validationFailed('A ticket needs a title.');
    }
    fields.title = title.trim();
  }
  if (text !== undefined) {
    if (typeof text !== 'string' || text.includes('\u0000')) {
      throw validationFailed("A ticket's body must be text.");
    }
    fields.body = text;
  }
  if (status !== undefined) {
    if (typeof status !== 'string' || !Object.hasOwn(STATUSES, status)) {
      throw validationFailed('Choose todo, in_progress, in_review, done, or cancelled.');
    }
    fields.status = status as BuiltInTicketStatus;
  }
  return fields;
}

function transitionsFrom(current: BuiltInTicketStatus): TicketTransition[] {
  return (Object.keys(STATUSES) as BuiltInTicketStatus[])
    .filter((status) => status !== current)
    .map((status) => ({ status: STATUSES[status].label, category: STATUSES[status].category }));
}

/** A status by the name the tracker reports, e.g. `In review`. */
function statusNamed(name: string): BuiltInTicketStatus | null {
  const wanted = name.trim().toLowerCase();
  const all = Object.keys(STATUSES) as BuiltInTicketStatus[];
  return all.find((status) => STATUSES[status].label.toLowerCase() === wanted) ?? null;
}

function statusesFor(category: NonNullable<TicketQuery['category']>): BuiltInTicketStatus[] {
  const all = Object.keys(STATUSES) as BuiltInTicketStatus[];
  if (category === 'all') return all;
  if (category === 'not_done') return all.filter((status) => STATUSES[status].category !== 'done');
  return all.filter((status) => STATUSES[status].category === category);
}

function toSummary(row: TicketRow) {
  return {
    sourceId: row.ticket_source_id,
    key: `T-${row.number}`,
    title: row.title,
    status: STATUSES[row.status].label,
    statusCategory: STATUSES[row.status].category,
    url: null,
    updatedAt: row.updated_at.toISOString(),
  };
}

function toTicket(row: TicketRow): Ticket {
  return { ...toSummary(row), body: row.body };
}

function toComment(row: CommentRow): BuiltInTicketComment {
  return { id: row.id, body: row.body, createdAt: row.created_at.toISOString() };
}

function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString('base64url');
}

function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const { offset } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      offset: unknown;
    };
    return typeof offset === 'number' && Number.isInteger(offset) && offset > 0 ? offset : 0;
  } catch {
    return 0;
  }
}
