import type {
  StatusCategory,
  Ticket,
  TicketPage,
  TicketQuery,
  TicketSource,
} from '@slop-control/shared';
import {
  TICKET_PAGE_SIZE,
  TicketNotFoundError,
  TrackerAdapter,
  TrackerAdapterFactory,
  TransitionNotAllowedError,
} from '../../src/tickets/tracker';

/** A ticket as a connected tracker holds it. The adapter stamps the real source ID when it's read. */
export function ticket(key: string, overrides: Partial<Ticket> = {}): Ticket {
  return {
    sourceId: '',
    key,
    title: `Title of ${key}`,
    status: 'open',
    statusCategory: 'open',
    url: `https://github.com/${key.replace('#', '/issues/')}`,
    updatedAt: '2026-11-01T10:00:00Z',
    body: `Body of ${key}`,
    ...overrides,
  };
}

/** One connected source's tracker, so one source can fail while another succeeds. */
export class FakeSourceTracker {
  tickets = new Map<string, Ticket>();
  /** Thrown by `list` and `get`. */
  failure: Error | null = null;
  /** Thrown by `verify`. */
  verifyFailure: Error | null = null;
  /** Thrown by `addComment` and `transition`. */
  writeFailure: Error | null = null;
  /** Every comment an approved action posted. */
  readonly comments: { key: string; body: string }[] = [];
  /** Every status change an approved action made. */
  readonly moves: { key: string; toStatus: string }[] = [];
  /** The statuses a ticket can be in, by name. A ticket can move to any other one. */
  statuses: Record<string, StatusCategory> = { open: 'open', closed: 'done' };
  /** What `list` reports; false stands for a source that couldn't limit tickets to the developer. */
  mineApplied = true;
  pageSize = TICKET_PAGE_SIZE;
  lastQuery: TicketQuery | null = null;
  calls = { verify: 0, list: 0, get: 0 };
  /** The credential the latest adapter was built with. */
  lastToken: string | null = null;

  add(...tickets: Ticket[]): void {
    for (const item of tickets) this.tickets.set(item.key, item);
  }

  adapter(sourceId: string): TrackerAdapter {
    const held = (key: string): Ticket => {
      if (this.failure) throw this.failure;
      const found = this.tickets.get(key);
      if (!found) throw new TicketNotFoundError(`No ticket ${key}`);
      return found;
    };
    const transitions = (current: string) =>
      Object.entries(this.statuses)
        .filter(([status]) => status !== current)
        .map(([status, category]) => ({ status, category }));
    return {
      addComment: async (key, body) => {
        held(key);
        if (this.writeFailure) throw this.writeFailure;
        this.comments.push({ key, body });
        return {
          url: `https://tracker.invalid/${encodeURIComponent(key)}#comment-${this.comments.length}`,
        };
      },
      listTransitions: async (key) => transitions(held(key).status),
      transition: async (key, toStatus) => {
        const current = held(key);
        if (this.writeFailure) throw this.writeFailure;
        const target = transitions(current.status).find((item) => item.status === toStatus);
        if (!target) throw new TransitionNotAllowedError(`${key} can't move to "${toStatus}".`);
        const moved = { ...current, status: target.status, statusCategory: target.category };
        this.tickets.set(key, moved);
        this.moves.push({ key, toStatus });
        return { ...moved, sourceId };
      },
      verify: async () => {
        this.calls.verify += 1;
        if (this.verifyFailure) throw this.verifyFailure;
      },
      list: async (query): Promise<TicketPage & { mineApplied: boolean }> => {
        this.calls.list += 1;
        if (this.failure) throw this.failure;
        this.lastQuery = query;
        const offset = query.cursor ? Number(query.cursor) : 0;
        const matching = [...this.tickets.values()]
          .filter((item) => matchesCategory(item, query.category ?? 'not_done'))
          .filter((item) => !query.search || `${item.title} ${item.body}`.includes(query.search))
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        const next = offset + this.pageSize;
        return {
          items: matching.slice(offset, next).map(({ body: _body, ...summary }) => ({
            ...summary,
            sourceId,
          })),
          nextCursor: next < matching.length ? String(next) : null,
          // As the real adapters do: with no filter asked for, there is nothing left unapplied.
          mineApplied: query.mine === false ? true : this.mineApplied,
        };
      },
      get: async (key) => {
        this.calls.get += 1;
        if (this.failure) throw this.failure;
        const found = this.tickets.get(key);
        if (!found) throw new TicketNotFoundError(`No ticket ${key}`);
        return { ...found, sourceId };
      },
    };
  }
}

function matchesCategory(item: Ticket, category: NonNullable<TicketQuery['category']>): boolean {
  if (category === 'all') return true;
  if (category === 'not_done') return item.statusCategory !== 'done';
  return item.statusCategory === category;
}

/**
 * Stands in for every connected tracker, keyed by the source's label (`owner/repo`). The
 * conveniences on the factory itself act on `acme/widgets`, the source the harness connects.
 */
export class FakeTracker extends TrackerAdapterFactory {
  static readonly DEFAULT = 'acme/widgets';
  private readonly bySource = new Map<string, FakeSourceTracker>();
  lastSource: TicketSource | null = null;

  source(label: string = FakeTracker.DEFAULT): FakeSourceTracker {
    const key = label.toLowerCase();
    let tracker = this.bySource.get(key);
    if (!tracker) {
      tracker = new FakeSourceTracker();
      this.bySource.set(key, tracker);
    }
    return tracker;
  }

  forConnected(source: TicketSource, token: string | null): TrackerAdapter {
    this.lastSource = source;
    const tracker = this.source(source.label);
    tracker.lastToken = token;
    return tracker.adapter(source.id);
  }

  /** Forgets every source's tickets and failures. */
  reset(): void {
    this.bySource.clear();
    this.lastSource = null;
  }

  add(...tickets: Ticket[]): void {
    this.source().add(...tickets);
  }
  get tickets(): Map<string, Ticket> {
    return this.source().tickets;
  }
  get failure(): Error | null {
    return this.source().failure;
  }
  set failure(error: Error | null) {
    this.source().failure = error;
  }
  get lastQuery(): TicketQuery | null {
    return this.source().lastQuery;
  }
}
