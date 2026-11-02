import { TrackerAdapterFactory, TrackerAuthError, TrackerUnavailableError } from '../src/tickets/tracker';
import { FakeTracker, ticket } from './support/fake-tracker';
import { makeClone } from './support/git';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app';

const KEY = 'acme/widgets#1';
const ENCODED = encodeURIComponent(KEY);
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('tickets', () => {
  let t: TestApp;
  let tracker: FakeTracker;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    tracker = new FakeTracker();
    t = await createTestApp({ overrides: [[TrackerAdapterFactory, tracker]] });
  });
  beforeEach(async () => {
    await resetDatabase();
    tracker.tickets.clear();
    tracker.failure = null;
    tracker.add(ticket(KEY));
    workspaceId = (await t.api.post('/workspaces').send({ name: 'w' })).body.id;
    repoId = (await t.api.post(`/workspaces/${workspaceId}/repos`).send({ localPath: makeClone() })).body.id;
  });
  afterAll(() => t.close());

  it("lists a linked repo's tickets, passing the query through", async () => {
    const res = await t.api.get(
      `/workspaces/${workspaceId}/tickets?linkedRepoId=${repoId}&search=login&state=closed&cursor=abc`,
    );
    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { key: string }) => item.key)).toEqual([KEY]);
    expect(res.body.nextCursor).toBeNull();
    expect(tracker.lastQuery).toEqual({ search: 'login', state: 'closed', cursor: 'abc' });
  });

  it.each([
    ['no linkedRepoId', () => `/workspaces/${workspaceId}/tickets`],
    ['an unknown linkedRepoId', () => `/workspaces/${workspaceId}/tickets?linkedRepoId=${UNKNOWN}`],
    ['an unknown workspace', () => `/workspaces/${UNKNOWN}/tickets?linkedRepoId=${repoId}`],
  ])('returns 404 for %s', async (_name, path) => {
    const res = await t.api.get(path());
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it("returns 404 for another workspace's linked repo", async () => {
    const other = (await t.api.post('/workspaces').send({ name: 'other' })).body.id;
    const res = await t.api.get(`/workspaces/${other}/tickets?linkedRepoId=${repoId}`);
    expect(res.status).toBe(404);
  });

  it('reads one ticket through a URL-encoded key', async () => {
    const res = await t.api.get(`/workspaces/${workspaceId}/tickets/${ENCODED}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: KEY, body: `Body of ${KEY}`, status: 'open' });
  });

  it('returns 404 for a missing ticket', async () => {
    const res = await t.api.get(`/workspaces/${workspaceId}/tickets/${encodeURIComponent('acme/widgets#99')}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a key that matches no linked repo', async () => {
    tracker.add(ticket('other/repo#1'));
    const res = await t.api.get(`/workspaces/${workspaceId}/tickets/${encodeURIComponent('other/repo#1')}`);
    expect(res.status).toBe(404);
  });

  it.each([
    ['TRACKER_AUTH_FAILED', new TrackerAuthError('rejected')],
    ['TRACKER_UNAVAILABLE', new TrackerUnavailableError('down')],
  ])('reports %s with a 502 on both reads', async (code, failure) => {
    tracker.failure = failure;
    const list = await t.api.get(`/workspaces/${workspaceId}/tickets?linkedRepoId=${repoId}`);
    expect(list.status).toBe(502);
    expect(list.body.code).toBe(code);
    const read = await t.api.get(`/workspaces/${workspaceId}/tickets/${ENCODED}`);
    expect(read.status).toBe(502);
    expect(read.body.code).toBe(code);
  });
});
