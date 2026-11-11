import type { StatusCategory, TicketSummary } from '@slop-control/shared';
import {
  TICKET_PAGE_SIZE,
  TicketNotFoundError,
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
  });
}
