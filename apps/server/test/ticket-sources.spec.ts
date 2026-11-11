import type { Session, TicketSource } from '@slop-control/shared';
import { existsSync } from 'node:fs';
import { TrackerAuthError, TrackerUnavailableError } from '../src/tickets/tracker';
import { ticket } from './support/fake-tracker';
import { makeClone } from './support/git';
import {
  createHarness,
  KEY,
  linkSecondRepo,
  reportStarted,
  seedWorkspace,
  startSession,
  ticketPath,
  waitForSession,
  type Harness,
  type Seeded,
} from './support/session-harness';
import { resetDatabase } from './support/test-app';
import { CANARY_GITHUB_TOKEN } from './support/test-env';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const GADGETS = { type: 'github_issues', githubOwner: 'acme', githubRepo: 'gadgets' };

describe('ticket sources', () => {
  let h: Harness;
  let workspaceId: string;

  const sourcesPath = (ws = workspaceId) => `/workspaces/${ws}/sources`;
  const sources = async (ws = workspaceId) =>
    (await h.api.get(sourcesPath(ws))).body as TicketSource[];
  const connect = (body: unknown, ws = workspaceId) =>
    h.api.post(sourcesPath(ws)).send(body as object);
  const linkRepo = async (origin = 'git@github.com:acme/widgets.git') =>
    (
      await h.api
        .post(`/workspaces/${workspaceId}/repos`)
        .send({ localPath: makeClone({ origin }) })
    ).body.id as string;

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.reset();
    workspaceId = (await h.api.post('/workspaces').send({ name: 'w' })).body.id;
  });
  afterAll(() => h.close());

  describe('a new workspace', () => {
    it('has the built-in tracker and nothing else', async () => {
      const res = await h.api.get(sourcesPath());
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        {
          id: expect.any(String),
          workspaceId,
          type: 'built_in',
          label: 'Built-in',
          scope: null,
          hasCredential: false,
          defaultLinkedRepoId: null,
          canCreateTickets: true,
          disconnectedAt: null,
          createdAt: expect.any(String),
        },
      ]);
    });

    it("doesn't get a source from linking a repo", async () => {
      await linkRepo();
      expect((await sources()).map((source) => source.type)).toEqual(['built_in']);
      expect(h.tracker.source().calls.verify).toBe(0);
    });

    it('returns 404 for an unknown workspace', async () => {
      expect((await h.api.get(sourcesPath(UNKNOWN))).status).toBe(404);
      expect((await h.api.get(sourcesPath('nope'))).status).toBe(404);
    });
  });

  describe('connecting', () => {
    it("connects a repo's Issues by owner and name, without linking it", async () => {
      const res = await connect(GADGETS);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        workspaceId,
        type: 'github_issues',
        label: 'acme/gadgets',
        scope: { githubOwner: 'acme', githubRepo: 'gadgets' },
        hasCredential: false,
        defaultLinkedRepoId: null,
        canCreateTickets: false,
        disconnectedAt: null,
      });
      expect(h.tracker.source('acme/gadgets').calls.verify).toBe(1);

      const listed = await sources();
      expect(listed.map((source) => source.label)).toEqual(['Built-in', 'acme/gadgets']);
      expect(listed[0]!.canCreateTickets).toBe(false);
      expect(listed[1]).toEqual(res.body);
    });

    it('connects several sources, with a default repo when given one', async () => {
      const repoId = await linkRepo();
      const widgets = await connect({
        type: 'github_issues',
        githubOwner: 'acme',
        githubRepo: 'widgets',
        defaultLinkedRepoId: repoId,
      });
      expect(widgets.status).toBe(201);
      expect(widgets.body.defaultLinkedRepoId).toBe(repoId);
      expect((await connect(GADGETS)).status).toBe(201);
      expect(await sources()).toHaveLength(3);
    });

    it.each([
      [
        'a Jira source',
        {
          type: 'jira',
          jiraSite: 'https://acme.atlassian.net',
          jiraProject: 'BF',
          jiraEmail: 'a@b.c',
          token: 'x',
        },
      ],
      ['an unknown type', { type: 'linear' }],
      ['the built-in type', { type: 'built_in' }],
      ['no type', { githubOwner: 'acme', githubRepo: 'gadgets' }],
      ['no owner', { type: 'github_issues', githubRepo: 'gadgets' }],
      ['no repo', { type: 'github_issues', githubOwner: 'acme' }],
      ['a blank owner', { ...GADGETS, githubOwner: '  ' }],
      ['an owner with a path in it', { ...GADGETS, githubOwner: 'acme/evil' }],
      ['a repo with a path in it', { ...GADGETS, githubRepo: '../other' }],
      ['a token', { ...GADGETS, token: 'ghp_per_source_token' }],
      ['a default repo that is not a string', { ...GADGETS, defaultLinkedRepoId: 5 }],
      ['a body that is not an object', ['github_issues']],
    ])('rejects %s with a 422 and saves nothing', async (_name, body) => {
      const res = await connect(body);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(await sources()).toHaveLength(1);
      expect(h.tracker.source('acme/gadgets').calls.verify).toBe(0);
    });

    it('returns 404 for a default repo that is unknown or in another workspace', async () => {
      const other = (await h.api.post('/workspaces').send({ name: 'other' })).body.id;
      const theirs = (
        await h.api.post(`/workspaces/${other}/repos`).send({ localPath: makeClone() })
      ).body.id;
      for (const defaultLinkedRepoId of [UNKNOWN, theirs, 'not-a-uuid']) {
        const res = await connect({ ...GADGETS, defaultLinkedRepoId });
        expect(res.status).toBe(404);
      }
      expect(await sources()).toHaveLength(1);
    });

    it.each([
      [
        'TRACKER_AUTH_FAILED',
        new TrackerAuthError("GitHub can't show acme/gadgets to this token."),
      ],
      ['TRACKER_UNAVAILABLE', new TrackerUnavailableError("GitHub can't be reached.")],
    ])('checks the source first, and saves nothing on %s', async (code, failure) => {
      h.tracker.source('acme/gadgets').verifyFailure = failure;
      const res = await connect(GADGETS);
      expect(res.status).toBe(502);
      expect(res.body).toEqual({ code, message: failure.message });
      expect(await sources()).toHaveLength(1);
      expect((await sources())[0]!.canCreateTickets).toBe(true);
    });

    it('refuses a source that is already connected, whatever the letter case', async () => {
      await connect(GADGETS);
      const res = await connect({ ...GADGETS, githubOwner: 'ACME', githubRepo: 'Gadgets' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SOURCE_ALREADY_CONNECTED');
      expect(await sources()).toHaveLength(2);
    });

    it('lets two workspaces connect the same repo, each with its own source', async () => {
      const other = (await h.api.post('/workspaces').send({ name: 'other' })).body.id;
      const mine = await connect(GADGETS);
      const theirs = await connect(GADGETS, other);
      expect(theirs.status).toBe(201);
      expect(theirs.body.id).not.toBe(mine.body.id);
    });

    it('returns 404 for an unknown workspace', async () => {
      expect((await connect(GADGETS, UNKNOWN)).status).toBe(404);
    });

    it('never returns the server token, which is the only credential in play', async () => {
      const res = await connect(GADGETS);
      expect(JSON.stringify(res.body)).not.toContain(CANARY_GITHUB_TOKEN);
      expect(JSON.stringify(await sources())).not.toContain(CANARY_GITHUB_TOKEN);
      expect((await sources()).every((source) => source.hasCredential === false)).toBe(true);
    });
  });

  describe('updating', () => {
    let sourceId: string;
    let repoId: string;
    const patch = (body: unknown, id = sourceId, ws = workspaceId) =>
      h.api.patch(`${sourcesPath(ws)}/${id}`).send(body as object);

    beforeEach(async () => {
      repoId = await linkRepo();
      sourceId = (await connect(GADGETS)).body.id;
    });

    it('sets and clears the default repo', async () => {
      const set = await patch({ defaultLinkedRepoId: repoId });
      expect(set.status).toBe(200);
      expect(set.body.defaultLinkedRepoId).toBe(repoId);
      expect((await patch({})).body.defaultLinkedRepoId).toBe(repoId);
      expect((await patch({ defaultLinkedRepoId: null })).body.defaultLinkedRepoId).toBeNull();
    });

    it.each([
      ['a token', { token: 'ghp_new' }],
      ['a token beside a valid field', { token: 'ghp_new', defaultLinkedRepoId: null }],
      ['a default repo that is not a string', { defaultLinkedRepoId: 7 }],
      ['a body that is not an object', []],
    ])('rejects %s with a 422', async (_name, body) => {
      await patch({ defaultLinkedRepoId: repoId });
      const res = await patch(body);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      const source = (await sources()).find((item) => item.id === sourceId)!;
      expect(source).toMatchObject({ defaultLinkedRepoId: repoId, hasCredential: false });
    });

    it('returns 404 for an unknown source, workspace, or default repo', async () => {
      expect((await patch({ defaultLinkedRepoId: null }, UNKNOWN)).status).toBe(404);
      expect((await patch({ defaultLinkedRepoId: null }, sourceId, UNKNOWN)).status).toBe(404);
      expect((await patch({ defaultLinkedRepoId: UNKNOWN })).status).toBe(404);
    });

    it("can't change the built-in tracker", async () => {
      const builtIn = (await sources())[0]!;
      const res = await patch({ defaultLinkedRepoId: repoId }, builtIn.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('BUILT_IN_SOURCE_FIXED');
    });

    it("can't change a disconnected source", async () => {
      await h.api.delete(`${sourcesPath()}/${sourceId}`);
      const res = await patch({ defaultLinkedRepoId: repoId });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SOURCE_DISCONNECTED');
    });
  });

  describe('disconnecting', () => {
    let seeded: Seeded;
    const disconnect = (id = seeded.sourceId, ws = workspaceId) =>
      h.api.delete(`${sourcesPath(ws)}/${id}`);

    beforeEach(async () => {
      await resetDatabase();
      seeded = await seedWorkspace(h);
      workspaceId = seeded.workspaceId;
    });

    it('marks the source disconnected and keeps its row; repeating changes nothing', async () => {
      const res = await disconnect();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: seeded.sourceId, label: 'acme/widgets' });
      expect(res.body.disconnectedAt).not.toBeNull();

      const again = await disconnect();
      expect(again.status).toBe(200);
      expect(again.body).toEqual(res.body);
      expect((await sources()).map((source) => source.id)).toContain(seeded.sourceId);
    });

    it("can't disconnect the built-in tracker", async () => {
      const res = await disconnect(seeded.builtInSourceId);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('BUILT_IN_SOURCE_FIXED');
    });

    it('returns 404 for an unknown source or workspace', async () => {
      expect((await disconnect(UNKNOWN)).status).toBe(404);
      expect((await disconnect(seeded.sourceId, UNKNOWN)).status).toBe(404);
    });

    it('blocks reads and new sessions on its tickets, without calling the tracker', async () => {
      await disconnect();
      const calls = { ...h.tracker.source().calls };

      const read = await h.api.get(ticketPath(seeded));
      expect(read.status).toBe(409);
      expect(read.body.code).toBe('SOURCE_DISCONNECTED');

      const runs = h.runtime.runs.length;
      const start = await h.api
        .post(`${ticketPath(seeded)}/sessions`)
        .send({ phase: 'investigation' });
      expect(start.status).toBe(409);
      expect(start.body.code).toBe('SOURCE_DISCONNECTED');
      expect(h.runtime.runs.length).toBe(runs);
      expect(h.tracker.source().calls).toEqual(calls);
    });

    it('keeps its sessions and artifacts, and still lets them be stopped and cleaned up', async () => {
      const finished = await startSession(h, seeded);
      reportStarted(h.runtime.lastRun);
      h.runtime.lastRun.writeFile('.slop/investigation.md', '# findings');
      h.runtime.lastRun.ended('success');
      await waitForSession(h, finished, (session) => session.status === 'ended');
      const running = await startSession(h, seeded);
      const run = h.runtime.lastRun;
      reportStarted(run);

      await disconnect();

      const history = await h.api.get(`${ticketPath(seeded)}/sessions`);
      expect(history.status).toBe(200);
      expect(history.body.map((session: Session) => session.id)).toEqual([running.id, finished.id]);
      const base = `/workspaces/${workspaceId}/sessions`;
      expect((await h.api.get(`${base}/${finished.id}`)).status).toBe(200);
      expect((await h.api.get(`${base}/${finished.id}/artifact`)).body.markdown).toBe('# findings');

      const stopped = await h.api.post(`${base}/${running.id}/stop`);
      expect(stopped.status).toBe(200);
      expect(run.stopCalls).toBe(1);
      await waitForSession(h, running, (session) => session.status === 'stopped');

      const removed = await h.api.delete(`${base}/${finished.id}/worktree`);
      expect(removed.status).toBe(200);
      expect(existsSync(finished.worktreePath)).toBe(false);
    });

    it('restores the same source, with its sessions, when the repo is connected again', async () => {
      const session = await startSession(h, seeded);
      await disconnect();

      const res = await connect({
        type: 'github_issues',
        githubOwner: 'Acme',
        githubRepo: 'Widgets',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: seeded.sourceId, disconnectedAt: null });
      expect(await sources()).toHaveLength(2);

      expect((await h.api.get(ticketPath(seeded))).status).toBe(200);
      const history = await h.api.get(`${ticketPath(seeded)}/sessions`);
      expect(history.body.map((item: Session) => item.id)).toEqual([session.id]);
    });

    it('checks the source again before reconnecting it', async () => {
      await disconnect();
      h.tracker.source().verifyFailure = new TrackerAuthError('rejected');
      expect(
        (await connect({ type: 'github_issues', githubOwner: 'acme', githubRepo: 'widgets' }))
          .status,
      ).toBe(502);
      const source = (await sources()).find((item) => item.id === seeded.sourceId)!;
      expect(source.disconnectedAt).not.toBeNull();
    });
  });

  describe('identity', () => {
    it('keeps the same key in two sources as two tickets, with separate sessions', async () => {
      const seeded = await (async () => {
        await resetDatabase();
        return seedWorkspace(h);
      })();
      workspaceId = seeded.workspaceId;
      const gadgetsId = (await connect(GADGETS)).body.id as string;
      h.tracker.source('acme/widgets').add(ticket('SHARED-1', { title: 'In widgets' }));
      h.tracker.source('acme/gadgets').add(ticket('SHARED-1', { title: 'In gadgets' }));
      const inWidgets = { workspaceId, sourceId: seeded.sourceId };
      const inGadgets = { workspaceId, sourceId: gadgetsId };

      expect((await h.api.get(ticketPath(inWidgets, 'SHARED-1'))).body.title).toBe('In widgets');
      expect((await h.api.get(ticketPath(inGadgets, 'SHARED-1'))).body.title).toBe('In gadgets');

      const first = await startSession(h, inWidgets, 'investigation', { key: 'SHARED-1' });
      const second = await startSession(h, inGadgets, 'investigation', { key: 'SHARED-1' });
      expect(first).toMatchObject({ ticketSourceId: seeded.sourceId, ticketTitle: 'In widgets' });
      expect(second).toMatchObject({ ticketSourceId: gadgetsId, ticketTitle: 'In gadgets' });

      const historyOf = async (ref: typeof inWidgets) =>
        ((await h.api.get(`${ticketPath(ref, 'SHARED-1')}/sessions`)).body as Session[]).map(
          (session) => session.id,
        );
      expect(await historyOf(inWidgets)).toEqual([first.id]);
      expect(await historyOf(inGadgets)).toEqual([second.id]);
    });
  });

  describe('isolation', () => {
    it("returns 404 for one workspace's source through another", async () => {
      const seeded = await (async () => {
        await resetDatabase();
        return seedWorkspace(h, 'one');
      })();
      const other = (await h.api.post('/workspaces').send({ name: 'two' })).body.id;
      const theirs = { workspaceId: other, sourceId: seeded.sourceId };

      expect((await h.api.get(ticketPath(theirs))).status).toBe(404);
      expect((await h.api.get(`${ticketPath(theirs)}/sessions`)).status).toBe(404);
      expect(
        (await h.api.post(`${ticketPath(theirs)}/sessions`).send({ phase: 'investigation' }))
          .status,
      ).toBe(404);
      expect(
        (
          await h.api
            .patch(`${sourcesPath(other)}/${seeded.sourceId}`)
            .send({ defaultLinkedRepoId: null })
        ).status,
      ).toBe(404);
      expect((await h.api.delete(`${sourcesPath(other)}/${seeded.sourceId}`)).status).toBe(404);
      expect((await sources(other)).map((source) => source.type)).toEqual(['built_in']);
      expect(
        (await sources(seeded.workspaceId)).find((s) => s.id === seeded.sourceId)!.disconnectedAt,
      ).toBeNull();
    });
  });

  describe('choosing the repo for a session', () => {
    let seeded: Seeded;
    /** A source that matches no linked repo, so only the later steps of the order can resolve it. */
    let elsewhere: { workspaceId: string; sourceId: string };
    const start = (
      ref: { workspaceId: string; sourceId: string },
      key: string,
      body: object = {},
    ) => h.api.post(`${ticketPath(ref, key)}/sessions`).send({ phase: 'investigation', ...body });

    beforeEach(async () => {
      await resetDatabase();
      seeded = await seedWorkspace(h);
      workspaceId = seeded.workspaceId;
      const sourceId = (
        await connect({ type: 'github_issues', githubOwner: 'other', githubRepo: 'thing' })
      ).body.id as string;
      elsewhere = { workspaceId, sourceId };
      h.tracker.source('other/thing').add(ticket('other/thing#7'));
    });

    it('uses the only linked repo when nothing else decides', async () => {
      const res = await start(elsewhere, 'other/thing#7');
      expect(res.status).toBe(201);
      expect(res.body.linkedRepoId).toBe(seeded.repoId);
    });

    it("uses the linked clone of a GitHub Issues source's own repo, the oldest of several", async () => {
      await linkSecondRepo(h, workspaceId);
      await linkSecondRepo(h, workspaceId, 'https://github.com/Acme/Widgets.git');
      const res = await start(seeded, KEY);
      expect(res.status).toBe(201);
      expect(res.body.linkedRepoId).toBe(seeded.repoId);
    });

    it("uses the source's default repo ahead of a matching clone", async () => {
      const gadgets = await linkSecondRepo(h, workspaceId);
      await h.api
        .patch(`${sourcesPath()}/${seeded.sourceId}`)
        .send({ defaultLinkedRepoId: gadgets.repoId });
      expect((await start(seeded, KEY)).body.linkedRepoId).toBe(gadgets.repoId);
    });

    it("uses the repo of the ticket's most recent session ahead of the source's default", async () => {
      const gadgets = await linkSecondRepo(h, workspaceId);
      const third = await linkSecondRepo(h, workspaceId, 'git@github.com:acme/third.git');
      await h.api
        .patch(`${sourcesPath()}/${elsewhere.sourceId}`)
        .send({ defaultLinkedRepoId: gadgets.repoId });
      expect((await start(elsewhere, 'other/thing#7')).body.linkedRepoId).toBe(gadgets.repoId);

      await start(elsewhere, 'other/thing#7', { linkedRepoId: third.repoId });
      expect((await start(elsewhere, 'other/thing#7')).body.linkedRepoId).toBe(third.repoId);
    });

    it("doesn't carry one ticket's last repo over to another ticket", async () => {
      const gadgets = await linkSecondRepo(h, workspaceId);
      h.tracker.add(ticket('acme/widgets#2'));
      await start(seeded, KEY, { linkedRepoId: gadgets.repoId });
      expect((await start(seeded, 'acme/widgets#2')).body.linkedRepoId).toBe(seeded.repoId);
    });

    it('uses the repo from the request ahead of everything', async () => {
      const gadgets = await linkSecondRepo(h, workspaceId);
      const res = await start(seeded, KEY, { linkedRepoId: gadgets.repoId });
      expect(res.status).toBe(201);
      expect(res.body.linkedRepoId).toBe(gadgets.repoId);
      expect(res.body.worktreePath).toBeTruthy();
    });

    it('asks for a choice when no repo can be preselected, and creates nothing', async () => {
      await linkSecondRepo(h, workspaceId);
      const runs = h.runtime.runs.length;
      const res = await start(elsewhere, 'other/thing#7');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('REPO_CHOICE_REQUIRED');
      expect(h.runtime.runs.length).toBe(runs);
      expect((await h.api.get(`${ticketPath(elsewhere, 'other/thing#7')}/sessions`)).body).toEqual(
        [],
      );
    });

    it('returns 404 for a repo that is unknown or linked to another workspace', async () => {
      const other = (await h.api.post('/workspaces').send({ name: 'other' })).body.id;
      const theirs = (
        await h.api.post(`/workspaces/${other}/repos`).send({ localPath: makeClone() })
      ).body.id;
      for (const linkedRepoId of [UNKNOWN, theirs]) {
        const res = await start(seeded, KEY, { linkedRepoId });
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
      }
      expect((await h.api.get(`${ticketPath(seeded)}/sessions`)).body).toEqual([]);
    });

    it('rejects a repo that is not a string', async () => {
      const res = await start(seeded, KEY, { linkedRepoId: 5 });
      expect(res.status).toBe(422);
    });

    it('is blocked with no linked repo at all', async () => {
      const empty = (await h.api.post('/workspaces').send({ name: 'empty' })).body.id;
      await h.api.post(`/workspaces/${empty}/built-in-tickets`).send({ title: 'No repo yet' });
      const builtIn = (await sources(empty))[0]!;
      const res = await start({ workspaceId: empty, sourceId: builtIn.id }, 'T-1');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NO_LINKED_REPO');
    });

    it("shows each session's repo and source in the ticket's history", async () => {
      const gadgets = await linkSecondRepo(h, workspaceId);
      await start(seeded, KEY);
      await start(seeded, KEY, { linkedRepoId: gadgets.repoId });
      const history = (await h.api.get(`${ticketPath(seeded)}/sessions`)).body as Session[];
      expect(history.map((session) => session.linkedRepoId)).toEqual([
        gadgets.repoId,
        seeded.repoId,
      ]);
      expect(history.every((session) => session.ticketSourceId === seeded.sourceId)).toBe(true);
      expect(history.every((session) => session.ticketTitle === `Title of ${KEY}`)).toBe(true);
    });
  });
});
