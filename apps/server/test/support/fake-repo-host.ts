import { execFileSync } from 'node:child_process';
import {
  OpenPullRequestInput,
  PullRequestRef,
  PushBranchInput,
  RepoHost,
  RepoHostAccess,
  RepoHostAuthError,
  RepoHostRejectedError,
  RepoRef,
} from '../../src/repo-host/repo-host';

const name = ({ owner, repo }: RepoRef) => `${owner}/${repo}`.toLowerCase();

/**
 * Stands in for GitHub: remembers what was pushed and which pull requests are open, and records
 * every call, so a test can assert that nothing reached it. It runs the `RepoHost` contract suite
 * beside the real implementation, which keeps it faithful.
 */
export class FakeRepoHost extends RepoHost {
  login = 'octo';
  /** Tokens the host accepts. Empty means every token is accepted. */
  readonly acceptedTokens = new Set<string>();
  /** Repos, as `owner/repo`, the token can see but not push to. */
  readonly readOnly = new Set<string>();
  /** Thrown by the next call of that kind, once. */
  failNext: { verify?: Error; push?: Error; pullRequest?: Error } = {};
  /** When set, every call is rejected as GitHub rejects a revoked token. */
  rejectingToken = false;
  /** When set, a push waits for it, so a test can act while a dispatch is in flight. */
  pushGate: Promise<void> | null = null;

  readonly verifications: { token: string; repos: RepoRef[] }[] = [];
  readonly pushes: PushBranchInput[] = [];
  readonly pullRequests: (OpenPullRequestInput & PullRequestRef)[] = [];
  /** How many pull requests were created, as opposed to adopted. */
  created = 0;
  /** The remote's branches, as `owner/repo:branch`, and the commit each is at. */
  readonly branches = new Map<string, string>();

  async verify(token: string, repos: RepoRef[]): Promise<RepoHostAccess> {
    this.verifications.push({ token, repos });
    this.take('verify');
    this.authenticate(token);
    return {
      login: this.login,
      repos: repos.map((repo) => ({ ...repo, canPush: !this.readOnly.has(name(repo)) })),
    };
  }

  async pushBranch(input: PushBranchInput): Promise<void> {
    this.pushes.push(input);
    await this.pushGate;
    this.take('push');
    this.authenticate(input.token);
    if (this.readOnly.has(name(input.target))) {
      throw new RepoHostAuthError(`The credential can't push to ${name(input.target)} on GitHub.`);
    }
    const ref = `${name(input.target)}:${input.branch}`;
    const current = this.branches.get(ref);
    if (current && current !== input.commit && !isAncestor(input.repoPath, current, input.commit)) {
      throw new RepoHostRejectedError(
        `GitHub refused the push: ${input.branch} already has other commits there, and a push is never forced.`,
      );
    }
    this.branches.set(ref, input.commit);
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<PullRequestRef> {
    this.take('pullRequest');
    this.authenticate(input.token);
    const open = this.pullRequests.find(
      (pull) => name(pull.target) === name(input.target) && pull.headBranch === input.headBranch,
    );
    if (open) return { number: open.number, url: open.url };

    this.created += 1;
    const number = this.pullRequests.length + 1;
    const pull = {
      ...input,
      number,
      url: `https://github.com/${input.target.owner}/${input.target.repo}/pull/${number}`,
    };
    this.pullRequests.push(pull);
    return { number, url: pull.url };
  }

  private take(kind: keyof FakeRepoHost['failNext']): void {
    const failure = this.failNext[kind];
    if (!failure) return;
    delete this.failNext[kind];
    throw failure;
  }

  private authenticate(token: string): void {
    const unknown = this.acceptedTokens.size > 0 && !this.acceptedTokens.has(token);
    if (this.rejectingToken || unknown)
      throw new RepoHostAuthError('GitHub rejected the credential.');
  }
}

/** A commit the clone doesn't hold can't be an ancestor of one it does. */
function isAncestor(repoPath: string, ancestor: string, commit: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, commit], {
      cwd: repoPath,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}
