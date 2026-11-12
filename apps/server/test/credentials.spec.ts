import type { WorkspaceCredentialStatus } from '@slop-control/shared';
import { RepoHostAuthError, RepoHostUnavailableError } from '../src/repo-host/repo-host';
import {
  createHarness,
  linkSecondRepo,
  seedWorkspace,
  type Harness,
  type Seeded,
} from './support/session-harness';
import { resetDatabase } from './support/test-app';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const TOKEN = 'ghp_workspace_token_for_pushing';
const NOT_SET = {
  isSet: false,
  state: null,
  login: null,
  message: null,
  checkedAt: null,
  repos: [],
};

describe('workspace GitHub credential', () => {
  let h: Harness;
  let seeded: Seeded;

  const path = (ws = seeded.workspaceId) => `/workspaces/${ws}/github-credential`;
  const put = (token: unknown, ws?: string) => h.api.put(path(ws)).send({ token } as object);
  const status = async (ws?: string) =>
    (await h.api.get(path(ws))).body as WorkspaceCredentialStatus;

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.reset();
    h.host.readOnly.clear();
    h.host.rejectingToken = false;
    h.host.failNext = {};
    h.host.verifications.length = 0;
    seeded = await seedWorkspace(h);
  });
  afterAll(() => h.close());

  it('has none to begin with, and reads that without asking GitHub', async () => {
    const res = await h.api.get(path());
    expect(res.status).toBe(200);
    expect(res.body).toEqual(NOT_SET);
    expect(h.host.verifications).toHaveLength(0);
  });

  it('checks a token against GitHub and the linked repos, then stores it', async () => {
    const second = await linkSecondRepo(h, seeded.workspaceId);
    h.host.readOnly.add('acme/gadgets');

    const res = await put(TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isSet: true, state: 'ok', login: 'octo', message: null });
    expect(res.body.checkedAt).toEqual(expect.any(String));
    // A token that can't push to one repo is still saved, and the status says so.
    expect(res.body.repos).toEqual([
      { linkedRepoId: seeded.repoId, canPush: true },
      { linkedRepoId: second.repoId, canPush: false },
    ]);
    expect(h.host.verifications).toEqual([
      {
        token: TOKEN,
        repos: [
          { owner: 'acme', repo: 'widgets' },
          { owner: 'acme', repo: 'gadgets' },
        ],
      },
    ]);
    expect(await status()).toEqual(res.body);
  });

  it('never returns the token', async () => {
    const saved = await put(TOKEN);
    const checked = await h.api.post(`${path()}/check`);
    const removed = await h.api.delete(path());
    for (const res of [saved, checked, removed, await h.api.get(path())]) {
      expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    }
  });

  it('stores nothing for a token GitHub rejects, and keeps the earlier credential', async () => {
    await put(TOKEN);
    h.host.acceptedTokens.add(TOKEN);
    try {
      const res = await put('ghp_a_bad_token');
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('CREDENTIAL_REJECTED');
      expect(JSON.stringify(res.body)).not.toContain('ghp_a_bad_token');
      expect(await status()).toMatchObject({ isSet: true, state: 'ok' });
      // The earlier token is still the one in use.
      expect((await h.api.post(`${path()}/check`)).body.state).toBe('ok');
      expect(h.host.verifications.at(-1)!.token).toBe(TOKEN);
    } finally {
      h.host.acceptedTokens.clear();
    }
  });

  it("doesn't start hiding a rejected value from everything else the workspace records", async () => {
    h.host.failNext.verify = new RepoHostAuthError('GitHub rejected widgets.');
    const res = await put('widgets');
    expect(res.status).toBe(502);
    // Taken out of this answer, but never remembered: it was never a credential.
    expect(res.body.message).toBe('GitHub rejected [REDACTED].');
    const repos = await h.api.get(`/workspaces/${seeded.workspaceId}/repos`);
    expect(repos.body[0].githubRepo).toBe('widgets');
    const sources = await h.api.get(`/workspaces/${seeded.workspaceId}/sources`);
    expect(JSON.stringify(sources.body)).toContain('acme/widgets');
    expect(JSON.stringify(sources.body)).not.toContain('[REDACTED]');
  });

  it('stores nothing when GitHub cannot be reached', async () => {
    h.host.failNext.verify = new RepoHostUnavailableError("GitHub can't be reached.");
    const res = await put(TOKEN);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('REPO_HOST_UNAVAILABLE');
    expect(await status()).toEqual(NOT_SET);
  });

  it.each([
    ['blank', '   '],
    ['missing', undefined],
    ['not text', 12],
  ])('refuses a %s token with a 422', async (_name, token) => {
    const res = await put(token);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(h.host.verifications).toHaveLength(0);
  });

  it('replaces a credential with a new token', async () => {
    await put(TOKEN);
    h.host.login = 'second-login';
    try {
      const res = await put('ghp_the_replacement_token');
      expect(res.body).toMatchObject({ isSet: true, login: 'second-login' });
      await h.api.post(`${path()}/check`);
      expect(h.host.verifications.at(-1)!.token).toBe('ghp_the_replacement_token');
    } finally {
      h.host.login = 'octo';
    }
  });

  it('removes a credential, and removing again is fine', async () => {
    await put(TOKEN);
    const removed = await h.api.delete(path());
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual(NOT_SET);
    expect((await h.api.delete(path())).body).toEqual(NOT_SET);
    const check = await h.api.post(`${path()}/check`);
    expect(check.status).toBe(409);
    expect(check.body.code).toBe('CREDENTIAL_NOT_SET');
  });

  it('checks a stored credential on demand, and a failed check is still a 200', async () => {
    await put(TOKEN);

    h.host.failNext.verify = new RepoHostAuthError(`GitHub rejected ${TOKEN}.`);
    const rejected = await h.api.post(`${path()}/check`);
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ isSet: true, state: 'auth_failed', login: 'octo' });
    expect(rejected.body.message).toContain('[REDACTED]');

    h.host.failNext.verify = new RepoHostUnavailableError('down');
    expect((await h.api.post(`${path()}/check`)).body.state).toBe('unavailable');

    h.host.readOnly.add('acme/widgets');
    const ok = await h.api.post(`${path()}/check`);
    expect(ok.body).toMatchObject({ state: 'ok', message: null });
    expect(ok.body.repos).toEqual([{ linkedRepoId: seeded.repoId, canPush: false }]);
  });

  it("doesn't claim push access to a repo linked after the last check", async () => {
    await put(TOKEN);
    const second = await linkSecondRepo(h, seeded.workspaceId);
    expect((await status()).repos).toEqual([
      { linkedRepoId: seeded.repoId, canPush: true },
      { linkedRepoId: second.repoId, canPush: false },
    ]);
  });

  it("keeps one workspace's credential out of another", async () => {
    await put(TOKEN);
    const other = (await h.api.post('/workspaces').send({ name: 'other' })).body.id as string;
    expect(await status(other)).toEqual(NOT_SET);
    expect((await h.api.post(`${path(other)}/check`)).body.code).toBe('CREDENTIAL_NOT_SET');
    await h.api.delete(path(other));
    expect((await status()).isSet).toBe(true);
  });

  it('returns 404 for an unknown workspace on every route', async () => {
    expect((await h.api.get(path(UNKNOWN))).status).toBe(404);
    expect((await put(TOKEN, UNKNOWN)).status).toBe(404);
    expect((await h.api.delete(path(UNKNOWN))).status).toBe(404);
    expect((await h.api.post(`${path(UNKNOWN)}/check`)).status).toBe(404);
    expect((await h.api.get('/workspaces/not-a-uuid/github-credential')).status).toBe(404);
  });

  it('says what to set when the server has no secret key, before asking GitHub', async () => {
    const keyless = await createHarness({ secretKey: null });
    try {
      const ws = (await keyless.api.post('/workspaces').send({ name: 'keyless' })).body.id;
      const res = await keyless.api
        .put(`/workspaces/${ws}/github-credential`)
        .send({ token: TOKEN });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('SECRETS_NOT_CONFIGURED');
      expect(res.body.message).toContain('SLOP_SECRET_KEY');
      expect(keyless.host.verifications).toHaveLength(0);
      expect((await keyless.api.get(`/workspaces/${ws}/github-credential`)).body.isSet).toBe(false);
    } finally {
      await keyless.close();
    }
  });
});
