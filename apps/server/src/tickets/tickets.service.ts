import { Injectable } from '@nestjs/common';
import type {
  MergedTicketPage,
  SourceListStatus,
  Ticket,
  TicketQuery,
  TicketSource,
  TicketSummary,
} from '@slop-control/shared';
import { notFound } from '../common/api-exception';
import { Redactor } from '../common/redactor';
import { TicketSourcesService } from './ticket-sources.service';
import {
  TICKET_PAGE_SIZE,
  TrackerAdapter,
  TrackerAuthError,
  TrackerUnavailableError,
  withTrackerErrors,
} from './tracker';

/** Where the merged list stands in one source. */
interface Position {
  /** The adapter's cursor for the page being read; null for its first page. */
  cursor: string | null;
  /** How many of that page's items earlier merged pages already returned. */
  used: number;
  done: boolean;
}

interface Stream {
  source: TicketSource;
  adapter: TrackerAdapter;
  position: Position;
  /** The rest of the page at `position.cursor`. */
  buffer: TicketSummary[];
  next: string | null;
  status: SourceListStatus;
}

/** A page of only non-tickets, such as pull requests, is skipped, but not without limit. */
const MAX_EMPTY_PAGES = 5;

/** Tickets are read live from their tracker and merged; only built-in tickets are stored here (FR-4). */
@Injectable()
export class TicketsService {
  constructor(
    private readonly sources: TicketSourcesService,
    private readonly redactor: Redactor,
  ) {}

  /**
   * @params workspaceId: the workspace; sourceId: limits the list to one source; query: filters and the merged cursor
   * @return one merged page and a status per source, with failures reported there rather than thrown
   * Lists and merges tickets across the workspace's connected sources and built-in tracker.
   */
  async list(
    workspaceId: string,
    sourceId: string | undefined,
    query: TicketQuery,
  ): Promise<MergedTicketPage> {
    const connected = (await this.sources.list(workspaceId)).filter(
      (source) => source.disconnectedAt === null,
    );
    const selected = sourceId ? connected.filter((source) => source.id === sourceId) : connected;
    if (sourceId && selected.length === 0) throw notFound('Ticket source not found.');

    const positions = decodeCursor(query.cursor);
    const streams = selected.map((source): Stream => {
      return {
        source,
        adapter: this.sources.adapterFor(source),
        position: positions[source.id] ?? { cursor: null, used: 0, done: false },
        buffer: [],
        next: null,
        status: { sourceId: source.id, state: 'ok', message: null, mineApplied: true },
      };
    });
    await Promise.all(streams.map((stream) => this.fill(stream, query)));

    const items: TicketSummary[] = [];
    while (items.length < TICKET_PAGE_SIZE) {
      const stream = newest(streams);
      if (!stream) break;
      items.push(stream.buffer.shift()!);
      stream.position.used += 1;
      // The next page must be in hand before another source's older ticket can be placed.
      if (stream.buffer.length === 0) {
        if (stream.next === null) stream.position.done = true;
        else await this.fill(stream, query);
      }
    }

    // A failing source keeps its position, so the next page tries it again.
    const more = streams.some((stream) => !stream.position.done);
    return {
      items,
      nextCursor: more ? encodeCursor(streams) : null,
      sources: streams.map((stream) => stream.status),
    };
  }

  /**
   * @params workspaceId: the workspace; sourceId: the ticket's source; key: its key
   * @return the ticket, or throws NOT_FOUND, SOURCE_DISCONNECTED, or a tracker error
   * Reads one ticket through its source's adapter.
   */
  async get(workspaceId: string, sourceId: string, key: string): Promise<Ticket> {
    return this.read(await this.sources.get(workspaceId, sourceId), key);
  }

  read(source: TicketSource, key: string): Promise<Ticket> {
    const adapter = this.sources.adapterFor(source);
    return withTrackerErrors(() => adapter.get(key));
  }

  /** Loads the page at the stream's position. A failure stays with this source and keeps its position. */
  private async fill(stream: Stream, query: TicketQuery): Promise<void> {
    const { position } = stream;
    if (position.done || stream.status.state !== 'ok') return;
    try {
      for (let attempt = 0; attempt < MAX_EMPTY_PAGES; attempt += 1) {
        if (stream.buffer.length === 0 && stream.next !== null) {
          position.cursor = stream.next;
          position.used = 0;
          stream.next = null;
        }
        const page = await stream.adapter.list({
          ...query,
          cursor: position.cursor ?? undefined,
        });
        stream.status.mineApplied = page.mineApplied;
        stream.buffer = page.items.slice(position.used);
        stream.next = page.nextCursor;
        if (stream.buffer.length > 0) return;
        if (stream.next === null) {
          position.done = true;
          return;
        }
      }
    } catch (error) {
      if (error instanceof TrackerAuthError) {
        stream.status = {
          ...stream.status,
          state: 'auth_failed',
          message: this.redactor.redact(error.message),
        };
      } else if (error instanceof TrackerUnavailableError) {
        stream.status = {
          ...stream.status,
          state: 'unavailable',
          message: this.redactor.redact(error.message),
        };
      } else {
        throw error;
      }
      stream.buffer = [];
    }
  }
}

/** The stream whose next ticket was updated last; ties go to the lower source ID, then key. */
function newest(streams: Stream[]): Stream | null {
  let best: Stream | null = null;
  for (const stream of streams) {
    const head = stream.buffer[0];
    if (!head) continue;
    const bestHead = best?.buffer[0];
    if (!bestHead || isBefore(head, bestHead)) best = stream;
  }
  return best;
}

function isBefore(a: TicketSummary, b: TicketSummary): boolean {
  const aTime = Date.parse(a.updatedAt);
  const bTime = Date.parse(b.updatedAt);
  if (aTime !== bTime) return aTime > bTime;
  if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId;
  return a.key < b.key;
}

/** Holds every source's position, so the server keeps no state between pages. */
function encodeCursor(streams: Stream[]): string {
  const positions: Record<string, [string | null, number, boolean]> = {};
  for (const { source, position, buffer, next } of streams) {
    const exhausted = buffer.length === 0 && next !== null;
    positions[source.id] = exhausted
      ? [next, 0, position.done]
      : [position.cursor, position.used, position.done];
  }
  return Buffer.from(JSON.stringify(positions)).toString('base64url');
}

function decodeCursor(cursor: string | undefined): Record<string, Position> {
  if (!cursor) return {};
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null) return {};
    const positions: Record<string, Position> = {};
    for (const [sourceId, value] of Object.entries(raw)) {
      if (!Array.isArray(value)) continue;
      const [adapterCursor, used, done] = value as unknown[];
      positions[sourceId] = {
        cursor: typeof adapterCursor === 'string' ? adapterCursor : null,
        used: typeof used === 'number' && Number.isInteger(used) && used > 0 ? used : 0,
        done: done === true,
      };
    }
    return positions;
  } catch {
    return {};
  }
}
