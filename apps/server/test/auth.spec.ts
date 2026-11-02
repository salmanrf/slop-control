import { createTestApp, resetDatabase, signToken, type TestApp } from './support/test-app';

describe('auth', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(resetDatabase);
  afterAll(() => t.close());

  it('rejects a request with no token', async () => {
    const res = await t.http.get('/workspaces');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = await signToken({ secret: 'a-completely-different-secret-of-enough-length' });
    const res = await t.http.get('/workspaces').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an expired token', async () => {
    const token = await signToken({ expiresIn: '-1m' });
    const res = await t.http.get('/workspaces').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a token for another audience', async () => {
    const token = await signToken({ audience: 'someone-else' });
    const res = await t.http.get('/workspaces').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('accepts a valid token', async () => {
    const res = await t.api.get('/workspaces');
    expect(res.status).toBe(200);
  });
});
