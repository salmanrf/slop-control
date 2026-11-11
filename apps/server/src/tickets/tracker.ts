import type { Ticket, TicketPage, TicketQuery, TicketSource } from '@slop-control/shared';
import { ApiException, notFound } from '../common/api-exception';

export class TicketNotFoundError extends Error {}
export class TrackerAuthError extends Error {}
export class TrackerUnavailableError extends Error {}

/** How many tickets a page holds, for every adapter and for the merged list. */
export const TICKET_PAGE_SIZE = 30;

export interface TrackerAdapter {
  /**
   * @return resolves if the credential can read the source's scope; otherwise throws TrackerAuthError or TrackerUnavailableError
   * Checks a source before it is saved.
   */
  verify(): Promise<void>;

  /**
   * @params query: optional search text, status category, assigned-to-me flag, and page cursor
   * @return one page of tickets, latest update first, and whether `mine` was applied; or throws TrackerAuthError or TrackerUnavailableError
   * Lists and searches tickets. Items that are not tickets, such as pull requests, are excluded.
   */
  list(query: TicketQuery): Promise<TicketPage & { mineApplied: boolean }>;

  /**
   * @params key: the ticket key
   * @return the ticket, or throws TicketNotFoundError, TrackerAuthError, or TrackerUnavailableError
   * Reads one ticket's details from the tracker.
   */
  get(key: string): Promise<Ticket>;
}

/** The built-in tracker isn't created here, so tests can fake connected trackers and still run it for real. */
export abstract class TrackerAdapterFactory {
  /**
   * @params source: a connected source, with no built-in type; token: its stored credential, if any
   * @return the adapter for that source
   * Resolves the adapter for a connected source.
   */
  abstract forConnected(source: TicketSource, token: string | null): TrackerAdapter;
}

/** Turns an adapter's errors into the API's, for reads that can't report them per source. */
export async function withTrackerErrors<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof TicketNotFoundError) throw notFound(error.message);
    if (error instanceof TrackerAuthError) {
      throw new ApiException(502, 'TRACKER_AUTH_FAILED', error.message);
    }
    if (error instanceof TrackerUnavailableError) {
      throw new ApiException(502, 'TRACKER_UNAVAILABLE', error.message);
    }
    throw error;
  }
}
