import type { StatusCategory, TicketSummary } from '@slop-control/shared';
import {
  TICKET_PAGE_SIZE,
  TicketNotFoundError,
  TrackerAuthError,
  TransitionNotAllowedError,
  type TrackerAdapter,
} from '../../src/tickets/tracker';

/** A ticket the contract asks a tracker to hold. Seeds are given oldest first. */
export interface SeedTicket {
  title: string;
  body: string;
  category: StatusCategory;
}

/** Drives one tracker through the behaviour every adapter must share. */
export interface TrackerContractDriver {
  /** The source ID its tickets must be reported under. */
  sourceId: string;
  /** Whether the tracker has a status in the `in_progress` category at all. */
  hasInProgress: boolean;
  /** A key the tracker understands and holds no ticket for. */
  missingKey: string;
  /**
   * @params seeds: tickets to hold, oldest first, so the last one was updated most recently
   * @return an adapter for a tracker that holds exactly these tickets
   */
  seed(seeds: SeedTicket[]): Promise<TrackerAdapter>;
  /** The comments the tracker holds for a ticket, oldest first. */
  comments(key: string): Promise<string[]>;
  /** An adapter for the same tracker whose credential the tracker rejects; absent where there is none to reject. */
  rejected?(): Promise<TrackerAdapter>;
  close?(): Promise<void>;
}

const OPEN_COUNT = TICKET_PAGE_SIZE + 5;

function seeds(hasInProgress: boolean): SeedTicket[] {
  const list: SeedTicket[] = [
    { title: 'Finished work', body: 'It is over.', category: 'done' },
    { title: 'Also finished', body: 'It is over too.', category: 'done' },
  ];
  for (let i = 1; i <= OPEN_COUNT; i += 1) {
    list.push({ title: `Open ticket ${i}`, body: `Body number ${i}`, category: 'open' });
  }
  list.push({ title: 'Find the needle here', body: 'A haystack.', category: 'open' });
  if (hasInProgress) {
    list.push({ title: 'Being worked on', body: 'Half way.', category: 'in_progress' });
  }
  return list;
}

async function listAll(
  adapter: TrackerAdapter,
  query: Parameters<TrackerAdapter['list']>[0],
): Promise<{ items: TicketSummary[]; pages: number }> {
  const items: TicketSummary[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await adapter.list({ ...query, cursor });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    pages += 1;
    if (pages > 10) throw new Error('The tracker never stopped paging.');
  } while (cursor);
  return { items, pages };
}

/** Runs against every real adapter and against the fake, so the fake stays faithful. */
export function describeTrackerContract(
  name: string,
  makeDriver: () => Promise<TrackerContractDriver>,
): void {
  describe(`TrackerAdapter contract: ${name}`, () => {
    let driver: TrackerContractDriver;
    let adapter: TrackerAdapter;
    let seeded: SeedTicket[];

    beforeAll(async () => {
      driver = await makeDriver();
      seeded = seeds(driver.hasInProgress);
      adapter = await driver.seed(seeded);
    });
    afterAll(async () => {
      await driver.close?.();
    });

    const titlesIn = (...categories: StatusCategory[]) =>
      seeded
        .filter((seed) => categories.includes(seed.category))
        .map((seed) => seed.title)
        .reverse();

    it('verifies a source it can read', async () => {
      await expect(adapter.verify()).resolves.toBeUndefined();
    });

    it('lists tickets that are not done by default, latest update first', async () => {
      const { items } = await listAll(adapter, { mine: false });
      expect(items.map((item) => item.title)).toEqual(titlesIn('open', 'in_progress'));
    });

    it('pages without repeating or dropping a ticket', async () => {
      const first = await adapter.list({ mine: false });
      expect(first.items.length).toBeLessThanOrEqual(TICKET_PAGE_SIZE);
      expect(first.nextCursor).not.toBeNull();

      const { items, pages } = await listAll(adapter, { mine: false });
      expect(pages).toBeGreaterThan(1);
      expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
    });

    it.each([
      ['open', ['open']],
      ['done', ['done']],
      ['in_progress', ['in_progress']],
      ['not_done', ['open', 'in_progress']],
      ['all', ['open', 'in_progress', 'done']],
    ] as const)('filters by the category %s', async (category, expected) => {
      const { items } = await listAll(adapter, { category, mine: false });
      expect(items.map((item) => item.title)).toEqual(titlesIn(...expected));
      if (category !== 'all' && category !== 'not_done') {
        expect(items.every((item) => item.statusCategory === category)).toBe(true);
      }
    });

    it('searches by text', async () => {
      const { items } = await listAll(adapter, { search: 'needle', mine: false });
      expect(items.map((item) => item.title)).toEqual(['Find the needle here']);
    });

    it('reports every ticket under its source, with a status name and a category', async () => {
      const { items } = await listAll(adapter, { category: 'all', mine: false });
      for (const item of items) {
        expect(item.sourceId).toBe(driver.sourceId);
        expect(item.status).not.toBe('');
        expect(['open', 'in_progress', 'done']).toContain(item.statusCategory);
        expect(Number.isNaN(Date.parse(item.updatedAt))).toBe(false);
      }
    });

    it('says whether the assigned-to-me filter was applied', async () => {
      expect(typeof (await adapter.list({})).mineApplied).toBe('boolean');
      expect((await adapter.list({ mine: false })).mineApplied).toBe(true);
    });

    it('reads a listed ticket by its key, with its body', async () => {
      const [summary] = (await adapter.list({ search: 'needle', mine: false })).items;
      await expect(adapter.get(summary!.key)).resolves.toMatchObject({
        ...summary,
        body: 'A haystack.',
      });
    });

    it('throws TicketNotFoundError for a ticket it does not hold', async () => {
      await expect(adapter.get(driver.missingKey)).rejects.toBeInstanceOf(TicketNotFoundError);
    });

    // The writes come last, so the lists above see the tickets as they were seeded.
    const needle = async () => (await adapter.list({ search: 'needle', mine: false })).items[0]!;

    it('adds a comment to a ticket', async () => {
      const { key } = await needle();
      const result = await adapter.addComment(key, 'A **review** in markdown.');
      expect(result.url === null || typeof result.url === 'string').toBe(true);
      expect(await driver.comments(key)).toEqual(['A **review** in markdown.']);
    });

    it('lists the statuses a ticket can move to, leaving out its current one', async () => {
      const ticket = await needle();
      const transitions = await adapter.listTransitions(ticket.key);
      expect(transitions.length).toBeGreaterThan(0);
      expect(transitions.map((item) => item.status)).not.toContain(ticket.status);
      for (const item of transitions) {
        expect(['open', 'in_progress', 'done']).toContain(item.category);
      }
    });

    it('moves a ticket to one of those statuses, and reads it back there', async () => {
      const { key } = await needle();
      const target = (await adapter.listTransitions(key)).find((item) => item.category === 'done')!;
      const moved = await adapter.transition(key, target.status);
      expect(moved).toMatchObject({ key, status: target.status, statusCategory: 'done' });
      expect(await adapter.get(key)).toMatchObject({ status: target.status });
      expect((await adapter.listTransitions(key)).map((item) => item.status)).not.toContain(
        target.status,
      );
    });

    it("throws TransitionNotAllowedError for a status the ticket can't move to", async () => {
      const [summary] = (await adapter.list({ search: 'Open ticket 1', mine: false })).items;
      await expect(adapter.transition(summary!.key, 'No such status')).rejects.toBeInstanceOf(
        TransitionNotAllowedError,
      );
      await expect(adapter.transition(summary!.key, summary!.status)).rejects.toBeInstanceOf(
        TransitionNotAllowedError,
      );
      expect(await adapter.get(summary!.key)).toMatchObject({ status: summary!.status });
    });

    it('throws TicketNotFoundError for a write to a ticket it does not hold', async () => {
      const { missingKey } = driver;
      await expect(adapter.addComment(missingKey, 'x')).rejects.toBeInstanceOf(TicketNotFoundError);
      await expect(adapter.listTransitions(missingKey)).rejects.toBeInstanceOf(TicketNotFoundError);
      await expect(adapter.transition(missingKey, 'x')).rejects.toBeInstanceOf(TicketNotFoundError);
    });

    it('throws TrackerAuthError for a write with a rejected credential, and writes nothing', async () => {
      if (!driver.rejected) return;
      const [summary] = (await adapter.list({ search: 'Open ticket 2', mine: false })).items;
      const refused = await driver.rejected();
      await expect(refused.addComment(summary!.key, 'never posted')).rejects.toBeInstanceOf(
        TrackerAuthError,
      );
      await expect(refused.transition(summary!.key, 'closed')).rejects.toBeInstanceOf(
        TrackerAuthError,
      );
      expect(await driver.comments(summary!.key)).toEqual([]);
    });
  });
}
