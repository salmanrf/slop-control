import type { MergedTicketPage, TicketSummary } from '@slop-control/shared';
import { TrackerAuthError, TrackerUnavailableError } from '../src/tickets/tracker';
import { ticket } from './support/fake-tracker';
import {
  createHarness,
  KEY,
  linkSecondRepo,
  seedWorkspace,
  ticketPath,
  type Harness,
  type Seeded,
} from './support/session-harness';
import { resetDatabase } from './support/test-app';
import { CANARY_GITHUB_TOKEN } from './support/test-env';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Built-in tickets are stamped with the real time, so the fake's are placed around it. */
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe('tickets', () => {
  let h: Harness;
  let seeded: Seeded;
  let workspaceId: string;

  const list = (query = '', ws = workspaceId) =>
    h.api.get(`/workspaces/${ws}/tickets${query ? `?${query}` : ''}`);
  const keys = (page: MergedTicketPage) => page.items.map((item) => item.key);
  const connect = async (githubOwner: string, githubRepo: string) =>
    (
      await h.api
        .post(`/workspaces/${workspaceId}/sources`)
        .send({ type: 'github_issues', githubOwner, githubRepo })
    ).body.id as string;

  /** A workspace whose built-in tracker already holds a ticket when a source is connected. */
  const seedWithBuiltInTicket = async (): Promise<Seeded> => {
    const id = (await h.api.post('/workspaces').send({ name: 'mixed' })).body.id as string;
    await h.api.post(`/workspaces/${id}/built-in-tickets`).send({ title: 'Built-in work' });
    const clone = await linkSecondRepo(h, id, 'git@github.com:acme/widgets.git');
    const sourceId = (
      await h.api
        .post(`/workspaces/${id}/sources`)
        .send({ type: 'github_issues', githubOwner: 'acme', githubRepo: 'widgets' })
    ).body.id as string;
    const sources = (await h.api.get(`/workspaces/${id}/sources`)).body as {
      id: string;
      type: string;
    }[];
    return {
      workspaceId: id,
      clone: clone.clone,
      repoId: clone.repoId,
      sourceId,
      builtInSourceId: sources.find((source) => source.type === 'built_in')!.id,
    };
  };

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.reset();
    seeded = await seedWorkspace(h);
    workspaceId = seeded.workspaceId;
  });
  afterAll(() => h.close());

  describe('merged list', () => {
    it('lists every source together, most recently updated first, each with its source', async () => {
      const mixed = await seedWithBuiltInTicket();
      h.tracker.tickets.clear();
      h.tracker.add(
        ticket('acme/widgets#1', { updatedAt: daysFromNow(-1) }),
        ticket('acme/widgets#2', { updatedAt: daysFromNow(1) }),
      );

      const res = await list('', mixed.workspaceId);
      expect(res.status).toBe(200);
      expect(keys(res.body)).toEqual(['acme/widgets#2', 'T-1', 'acme/widgets#1']);
      expect(res.body.items.map((item: TicketSummary) => item.sourceId)).toEqual([
        mixed.sourceId,
        mixed.builtInSourceId,
        mixed.sourceId,
      ]);
      expect(res.body.nextCursor).toBeNull();
      expect(res.body.sources).toEqual(
        expect.arrayContaining([
          { sourceId: mixed.sourceId, state: 'ok', message: null, mineApplied: true },
          { sourceId: mixed.builtInSourceId, state: 'ok', message: null, mineApplied: true },
        ]),
      );
      expect(res.body.sources).toHaveLength(2);
    });

    it('passes the search and filters through to each source', async () => {
      await list('search=Title&category=done&mine=false');
      expect(h.tracker.lastQuery).toMatchObject({
        search: 'Title',
        category: 'done',
        mine: false,
      });
    });

    it('asks for tickets assigned to the developer by default, and leaves the category to the source', async () => {
      await list();
      expect(h.tracker.lastQuery).toMatchObject({ mine: true });
      expect(h.tracker.lastQuery!.category).toBeUndefined();
    });

    it('ignores a category it does not know', async () => {
      await list('category=nonsense');
      expect(h.tracker.lastQuery!.category).toBeUndefined();
    });

    it('hides done tickets by default, and shows them when asked', async () => {
      h.tracker.add(ticket('acme/widgets#2', { status: 'closed', statusCategory: 'done' }));
      expect(keys((await list()).body)).toEqual([KEY]);
      expect(keys((await list('category=done')).body)).toEqual(['acme/widgets#2']);
      expect(keys((await list('category=all')).body).sort()).toEqual([KEY, 'acme/widgets#2']);
    });

    it("keeps each tracker's own status name beside the shared category", async () => {
      h.tracker.add(ticket('acme/widgets#2', { status: 'Triage', statusCategory: 'open' }));
      const page = (await list()).body as MergedTicketPage;
      expect(page.items.find((item) => item.key === 'acme/widgets#2')).toMatchObject({
        status: 'Triage',
        statusCategory: 'open',
      });
    });

    it('filters by source', async () => {
      const mixed = await seedWithBuiltInTicket();
      const builtIn = await list(`sourceId=${mixed.builtInSourceId}`, mixed.workspaceId);
      expect(keys(builtIn.body)).toEqual(['T-1']);
      expect(builtIn.body.sources).toHaveLength(1);

      const connected = await list(`sourceId=${mixed.sourceId}`, mixed.workspaceId);
      expect(keys(connected.body)).toEqual([KEY]);
    });

    it('filters every source by one category', async () => {
      const mixed = await seedWithBuiltInTicket();
      await h.api
        .patch(`/workspaces/${mixed.workspaceId}/built-in-tickets/T-1`)
        .send({ status: 'in_review' });
      const res = await list('category=in_progress', mixed.workspaceId);
      expect(keys(res.body)).toEqual(['T-1']);
    });

    it('says when a source could not limit tickets to the developer', async () => {
      h.tracker.source().mineApplied = false;
      const res = await list();
      expect(res.body.sources).toContainEqual({
        sourceId: seeded.sourceId,
        state: 'ok',
        message: null,
        mineApplied: false,
      });
    });

    it('leaves a disconnected source out', async () => {
      await h.api.delete(`/workspaces/${workspaceId}/sources/${seeded.sourceId}`);
      const res = await list();
      expect(res.body.items).toEqual([]);
      expect(res.body.sources.map((source: { sourceId: string }) => source.sourceId)).toEqual([
        seeded.builtInSourceId,
      ]);
    });

    it.each([
      ['an unknown workspace', () => list('', UNKNOWN)],
      ['a workspace ID that is not a UUID', () => list('', 'nope')],
      ['an unknown source', () => list(`sourceId=${UNKNOWN}`)],
      ['a source ID that is not a UUID', () => list('sourceId=nope')],
    ])('returns 404 for %s', async (_name, request) => {
      const res = await request();
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it("returns 404 for another workspace's source, and for a disconnected one", async () => {
      const other = (await h.api.post('/workspaces').send({ name: 'other' })).body.id;
      expect((await list(`sourceId=${seeded.sourceId}`, other)).status).toBe(404);

      await h.api.delete(`/workspaces/${workspaceId}/sources/${seeded.sourceId}`);
      expect((await list(`sourceId=${seeded.sourceId}`)).status).toBe(404);
    });

    it('never returns the server token', async () => {
      const res = await list('category=all&mine=false');
      expect(JSON.stringify(res.body)).not.toContain(CANARY_GITHUB_TOKEN);
    });
  });

  describe('paging', () => {
    /** 65 tickets in one source and 25 in another, interleaved by time. */
    const seedTwoSources = async () => {
      await linkSecondRepo(h, workspaceId);
      const gadgetsId = await connect('acme', 'gadgets');
      const widgets = h.tracker.source('acme/widgets');
      const gadgets = h.tracker.source('acme/gadgets');
      widgets.tickets.clear();
      widgets.pageSize = 7;
      for (let i = 0; i < 65; i += 1) {
        widgets.add(ticket(`acme/widgets#${i + 1}`, { updatedAt: minutesAgo(i * 2) }));
      }
      for (let i = 0; i < 25; i += 1) {
        gadgets.add(ticket(`acme/gadgets#${i + 1}`, { updatedAt: minutesAgo(i * 2 + 1) }));
      }
      return { gadgetsId, gadgets };
    };

    const walk = async (first: MergedTicketPage) => {
      const pages = [first];
      while (pages.at(-1)!.nextCursor) {
        const res = await list(`cursor=${encodeURIComponent(pages.at(-1)!.nextCursor!)}`);
        expect(res.status).toBe(200);
        pages.push(res.body);
        if (pages.length > 10) throw new Error('The merged list never ended.');
      }
      return pages;
    };

    it('pages through to the end in order, without losing or repeating a ticket', async () => {
      await seedTwoSources();
      const pages = await walk((await list()).body);
      const items = pages.flatMap((page) => page.items);

      expect(pages[0]!.items).toHaveLength(30);
      expect(items).toHaveLength(90);
      expect(new Set(items.map((item) => `${item.sourceId} ${item.key}`)).size).toBe(90);
      const times = items.map((item) => Date.parse(item.updatedAt));
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(pages[0]!.items.slice(0, 4).map((item) => item.key)).toEqual([
        'acme/widgets#1',
        'acme/gadgets#1',
        'acme/widgets#2',
        'acme/gadgets#2',
      ]);
    });

    it('keeps a failing source to its own status on a later page, and picks it up again after', async () => {
      const { gadgetsId, gadgets } = await seedTwoSources();
      const first = (await list()).body as MergedTicketPage;

      gadgets.failure = new TrackerUnavailableError('gadgets is down');
      const second = (await list(`cursor=${encodeURIComponent(first.nextCursor!)}`))
        .body as MergedTicketPage;
      expect(second.sources).toContainEqual(
        expect.objectContaining({
          sourceId: gadgetsId,
          state: 'unavailable',
          message: 'gadgets is down',
        }),
      );
      expect(second.sources).toContainEqual(
        expect.objectContaining({ sourceId: seeded.sourceId, state: 'ok' }),
      );
      expect(second.items.length).toBeGreaterThan(0);
      expect(second.items.every((item) => item.sourceId === seeded.sourceId)).toBe(true);
      expect(second.nextCursor).not.toBeNull();

      gadgets.failure = null;
      const rest = await walk(second);
      const all = [first, ...rest].flatMap((page) => page.items);
      expect(new Set(all.map((item) => `${item.sourceId} ${item.key}`)).size).toBe(90);
    });

    it('starts again from the top when given a cursor it did not issue', async () => {
      const res = await list('cursor=garbage!');
      expect(res.status).toBe(200);
      expect(keys(res.body)).toEqual([KEY]);
    });
  });

  describe('failure isolation', () => {
    it.each([
      ['auth_failed', new TrackerAuthError('rejected')],
      ['unavailable', new TrackerUnavailableError('down')],
    ] as const)(
      'reports a source that is %s on its own, while the others still list',
      async (state, failure) => {
        const mixed = await seedWithBuiltInTicket();
        h.tracker.failure = failure;

        const res = await list('', mixed.workspaceId);
        expect(res.status).toBe(200);
        expect(keys(res.body)).toEqual(['T-1']);
        expect(res.body.sources).toContainEqual({
          sourceId: mixed.sourceId,
          state,
          message: failure.message,
          mineApplied: true,
        });
        expect(res.body.sources).toContainEqual(
          expect.objectContaining({ sourceId: mixed.builtInSourceId, state: 'ok' }),
        );
      },
    );

    it('still returns 200 when every connected source fails', async () => {
      h.tracker.failure = new TrackerAuthError('rejected');
      const res = await list(`sourceId=${seeded.sourceId}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.sources).toEqual([
        { sourceId: seeded.sourceId, state: 'auth_failed', message: 'rejected', mineApplied: true },
      ]);
    });
  });

  describe('reading one ticket', () => {
    it('reads a ticket through its source and a URL-encoded key', async () => {
      const res = await h.api.get(ticketPath(seeded));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        sourceId: seeded.sourceId,
        key: KEY,
        body: `Body of ${KEY}`,
        status: 'open',
        statusCategory: 'open',
      });
    });

    it('reads a built-in ticket the same way, with no external page', async () => {
      const mixed = await seedWithBuiltInTicket();
      const res = await h.api.get(
        ticketPath({ workspaceId: mixed.workspaceId, sourceId: mixed.builtInSourceId }, 'T-1'),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ key: 'T-1', title: 'Built-in work', url: null, body: '' });
    });

    it.each([
      ['a missing ticket', () => ticketPath(seeded, 'acme/widgets#99')],
      ['an unknown source', () => ticketPath({ workspaceId, sourceId: UNKNOWN })],
      [
        'an unknown workspace',
        () => ticketPath({ workspaceId: UNKNOWN, sourceId: seeded.sourceId }),
      ],
      [
        "a connected source's key asked of the built-in tracker",
        () => ticketPath({ workspaceId, sourceId: seeded.builtInSourceId }),
      ],
    ])('returns 404 for %s', async (_name, path) => {
      const res = await h.api.get(path());
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it.each([
      ['TRACKER_AUTH_FAILED', new TrackerAuthError('rejected')],
      ['TRACKER_UNAVAILABLE', new TrackerUnavailableError('down')],
    ])('reports %s with a 502', async (code, failure) => {
      h.tracker.failure = failure;
      const res = await h.api.get(ticketPath(seeded));
      expect(res.status).toBe(502);
      expect(res.body.code).toBe(code);
    });

    it('reports a disconnected source', async () => {
      await h.api.delete(`/workspaces/${workspaceId}/sources/${seeded.sourceId}`);
      const res = await h.api.get(ticketPath(seeded));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SOURCE_DISCONNECTED');
    });
  });

  describe('routes that no longer exist, or do not exist yet', () => {
    it.each([
      [
        'the ticket route without a source',
        () => `/workspaces/${workspaceId}/tickets/${encodeURIComponent(KEY)}`,
      ],
      [
        'the session route without a source',
        () => `/workspaces/${workspaceId}/tickets/${encodeURIComponent(KEY)}/sessions`,
      ],
      ['repo-preselection', () => `${ticketPath(seeded)}/repo-preselection`],
      ['disconnected-tickets', () => `/workspaces/${workspaceId}/disconnected-tickets`],
    ])('returns 404 for %s', async (_name, path) => {
      const res = await h.api.get(path());
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });
});
