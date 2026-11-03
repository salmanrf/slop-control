import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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

/** Local Supabase signs with ES256 and publishes its key as a JWKS, so this is the real path. */
describe('auth with a JWKS', () => {
  let t: TestApp;
  let server: Server;
  let signingKey: KeyLike;

  const sign = (key: KeyLike, audience = 'authenticated') =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
  const list = (token: string) => t.http.get('/workspaces').set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    signingKey = privateKey;
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks.json`;
    t = await createTestApp({ jwt: { kind: 'jwks', url } });
  });
  afterAll(async () => {
    await t.close();
    await new Promise((resolve) => server.close(resolve));
  });

  it('accepts a token signed by the published key', async () => {
    expect((await list(await sign(signingKey))).status).toBe(200);
  });

  it('rejects a token signed by another key with the same key ID', async () => {
    const other = await generateKeyPair('ES256');
    expect((await list(await sign(other.privateKey))).status).toBe(401);
  });

  it('rejects a token for another audience', async () => {
    expect((await list(await sign(signingKey, 'someone-else'))).status).toBe(401);
  });

  it('rejects a token that uses a shared-secret algorithm', async () => {
    const forged = await signToken({ secret: 'x'.repeat(48) });
    expect((await list(forged)).status).toBe(401);
  });
});
