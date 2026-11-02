import type { LinkedRepo, Ticket, TicketPage, TicketQuery } from '@slop-control/shared';

export class TicketNotFoundError extends Error {}
export class TrackerAuthError extends Error {}
export class TrackerUnavailableError extends Error {}

export interface TrackerAdapter {
  /**
   * @params query: optional search text, state filter, and page cursor
   * @return one page of tickets, or throws TrackerAuthError or TrackerUnavailableError
   * Lists and searches tickets. Items that are not tickets, such as pull requests, are excluded.
   */
  list(query: TicketQuery): Promise<TicketPage>;

  /**
   * @params key: the ticket key
   * @return the ticket, or throws TicketNotFoundError, TrackerAuthError, or TrackerUnavailableError
   * Reads one ticket's details from the tracker.
   */
  get(key: string): Promise<Ticket>;
}

export abstract class TrackerAdapterFactory {
  /**
   * @params repo: the linked repo whose tickets are wanted
   * @return the adapter for that repo's ticket source
   * Resolves the adapter. Sprint 1 always returns a GitHub Issues adapter.
   */
  abstract forRepo(repo: LinkedRepo): TrackerAdapter;
}
