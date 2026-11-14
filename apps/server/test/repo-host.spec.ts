import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GitHubRepoHost } from '../src/repo-host/github-repo-host';
import {
  RepoHostAuthError,
  RepoHostRejectedError,
  RepoHostUnavailableError,
} from '../src/repo-host/repo-host';
import { FakeRepoHost } from './support/fake-repo-host';
import { git, makeClone, tempDir } from './support/git';
import { GitHttpServer } from './support/git-http-server';
import { GitHubStub } from './support/github-stub';
import { describeRepoHostContract } from './support/repo-host-contract';

const TARGET = { owner: 'acme', repo: 'widgets' };
const READ_ONLY = { owner: 'acme', repo: 'readonly' };
/** Planted the way the smoke test plants its canary: a value to search everything for afterwards. */
const PLANTED_TOKEN = 'ghp_PLANTED_push_token_never_left_behind';
const BAD_TOKEN = 'ghp_a_token_the_host_rejects';

describeRepoHostContract('FakeRepoHost', async () => {
  const host = new FakeRepoHost();
  host.acceptedTokens.add(PLANTED_TOKEN);
  host.readOnly.add('acme/readonly');
  const clone = makeClone();
  return {
    host,
    token: PLANTED_TOKEN,
    badToken: BAD_TOKEN,
    target: TARGET,
    readOnly: READ_ONLY,
    clone,
    remoteHead: async (branch) => host.branches.get(`acme/widgets:${branch}`) ?? null,
    diverge: async (branch) => {
      host.branches.set(`acme/widgets:${branch}`, 'f'.repeat(40));
    },
    pullRequests: () =>
      host.pullRequests.map((pull) => ({
        head: pull.headBranch,
        base: pull.baseBranch,
        title: pull.title,
        body: pull.body,
      })),
  };
});

interface RealSetup {
  host: GitHubRepoHost;
  gitServer: GitHttpServer;
  stub: GitHubStub;
  bare: string;
  clone: string;
  close(): Promise<void>;
}

/** Real git, a local git server over HTTP that demands the token, and the GitHub stub for the API. */
async function realSetup(): Promise<RealSetup> {
  const gitServer = new GitHttpServer();
  gitServer.token = PLANTED_TOKEN;
  const bare = gitServer.createRepo(TARGET.owner, TARGET.repo);
  const stub = new GitHubStub();
  stub.requiredToken = PLANTED_TOKEN;
  stub.readOnlyRepos.add('acme/readonly');
  const host = new GitHubRepoHost({
    githubApiUrl: await stub.start(),
    githubGitUrl: await gitServer.start(),
  });
  return {
    host,
    gitServer,
    stub,
    bare,
    // Its origin is the developer's own SSH remote, which the push must not use.
    clone: makeClone(),
    close: async () => {
      await gitServer.stop();
      await stub.stop();
    },
  };
}

function remoteHead(bare: string, branch: string): string | null {
  try {
    return git(bare, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  } catch {
    return null;
  }
}

describeRepoHostContract('GitHubRepoHost over real git and stubbed HTTP', async () => {
  const real = await realSetup();
  return {
    host: real.host,
    token: PLANTED_TOKEN,
    badToken: BAD_TOKEN,
    target: TARGET,
    readOnly: READ_ONLY,
    clone: real.clone,
    remoteHead: async (branch) => remoteHead(real.bare, branch),
    diverge: async (branch) => {
      const other = tempDir('slop-other-clone-');
      git(other, 'clone', '-q', '--branch', branch, real.bare, '.');
      git(other, 'commit', '-q', '--allow-empty', '-m', 'someone else');
      git(other, 'push', '-q', 'origin', branch);
    },
    pullRequests: () =>
      real.stub.pulls.map(({ head, base, title, body }) => ({ head, base, title, body })),
    close: real.close,
  };
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** The commands of every process this one started, directly or not: the push and what it spawned. */
function ownProcesses(): string {
  const rows = execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      return match ? [{ pid: match[1]!, ppid: match[2]!, command: match[3]! }] : [];
    });
  const family = new Set([String(process.pid)]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) {
      if (family.has(row.ppid) && !family.has(row.pid)) {
        family.add(row.pid);
        grew = true;
      }
    }
  }
  return rows
    .filter((row) => family.has(row.pid) && row.pid !== String(process.pid))
    .map((row) => row.command)
    .join('\n');
}

/** Every place the token could be left: the Definition of Done's search (NFR-4). */
describe('GitHubRepoHost: the planted token', () => {
  let real: RealSetup;
  let worktree: string;
  const encoded = Buffer.from(`x-access-token:${PLANTED_TOKEN}`).toString('base64');

  const push = (branch: string, commit: string, token = PLANTED_TOKEN) =>
    real.host.pushBranch({ repoPath: real.clone, target: TARGET, branch, commit, token });
  const head = () => git(real.clone, 'rev-parse', 'HEAD');
  const expectNoToken = (text: string) => {
    expect(text).not.toContain(PLANTED_TOKEN);
    expect(text).not.toContain(encoded);
  };

  beforeAll(async () => {
    real = await realSetup();
    worktree = join(tempDir('slop-planted-'), 'wt');
    git(real.clone, 'worktree', 'add', '-q', '-b', 'slop/planted/1', worktree);
    git(worktree, 'commit', '-q', '--allow-empty', '-m', 'session work');
  });
  afterAll(() => real.close());

  it('authenticates with the token, and only with it', async () => {
    await push('slop/planted/1', git(worktree, 'rev-parse', 'HEAD'));
    expect(remoteHead(real.bare, 'slop/planted/1')).toBe(git(worktree, 'rev-parse', 'HEAD'));
    expect(real.gitServer.authorizations).toContain(`Basic ${encoded}`);
  });

  it('leaves it in no configuration, remote, or file of the clone and its worktrees', async () => {
    await push('slop/planted/2', head());
    expectNoToken(git(real.clone, 'config', '--list', '--show-origin'));
    expectNoToken(git(real.clone, 'remote', '-v'));
    // The clone's origin is untouched: the push went to an address built from the linked repo.
    expect(git(real.clone, 'remote', 'get-url', 'origin')).toBe('git@github.com:acme/widgets.git');
    for (const file of [...filesUnder(real.clone), ...filesUnder(worktree)]) {
      expectNoToken(readFileSync(file, 'latin1'));
    }
  });

  it('shows it in the arguments of no process while the push runs', async () => {
    real.gitServer.delayMs = 250;
    try {
      const seen: string[] = [];
      let pushing = true;
      git(real.clone, 'commit', '-q', '--allow-empty', '-m', 'watched');
      const pushed = push('slop/planted/3', head()).finally(() => (pushing = false));
      while (pushing) {
        seen.push(ownProcesses());
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await pushed;
      const all = seen.join('\n');
      // The push's own processes were really observed, so an empty list can't pass this.
      expect(all).toContain(`${real.gitServer.url}/acme/widgets.git`);
      expectNoToken(all);
    } finally {
      real.gitServer.delayMs = 0;
    }
  });

  it('keeps it out of the error a failing push throws', async () => {
    git(real.clone, 'commit', '-q', '--allow-empty', '-m', 'refused');
    const other = tempDir('slop-other-clone-');
    git(other, 'clone', '-q', '--branch', 'slop/planted/2', real.bare, '.');
    git(other, 'commit', '-q', '--allow-empty', '-m', 'someone else');
    git(other, 'push', '-q', 'origin', 'slop/planted/2');

    const refused = await push('slop/planted/2', head()).catch((error: Error) => error);
    expect(refused).toBeInstanceOf(RepoHostRejectedError);
    expectNoToken(`${(refused as Error).message}\n${(refused as Error).stack}`);

    // A token the server rejects is still a token, and stays out of the error too.
    real.gitServer.token = 'ghp_the_server_now_wants_another';
    try {
      const rejected = await push('slop/planted/4', head()).catch((error: Error) => error);
      expect(rejected).toBeInstanceOf(RepoHostAuthError);
      expectNoToken(`${(rejected as Error).message}\n${(rejected as Error).stack}`);
      expect(remoteHead(real.bare, 'slop/planted/4')).toBeNull();
    } finally {
      real.gitServer.token = PLANTED_TOKEN;
    }
  });

  it("uses no credential helper of the host's, and saves the token in none", async () => {
    const log = join(tempDir('slop-helper-'), 'calls.log');
    const helper = `!f() { echo "$1" >> ${log}; cat >> ${log}; }; f`;
    git(real.clone, 'config', 'credential.helper', helper);
    try {
      git(real.clone, 'commit', '-q', '--allow-empty', '-m', 'no helper');
      await push('slop/planted/5', head());
      expect(remoteHead(real.bare, 'slop/planted/5')).toBe(head());
      expect(() => readFileSync(log, 'utf8')).toThrow();
    } finally {
      git(real.clone, 'config', '--unset', 'credential.helper');
    }
  });

  it('reports a host that cannot be reached, and a GitHub refusal of the pull request', async () => {
    const offline = new GitHubRepoHost({
      githubApiUrl: 'http://127.0.0.1:9',
      githubGitUrl: 'http://127.0.0.1:9',
    });
    await expect(offline.verify(PLANTED_TOKEN, [])).rejects.toBeInstanceOf(
      RepoHostUnavailableError,
    );
    await expect(
      offline.pushBranch({
        repoPath: real.clone,
        target: TARGET,
        branch: 'slop/planted/6',
        commit: head(),
        token: PLANTED_TOKEN,
      }),
    ).rejects.toBeInstanceOf(RepoHostUnavailableError);

    real.stub.rejectNextPull = 'No commits between main and slop/planted/9';
    await expect(
      real.host.openPullRequest({
        target: TARGET,
        headBranch: 'slop/planted/9',
        baseBranch: 'main',
        title: 't',
        body: 'b',
        token: PLANTED_TOKEN,
      }),
    ).rejects.toThrow('No commits between main and slop/planted/9');
  });
});

/** Skipped unless a throwaway repo is named: the one check against the real API and a real push. */
const REAL = {
  token: process.env.GITHUB_E2E_TOKEN,
  owner: process.env.GITHUB_E2E_OWNER,
  repo: process.env.GITHUB_E2E_REPO,
  base: process.env.GITHUB_E2E_BASE ?? 'main',
};
const describeReal = REAL.token && REAL.owner && REAL.repo ? describe : describe.skip;

describeReal('GitHubRepoHost against a real throwaway GitHub repo', () => {
  const api = 'https://api.github.com';
  const target = { owner: REAL.owner!, repo: REAL.repo! };
  const branch = `slop/e2e/${Date.now().toString(36)}`;
  const host = new GitHubRepoHost({ githubApiUrl: api, githubGitUrl: 'https://github.com' });
  const github = (method: string, path: string, body?: unknown) =>
    fetch(`${api}/repos/${target.owner}/${target.repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${REAL.token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'slop-control-test',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let pullNumber: number | null = null;

  afterAll(async () => {
    if (pullNumber !== null) await github('PATCH', `/pulls/${pullNumber}`, { state: 'closed' });
    await github('DELETE', `/git/refs/heads/${branch}`);
  });

  it('pushes a uniquely named branch and opens a pull request, then finds both', async () => {
    const access = await host.verify(REAL.token!, [target]);
    expect(access.repos).toEqual([{ ...target, canPush: true }]);

    const clone = tempDir('slop-real-clone-');
    execFileSync(
      'git',
      [
        'clone',
        '-q',
        '--depth',
        '1',
        '--branch',
        REAL.base,
        `https://github.com/${target.owner}/${target.repo}.git`,
        '.',
      ],
      { cwd: clone },
    );
    git(clone, 'commit', '-q', '--allow-empty', '-m', `slop-control e2e ${branch}`);
    const commit = git(clone, 'rev-parse', 'HEAD');

    await host.pushBranch({ repoPath: clone, target, branch, commit, token: REAL.token! });
    const ref = await github('GET', `/git/ref/heads/${branch}`);
    expect(((await ref.json()) as { object: { sha: string } }).object.sha).toBe(commit);

    const input = {
      target,
      headBranch: branch,
      baseBranch: REAL.base,
      title: `slop-control e2e ${branch}`,
      body: 'Opened by the opt-in RepoHost test. It closes itself.',
      token: REAL.token!,
    };
    const pull = await host.openPullRequest(input);
    pullNumber = pull.number;
    const read = await github('GET', `/pulls/${pull.number}`);
    expect(((await read.json()) as { head: { ref: string } }).head.ref).toBe(branch);
    expect(await host.openPullRequest(input)).toEqual(pull);
  }, 60_000);
});
