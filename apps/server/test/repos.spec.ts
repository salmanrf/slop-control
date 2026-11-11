import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeClone, tempDir } from './support/git';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app';

describe('linked repos', () => {
  let t: TestApp;
  let workspaceId: string;

  const link = (localPath: unknown, workspace = workspaceId) =>
    t.api.post(`/workspaces/${workspace}/repos`).send({ localPath });

  beforeAll(async () => {
    const sshConfig = join(tempDir(), 'ssh_config');
    writeFileSync(
      sshConfig,
      'Host my-github-alias\n  HostName github.com\nHost my-gitlab-alias\n  HostName gitlab.com\n',
    );
    t = await createTestApp({ sshConfigFile: sshConfig });
  });
  beforeEach(async () => {
    await resetDatabase();
    workspaceId = (await t.api.post('/workspaces').send({ name: 'w' })).body.id;
  });
  afterAll(() => t.close());

  it('links a clone and reports its GitHub repo and default branch', async () => {
    const clone = makeClone({ origin: 'git@github.com:acme/widgets.git', defaultBranch: 'trunk' });
    const res = await link(clone);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      workspaceId,
      localPath: clone,
      githubOwner: 'acme',
      githubRepo: 'widgets',
      defaultBranch: 'trunk',
    });

    const repos = await t.api.get(`/workspaces/${workspaceId}/repos`);
    expect(repos.body).toEqual([res.body]);
    const workspace = await t.api.get(`/workspaces/${workspaceId}`);
    expect(workspace.body.hasLinkedRepo).toBe(true);
  });

  it("doesn't connect the repo's Issues as a ticket source", async () => {
    await link(makeClone());
    const sources = await t.api.get(`/workspaces/${workspaceId}/sources`);
    expect(sources.body.map((source: { type: string }) => source.type)).toEqual(['built_in']);
  });

  it.each([
    ['https://github.com/acme/widgets.git'],
    ['https://github.com/acme/widgets'],
    ['ssh://git@github.com/acme/widgets.git'],
    ['git@my-github-alias:acme/widgets.git'],
  ])('accepts the origin %s', async (origin) => {
    const res = await link(makeClone({ origin }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ githubOwner: 'acme', githubRepo: 'widgets' });
  });

  it('finds the default branch when origin/HEAD is not set', async () => {
    const res = await link(makeClone({ defaultBranch: 'main', setOriginHead: false }));
    expect(res.status).toBe(201);
    expect(res.body.defaultBranch).toBe('main');
  });

  it('resolves a path inside a clone to its root', async () => {
    const clone = makeClone();
    const nested = join(clone, 'src/deep');
    mkdirSync(nested, { recursive: true });
    const res = await link(nested);
    expect(res.status).toBe(201);
    expect(res.body.localPath).toBe(realpathSync(clone));
  });

  it('rejects linking the same clone twice, even through another path', async () => {
    const clone = makeClone();
    mkdirSync(join(clone, 'sub'));
    await link(clone);
    const res = await link(join(clone, 'sub'));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REPO_ALREADY_LINKED');
  });

  it('rejects a path that is not absolute', async () => {
    const res = await link('relative/path');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a path that does not exist', async () => {
    const res = await link(join(tempDir(), 'missing'));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PATH_NOT_FOUND');
  });

  it('rejects a path outside any git repo', async () => {
    const res = await link(tempDir());
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NOT_A_GIT_REPO');
  });

  it.each([
    ['no origin', null],
    ['a non-GitHub origin', 'https://gitlab.com/acme/widgets.git'],
    ['an alias to another host', 'git@my-gitlab-alias:acme/widgets.git'],
    ['a look-alike host', 'https://github.com.evil.example/acme/widgets.git'],
    ['a host that looks like an ssh option', 'git@-oProxyCommand=x:acme/widgets.git'],
  ])('rejects a repo with %s', async (_name, origin) => {
    const res = await link(makeClone({ origin }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NO_GITHUB_REMOTE');
  });

  it('returns 404 when the workspace does not exist', async () => {
    const res = await link(makeClone(), '00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    const repos = await t.api.get('/workspaces/00000000-0000-4000-8000-000000000000/repos');
    expect(repos.status).toBe(404);
  });

  it("keeps each workspace's repos to itself, and lets two workspaces link one clone", async () => {
    const other = (await t.api.post('/workspaces').send({ name: 'other' })).body.id;
    const clone = makeClone();
    await link(clone);
    expect((await t.api.get(`/workspaces/${other}/repos`)).body).toEqual([]);
    expect((await link(clone, other)).status).toBe(201);
  });
});
