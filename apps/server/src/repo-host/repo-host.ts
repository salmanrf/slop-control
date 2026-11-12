export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RepoHostAccess {
  /** The login the token belongs to. */
  login: string;
  /** One entry per repo asked about. */
  repos: (RepoRef & { canPush: boolean })[];
}

export interface PushBranchInput {
  /** Root of the linked clone that holds the commit. */
  repoPath: string;
  target: RepoRef;
  /** The branch name to create or advance on the host. */
  branch: string;
  /** The commit to push. */
  commit: string;
  token: string;
}

export interface OpenPullRequestInput {
  target: RepoRef;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  token: string;
}

export interface PullRequestRef {
  number: number;
  url: string;
}

export class RepoHostAuthError extends Error {}
export class RepoHostUnavailableError extends Error {}
/** The host refused the push or the pull request for a reason other than the credential. */
export class RepoHostRejectedError extends Error {}

/** The one place that talks to GitHub about code. Only its GitHub implementation knows how git is handed a token. */
export abstract class RepoHost {
  /**
   * @params token: the credential to check; repos: the repos to ask about
   * @return the token's login and whether it can push to each repo; or throws RepoHostAuthError or RepoHostUnavailableError
   * Checks a credential without changing anything on the host.
   */
  abstract verify(token: string, repos: RepoRef[]): Promise<RepoHostAccess>;

  /**
   * @params input: the clone, the target repo, the branch name, the commit, and the token
   * @return nothing; or throws RepoHostAuthError, RepoHostUnavailableError, or RepoHostRejectedError
   * Pushes one commit to one branch, without force. The token must not appear in the command's arguments, a remote URL, the clone's configuration, any file left behind, or the error thrown. Pushing a commit the branch already has succeeds.
   */
  abstract pushBranch(input: PushBranchInput): Promise<void>;

  /**
   * @params input: the target repo, the two branches, the title and body, and the token
   * @return the pull request; or throws RepoHostAuthError, RepoHostUnavailableError, or RepoHostRejectedError
   * Opens a pull request. If one is already open for `headBranch`, returns that one and changes nothing.
   */
  abstract openPullRequest(input: OpenPullRequestInput): Promise<PullRequestRef>;
}
