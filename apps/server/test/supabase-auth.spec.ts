import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createTestApp, type TestApp } from './support/test-app';

const SUPABASE_URL = 'http://127.0.0.1:54321';

/** Against the real local Supabase Auth: tokens made by the tests can't catch a broken sign-in. */
describe('sign-in through Supabase Auth', () => {
  const email = `auth-test-${Date.now()}@example.invalid`;
  const password = 'auth-test-password';
  let keys: { ANON_KEY: string; SERVICE_ROLE_KEY: string };
  let userId: string;
  let t: TestApp;

  const auth = (path: string, init: RequestInit, key = keys.ANON_KEY) =>
    fetch(`${SUPABASE_URL}/auth/v1${path}`, {
      ...init,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
    });

  beforeAll(async () => {
    const output = execFileSync('supabase', ['status', '-o', 'json'], {
      cwd: resolve(__dirname, '../../..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    keys = JSON.parse(output);
    const created = await auth(
      '/admin/users',
      { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) },
      keys.SERVICE_ROLE_KEY,
    );
    userId = ((await created.json()) as { id: string }).id;
    t = await createTestApp({
      jwt: { kind: 'jwks', url: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` },
    });
  });

  afterAll(async () => {
    await auth(`/admin/users/${userId}`, { method: 'DELETE' }, keys.SERVICE_ROLE_KEY);
    await t.close();
  });

  it('turns away public sign-up', async () => {
    const res = await auth('/signup', {
      method: 'POST',
      body: JSON.stringify({ email: `stranger-${email}`, password }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('signup_disabled');
  });

  it('rejects a wrong password', async () => {
    const res = await auth('/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'wrong' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('invalid_credentials');
  });

  it('signs in the existing user with a token the server accepts', async () => {
    const res = await auth('/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(200);
    const { access_token } = (await res.json()) as { access_token: string };
    const api = await t.http.get('/workspaces').set('Authorization', `Bearer ${access_token}`);
    expect(api.status).toBe(200);
  });
});
