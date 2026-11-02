import { existsSync } from 'node:fs';
import { git } from './support/git';
import { TrackerAuthError, TrackerUnavailableError } from '../src/tickets/tracker';
import { resetDatabase } from './support/test-app';
import { createHarness, ENCODED_KEY, KEY, seedWorkspace, startSession, type Harness } from './support/session-harness';

describe('starting a session', () => {
  let h: Harness;
  let workspaceId: string;
  let clone: string;

  const post = (body: object, ws = workspaceId, key = ENCODED_KEY) =>
    h.api.post(`/workspaces/${ws}/tickets/${key}/sessions`).send(body);
  const history = async () => (await h.api.get(`/workspaces/${workspaceId}/tickets/${ENCODED_KEY}/sessions`)).body;

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.runtime.readiness = { ready: true };
    h.runtime.throwOnStart = null;
    h.tracker.tickets.clear();
    h.tracker.failure = null;
    ({ workspaceId, clone } = await seedWorkspace(h));
  });
  afterAll(() => h.close());

  it('records the session, creates its worktree, and starts the runtime there', async () => {
    const res = await post({ phase: 'investigation' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      workspaceId,
      ticketKey: KEY,
      phase: 'investigation',
      status: 'starting',
      statusReason: null,
      runtimeSessionId: null,
      resumeCommand: null,
      artifactStatus: null,
      endedAt: null,
      worktreeRemovedAt: null,
    });
    const shortId = res.body.id.slice(0, 8);
    expect(res.body.branch).toBe(`slop/acme-widgets-1/${shortId}`);
    expect(existsSync(res.body.worktreePath)).toBe(true);
    expect(git(res.body.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(res.body.branch);
    expect(h.runtime.lastRun.input).toMatchObject({
      cwd: res.body.worktreePath,
      setup: { permissionMode: 'auto' },
    });
  });

  it.each([
    ['investigation', '.slop/investigation.md'],
    ['planning', '.slop/plan.md'],
    ['implementation', '.slop/implementation-report.md'],
    ['code_review', '.slop/review-report.md'],
  ])('builds the %s brief from the ticket and its required artifact', async (phase, artifact) => {
    const session = await startSession(h, workspaceId, phase);
    expect(session.brief).toContain(`Title of ${KEY}`);
    expect(session.brief).toContain(`Body of ${KEY}`);
    expect(session.brief).toContain(artifact);
    expect((h.runtime.lastRun.input as { brief: string }).brief).toBe(session.brief);
  });

  it.each([['automated_testing'], ['e2e_testing'], ['nonsense'], [undefined]])(
    'rejects the phase %p and creates nothing',
    async (phase) => {
      const runs = h.runtime.runs.length;
      const res = await post({ phase });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(h.runtime.runs.length).toBe(runs);
      expect(await history()).toEqual([]);
    },
  );

  it('allows several sessions on one ticket, each with its own worktree', async () => {
    const first = await startSession(h, workspaceId);
    const second = await startSession(h, workspaceId);
    expect(second.worktreePath).not.toBe(first.worktreePath);
    expect((await history()).map((s: { id: string }) => s.id)).toEqual([second.id, first.id]);
  });

  it('is blocked when the workspace has no linked repo', async () => {
    const empty = (await h.api.post('/workspaces').send({ name: 'empty' })).body.id;
    const res = await post({ phase: 'investigation' }, empty);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_LINKED_REPO');
  });

  it('returns 404 for an unknown workspace, a missing ticket, or a key with no linked repo', async () => {
    expect((await post({ phase: 'investigation' }, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await post({ phase: 'investigation' }, workspaceId, encodeURIComponent('acme/widgets#99'))).status).toBe(404);
    expect((await post({ phase: 'investigation' }, workspaceId, encodeURIComponent('other/repo#1'))).status).toBe(404);
    expect(await history()).toEqual([]);
  });

  it.each([
    ['TRACKER_AUTH_FAILED', new TrackerAuthError('rejected')],
    ['TRACKER_UNAVAILABLE', new TrackerUnavailableError('down')],
  ])('reports %s and creates nothing', async (code, failure) => {
    h.tracker.failure = failure;
    const res = await post({ phase: 'investigation' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe(code);
    h.tracker.failure = null;
    expect(await history()).toEqual([]);
  });

  it('fails with the runtime message when it is not ready, creating no session or worktree', async () => {
    h.runtime.readiness = { ready: false, message: "Claude Code isn't signed in. Run `claude auth login`." };
    const res = await post({ phase: 'investigation' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      code: 'RUNTIME_NOT_READY',
      message: "Claude Code isn't signed in. Run `claude auth login`.",
    });
    expect(git(clone, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(await history()).toEqual([]);
  });

  it('records no session when git cannot create the worktree', async () => {
    git(clone, 'update-ref', '-d', 'refs/remotes/origin/main');
    const res = await post({ phase: 'investigation' });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('WORKTREE_CREATE_FAILED');
    expect(await history()).toEqual([]);
  });

});

describe('workspace isolation', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(resetDatabase);
  afterAll(() => h.close());

  it("returns 404 for another workspace's session on every session route", async () => {
    const { workspaceId } = await seedWorkspace(h, 'one');
    const session = await startSession(h, workspaceId);
    const other = (await h.api.post('/workspaces').send({ name: 'two' })).body.id;

    const base = `/workspaces/${other}/sessions/${session.id}`;
    expect((await h.api.get(base)).status).toBe(404);
    expect((await h.api.get(`${base}/artifact`)).status).toBe(404);
    expect((await h.api.post(`${base}/stop`)).status).toBe(404);
    expect((await h.api.delete(`${base}/worktree`)).status).toBe(404);
    expect(h.runtime.lastRun.stopCalls).toBe(0);

    const list = await h.api.get(`/workspaces/${other}/tickets/${ENCODED_KEY}/sessions`);
    expect(list.body).toEqual([]);
  });
});
