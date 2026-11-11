import type { MergedTicketPage, Ticket } from '@slop-control/shared';
import { makeClone } from './support/git';
import { createHarness, startSession, ticketPath, type Harness } from './support/session-harness';
import { resetDatabase } from './support/test-app';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('built-in tracker', () => {
  let h: Harness;
  let workspaceId: string;
  let builtInSourceId: string;

  const base = (ws = workspaceId) => `/workspaces/${ws}/built-in-tickets`;
  const create = (body: object, ws = workspaceId) => h.api.post(base(ws)).send(body);
  const update = (key: string, body: object, ws = workspaceId) =>
    h.api.patch(`${base(ws)}/${key}`).send(body);
  const list = async (query = '') =>
    (await h.api.get(`/workspaces/${workspaceId}/tickets${query ? `?${query}` : ''}`))
      .body as MergedTicketPage;
  const titles = async (query = '') => (await list(query)).items.map((item) => item.title);
  const connect = () =>
    h.api
      .post(`/workspaces/${workspaceId}/sources`)
      .send({ type: 'github_issues', githubOwner: 'acme', githubRepo: 'widgets' });

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.reset();
    workspaceId = (await h.api.post('/workspaces').send({ name: 'w' })).body.id;
    builtInSourceId = (await h.api.get(`/workspaces/${workspaceId}/sources`)).body[0].id;
  });
  afterAll(() => h.close());

  describe('creating', () => {
    it('creates a ticket with the next key and the status To do, with no setup', async () => {
      const res = await create({ title: '  Fix the login  ', body: '# Steps\n\n1. Log in' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        sourceId: builtInSourceId,
        key: 'T-1',
        title: 'Fix the login',
        body: '# Steps\n\n1. Log in',
        status: 'To do',
        statusCategory: 'open',
        url: null,
      });
      expect((await create({ title: 'Second' })).body).toMatchObject({ key: 'T-2', body: '' });
    });

    it('gives tickets created at once their own keys', async () => {
      const created = await Promise.all(
        Array.from({ length: 6 }, (_, index) => create({ title: `Ticket ${index}` })),
      );
      expect(created.every((res) => res.status === 201)).toBe(true);
      expect(created.map((res) => res.body.key).sort()).toEqual(
        ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6'].sort(),
      );
    });

    it('numbers each workspace on its own', async () => {
      await create({ title: 'One' });
      const other = (await h.api.post('/workspaces').send({ name: 'other' })).body.id;
      expect((await create({ title: 'One there' }, other)).body.key).toBe('T-1');
    });

    it.each([
      [{}],
      [{ title: '' }],
      [{ title: '   ' }],
      [{ title: 42 }],
      [{ title: 'x', body: 7 }],
    ])('rejects %p', async (body) => {
      const res = await create(body);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect((await list('category=all')).items).toEqual([]);
    });

    it('returns 404 for an unknown workspace', async () => {
      expect((await create({ title: 'x' }, UNKNOWN)).status).toBe(404);
      expect((await create({ title: 'x' }, 'not-a-uuid')).status).toBe(404);
    });
  });

  describe('editing', () => {
    beforeEach(async () => {
      await create({ title: 'Original', body: 'Original body' });
    });

    it('changes the title and body, and leaves what is not sent', async () => {
      const res = await update('T-1', { title: 'Renamed' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ key: 'T-1', title: 'Renamed', body: 'Original body' });
      expect((await update('T-1', { body: '' })).body).toMatchObject({
        title: 'Renamed',
        body: '',
      });
    });

    it.each([
      ['todo', 'To do', 'open'],
      ['in_progress', 'In progress', 'in_progress'],
      ['in_review', 'In review', 'in_progress'],
      ['done', 'Done', 'done'],
      ['cancelled', 'Cancelled', 'done'],
    ])('sets the status %s, shown as %s in the category %s', async (status, label, category) => {
      const res = await update('T-1', { status });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: label, statusCategory: category });
    });

    it('moves the ticket to the top of the list', async () => {
      await create({ title: 'Newer' });
      expect(await titles()).toEqual(['Newer', 'Original']);
      await update('T-1', { title: 'Original, touched' });
      expect(await titles()).toEqual(['Original, touched', 'Newer']);
    });

    it.each([[{ title: '  ' }], [{ status: 'blocked' }], [{ status: 'To do' }], [{ body: 5 }]])(
      'rejects %p and changes nothing',
      async (body) => {
        const res = await update('T-1', body);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        const read = await h.api.get(ticketPath({ workspaceId, sourceId: builtInSourceId }, 'T-1'));
        expect(read.body).toMatchObject({ title: 'Original', status: 'To do' });
      },
    );

    it.each([['T-99'], ['T-0'], ['acme%2Fwidgets%231'], ['T-1abc']])(
      'returns 404 for the key %s',
      async (key) => {
        const res = await update(key, { title: 'x' });
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
      },
    );

    it('returns 404 through another workspace, which has no such ticket', async () => {
      const other = (await h.api.post('/workspaces').send({ name: 'other' })).body.id;
      expect((await update('T-1', { title: 'stolen' }, other)).status).toBe(404);
      expect((await h.api.get(`${base(other)}/T-1/comments`)).status).toBe(404);
      const read = await h.api.get(
        ticketPath({ workspaceId: other, sourceId: builtInSourceId }, 'T-1'),
      );
      expect(read.status).toBe(404);
    });
  });

  describe('comments', () => {
    const comments = (key = 'T-1') => `${base()}/${key}/comments`;
    beforeEach(async () => {
      await create({ title: 'Commented' });
    });

    it('adds comments and lists them oldest first', async () => {
      expect((await h.api.get(comments())).body).toEqual([]);
      const first = await h.api.post(comments()).send({ body: 'First note' });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ body: 'First note' });
      await h.api.post(comments()).send({ body: 'Second note' });

      const listed = await h.api.get(comments());
      expect(listed.status).toBe(200);
      expect(listed.body.map((comment: { body: string }) => comment.body)).toEqual([
        'First note',
        'Second note',
      ]);
      expect(listed.body[0]).toEqual(first.body);
    });

    it("updates the ticket's updatedAt", async () => {
      const read = () => h.api.get(ticketPath({ workspaceId, sourceId: builtInSourceId }, 'T-1'));
      const before = (await read()).body as Ticket;
      await h.api.post(comments()).send({ body: 'A note' });
      const after = (await read()).body as Ticket;
      expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
    });

    it("isn't part of the ticket's body, so it doesn't reach a session's brief", async () => {
      await h.api.post(comments()).send({ body: 'COMMENT-ONLY-TEXT' });
      const read = await h.api.get(ticketPath({ workspaceId, sourceId: builtInSourceId }, 'T-1'));
      expect(JSON.stringify(read.body)).not.toContain('COMMENT-ONLY-TEXT');
    });

    it.each([[{}], [{ body: '' }], [{ body: '   ' }], [{ body: 3 }]])(
      'rejects %p',
      async (body) => {
        const res = await h.api.post(comments()).send(body);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect((await h.api.get(comments())).body).toEqual([]);
      },
    );

    it('returns 404 for an unknown ticket or workspace', async () => {
      expect((await h.api.get(comments('T-99'))).status).toBe(404);
      expect((await h.api.post(comments('T-99')).send({ body: 'x' })).status).toBe(404);
      expect((await h.api.get(`${base(UNKNOWN)}/T-1/comments`)).status).toBe(404);
    });
  });

  describe('in the ticket list', () => {
    beforeEach(async () => {
      await create({ title: 'Login is broken', body: 'The password form rejects everyone.' });
      await create({ title: 'Add dark mode', body: 'For the settings page.' });
      await create({ title: 'Old chore' });
      await create({ title: 'Dropped idea' });
      await create({ title: 'In flight' });
      await update('T-3', { status: 'done' });
      await update('T-4', { status: 'cancelled' });
      await update('T-5', { status: 'in_progress' });
    });

    it('hides done and cancelled tickets by default', async () => {
      expect((await titles()).sort()).toEqual(['Add dark mode', 'In flight', 'Login is broken']);
    });

    it.each([
      ['open', ['Add dark mode', 'Login is broken']],
      ['in_progress', ['In flight']],
      ['done', ['Dropped idea', 'Old chore']],
      ['all', ['Add dark mode', 'Dropped idea', 'In flight', 'Login is broken', 'Old chore']],
    ])('filters by the category %s', async (category, expected) => {
      expect((await titles(`category=${category}`)).sort()).toEqual(expected);
    });

    it('searches titles and bodies, whatever the case', async () => {
      expect(await titles('search=LOGIN')).toEqual(['Login is broken']);
      expect(await titles('search=settings')).toEqual(['Add dark mode']);
      expect(await titles('search=nothing-matches')).toEqual([]);
    });

    it('treats search text as text, not as a pattern', async () => {
      expect(await titles('search=%25')).toEqual([]);
      expect(await titles('search=_')).toEqual([]);
    });

    it('ignores the assigned-to-me filter, and counts it as applied', async () => {
      const page = await list('mine=true');
      expect(page.items).toHaveLength(3);
      expect(page.sources).toEqual([
        { sourceId: builtInSourceId, state: 'ok', message: null, mineApplied: true },
      ]);
    });

    it('pages past thirty tickets', async () => {
      for (let i = 0; i < 30; i += 1) await create({ title: `Bulk ${i}` });
      const first = await list();
      expect(first.items).toHaveLength(30);
      expect(first.nextCursor).not.toBeNull();
      const second = await list(`cursor=${encodeURIComponent(first.nextCursor!)}`);
      expect(second.items).toHaveLength(3);
      expect(second.nextCursor).toBeNull();
      const all = [...first.items, ...second.items].map((item) => item.key);
      expect(new Set(all).size).toBe(33);
    });
  });

  describe('sessions', () => {
    beforeEach(async () => {
      await h.api.post(`/workspaces/${workspaceId}/repos`).send({ localPath: makeClone() });
      await create({ title: 'Built-in work', body: 'Do the built-in thing.' });
    });

    it('starts a session on a built-in ticket like any other, with no source setup', async () => {
      const session = await startSession(
        h,
        { workspaceId, sourceId: builtInSourceId },
        'investigation',
        {
          key: 'T-1',
        },
      );
      expect(session).toMatchObject({
        ticketSourceId: builtInSourceId,
        ticketKey: 'T-1',
        ticketTitle: 'Built-in work',
        branch: `slop/T-1/${session.id.slice(0, 8)}`,
      });
      expect(session.brief).toContain('Built-in work');
      expect(session.brief).toContain('Do the built-in thing.');
    });

    it('keeps the sessions of a ticket that was cancelled', async () => {
      const ref = { workspaceId, sourceId: builtInSourceId };
      const session = await startSession(h, ref, 'investigation', { key: 'T-1' });
      await update('T-1', { status: 'cancelled' });

      const history = await h.api.get(`${ticketPath(ref, 'T-1')}/sessions`);
      expect(history.body.map((item: { id: string }) => item.id)).toEqual([session.id]);
      expect((await h.api.get(ticketPath(ref, 'T-1'))).body.status).toBe('Cancelled');
    });

    it('returns 404 when starting on a built-in ticket that does not exist', async () => {
      const res = await h.api
        .post(`${ticketPath({ workspaceId, sourceId: builtInSourceId }, 'T-99')}/sessions`)
        .send({ phase: 'investigation' });
      expect(res.status).toBe(404);
    });
  });

  describe('alongside a connected source', () => {
    beforeEach(async () => {
      await create({ title: 'Before connecting' });
    });

    it('turns creation off while a source is connected, and back on after the last disconnect', async () => {
      const sourceId = (await connect()).body.id;
      const refused = await create({ title: 'After connecting' });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('BUILT_IN_CREATION_OFF');

      await h.api.delete(`/workspaces/${workspaceId}/sources/${sourceId}`);
      const allowed = await create({ title: 'After disconnecting' });
      expect(allowed.status).toBe(201);
      // The refused attempt didn't use up a key.
      expect(allowed.body.key).toBe('T-2');
    });

    it('stays off until every connected source is gone', async () => {
      const first = (await connect()).body.id;
      const second = (
        await h.api
          .post(`/workspaces/${workspaceId}/sources`)
          .send({ type: 'github_issues', githubOwner: 'acme', githubRepo: 'gadgets' })
      ).body.id;
      await h.api.delete(`/workspaces/${workspaceId}/sources/${first}`);
      expect((await create({ title: 'x' })).status).toBe(409);
      await h.api.delete(`/workspaces/${workspaceId}/sources/${second}`);
      expect((await create({ title: 'x' })).status).toBe(201);
    });

    it('still validates before refusing', async () => {
      await connect();
      expect((await create({ title: '' })).status).toBe(422);
    });

    it('keeps existing tickets listed, editable, and open to comments', async () => {
      await connect();
      h.tracker.tickets.clear();
      expect(await titles()).toEqual(['Before connecting']);
      expect((await update('T-1', { title: 'Edited', status: 'in_progress' })).status).toBe(200);
      const comment = await h.api.post(`${base()}/T-1/comments`).send({ body: 'Still here' });
      expect(comment.status).toBe(201);
    });

    it("doesn't affect another workspace's built-in tracker", async () => {
      await connect();
      const other = (await h.api.post('/workspaces').send({ name: 'other' })).body.id;
      expect((await create({ title: 'Free to create' }, other)).status).toBe(201);
    });
  });
});
