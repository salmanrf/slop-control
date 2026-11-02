import { createTestApp, resetDatabase, type TestApp } from './support/test-app';

describe('workspaces', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(resetDatabase);
  afterAll(() => t.close());

  it('starts with no workspaces', async () => {
    const res = await t.api.get('/workspaces');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('creates a workspace that can be listed and read', async () => {
    const created = await t.api.post('/workspaces').send({ name: 'slop-control' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'slop-control', hasLinkedRepo: false });

    const listed = await t.api.get('/workspaces');
    expect(listed.body).toEqual([created.body]);

    const read = await t.api.get(`/workspaces/${created.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);
  });

  it('rejects a duplicate name', async () => {
    await t.api.post('/workspaces').send({ name: 'taken' });
    const res = await t.api.post('/workspaces').send({ name: 'taken' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WORKSPACE_NAME_TAKEN');
  });

  it.each([[''], ['   '], [undefined], [42]])('rejects the name %p', async (name) => {
    const res = await t.api.post('/workspaces').send({ name });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('returns 404 for an unknown workspace', async () => {
    const res = await t.api.get('/workspaces/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a workspace ID that is not a UUID', async () => {
    const res = await t.api.get('/workspaces/not-a-uuid');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
