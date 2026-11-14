import {
  RepoHost,
  RepoHostAuthError,
  RepoHostRejectedError,
  type RepoRef,
} from '../../src/repo-host/repo-host';
import { git } from './git';

/** Drives one `RepoHost` through the behaviour the fake and the GitHub implementation must share. */
export interface RepoHostContractDriver {
  host: RepoHost;
  /** A token the host accepts, and one it doesn't. */
  token: string;
  badToken: string;
  /** A repo the token can push to, and one it can only read. */
  target: RepoRef;
  readOnly: RepoRef;
  /** A local clone holding at least one commit. */
  clone: string;
  /** The commit the host's branch is at, or null if it has no such branch. */
  remoteHead(branch: string): Promise<string | null>;
  /** Gives the host's branch a commit the clone doesn't have. */
  diverge(branch: string): Promise<void>;
  /** The pull requests the host holds, in the order they were opened. */
  pullRequests(): { head: string; base: string; title: string; body: string }[];
  close?(): Promise<void>;
}

let branchCounter = 0;
const nextBranch = () => `slop/contract/${(branchCounter += 1)}`;

function commit(clone: string, message: string): string {
  git(clone, 'commit', '-q', '--allow-empty', '-m', message);
  return git(clone, 'rev-parse', 'HEAD');
}

export function describeRepoHostContract(
  name: string,
  makeDriver: () => Promise<RepoHostContractDriver>,
): void {
  describe(`RepoHost contract: ${name}`, () => {
    let d: RepoHostContractDriver;
    const push = (branch: string, sha: string, token = d.token) =>
      d.host.pushBranch({ repoPath: d.clone, target: d.target, branch, commit: sha, token });
    const open = (headBranch: string, title = 'A title', token = d.token) =>
      d.host.openPullRequest({
        target: d.target,
        headBranch,
        baseBranch: 'main',
        title,
        body: 'A body',
        token,
      });

    beforeAll(async () => {
      d = await makeDriver();
    });
    afterAll(async () => {
      await d.close?.();
    });

    it("verifies an accepted token, with its login and each repo's push access", async () => {
      const access = await d.host.verify(d.token, [d.target, d.readOnly]);
      expect(access.login).toEqual(expect.any(String));
      expect(access.login).not.toBe('');
      expect(access.repos).toEqual([
        { ...d.target, canPush: true },
        { ...d.readOnly, canPush: false },
      ]);
    });

    it('throws RepoHostAuthError for a token the host rejects', async () => {
      await expect(d.host.verify(d.badToken, [d.target])).rejects.toBeInstanceOf(RepoHostAuthError);
    });

    it('pushes the named commit to a new branch, even when the clone has moved past it', async () => {
      const branch = nextBranch();
      const reviewed = commit(d.clone, 'reviewed');
      commit(d.clone, 'not reviewed');
      await push(branch, reviewed);
      expect(await d.remoteHead(branch)).toBe(reviewed);
    });

    it('succeeds when the branch already has the commit', async () => {
      const branch = nextBranch();
      const sha = commit(d.clone, 'once');
      await push(branch, sha);
      await expect(push(branch, sha)).resolves.toBeUndefined();
      expect(await d.remoteHead(branch)).toBe(sha);
    });

    it('advances a branch it pushed before', async () => {
      const branch = nextBranch();
      await push(branch, commit(d.clone, 'first'));
      const second = commit(d.clone, 'second');
      await push(branch, second);
      expect(await d.remoteHead(branch)).toBe(second);
    });

    it('never forces: a branch with other commits on the host refuses the push', async () => {
      const branch = nextBranch();
      await push(branch, commit(d.clone, 'mine'));
      await d.diverge(branch);
      const theirs = await d.remoteHead(branch);
      await expect(push(branch, commit(d.clone, 'mine again'))).rejects.toBeInstanceOf(
        RepoHostRejectedError,
      );
      expect(await d.remoteHead(branch)).toBe(theirs);
    });

    it('throws RepoHostAuthError for a push with a rejected token, and pushes nothing', async () => {
      const branch = nextBranch();
      const attempt = push(branch, commit(d.clone, 'never lands'), d.badToken);
      await expect(attempt).rejects.toBeInstanceOf(RepoHostAuthError);
      await expect(attempt).rejects.not.toThrow(d.badToken);
      expect(await d.remoteHead(branch)).toBeNull();
    });

    it('opens a pull request with the title, body, and branches given', async () => {
      const branch = nextBranch();
      await push(branch, commit(d.clone, 'for a pull request'));
      const pull = await open(branch, 'Open me');
      expect(pull.number).toEqual(expect.any(Number));
      expect(pull.url).toContain(String(pull.number));
      expect(d.pullRequests().at(-1)).toEqual({
        head: branch,
        base: 'main',
        title: 'Open me',
        body: 'A body',
      });
    });

    it('adopts the pull request already open for a branch, and changes nothing', async () => {
      const branch = nextBranch();
      await push(branch, commit(d.clone, 'adopt me'));
      const first = await open(branch, 'First title');
      const count = d.pullRequests().length;
      const second = await open(branch, 'Second title');
      expect(second).toEqual(first);
      expect(d.pullRequests()).toHaveLength(count);
      expect(d.pullRequests().at(-1)!.title).toBe('First title');
    });

    it('throws RepoHostAuthError for a pull request with a rejected token', async () => {
      const count = d.pullRequests().length;
      await expect(open(nextBranch(), 'Nope', d.badToken)).rejects.toBeInstanceOf(
        RepoHostAuthError,
      );
      expect(d.pullRequests()).toHaveLength(count);
    });
  });
}
