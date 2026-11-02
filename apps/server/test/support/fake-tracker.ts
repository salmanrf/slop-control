import type { LinkedRepo, Ticket, TicketPage, TicketQuery } from '@slop-control/shared';
import {
  TicketNotFoundError,
  TrackerAdapter,
  TrackerAdapterFactory,
} from '../../src/tickets/tracker';

export function ticket(key: string, overrides: Partial<Ticket> = {}): Ticket {
  return {
    key,
    title: `Title of ${key}`,
    status: 'open',
    url: `https://github.com/${key.replace('#', '/issues/')}`,
    updatedAt: '2026-11-01T10:00:00Z',
    body: `Body of ${key}`,
    ...overrides,
  };
}

export class FakeTracker extends TrackerAdapterFactory implements TrackerAdapter {
  tickets = new Map<string, Ticket>();
  failure: Error | null = null;
  lastQuery: TicketQuery | null = null;
  lastRepo: LinkedRepo | null = null;

  add(...tickets: Ticket[]): void {
    for (const item of tickets) this.tickets.set(item.key, item);
  }
  forRepo(repo: LinkedRepo): TrackerAdapter {
    this.lastRepo = repo;
    return this;
  }
  async list(query: TicketQuery): Promise<TicketPage> {
    if (this.failure) throw this.failure;
    this.lastQuery = query;
    return { items: [...this.tickets.values()], nextCursor: null };
  }
  async get(key: string): Promise<Ticket> {
    if (this.failure) throw this.failure;
    const found = this.tickets.get(key);
    if (!found) throw new TicketNotFoundError(`No ticket ${key}`);
    return found;
  }
}
