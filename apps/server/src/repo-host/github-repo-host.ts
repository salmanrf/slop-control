import { Inject, Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { AppConfig } from '../config';
import {
  OpenPullRequestInput,
  PullRequestRef,
  PushBranchInput,
  RepoHost,
  RepoHostAccess,
  RepoHostAuthError,
  RepoHostRejectedError,
  RepoHostUnavailableError,
  RepoRef,
} from './repo-host';

const REQUEST_TIMEOUT_MS = 10_000;
const PUSH_TIMEOUT_MS = 60_000;
/** The user name GitHub accepts with any kind of token as the password. */
const TOKEN_USERNAME = 'x-access-token';
const SAFE_REF = /^(?!-)[A-Za-z0-9._/-]+$/;
const SAFE_COMMIT = /^[0-9a-f]{40,64}$/;

/**
 * The helper git asks for the password. It answers from file descriptor 3, a pipe this process
 * writes the token into, so the token is in no argument, environment variable, or file (ADR-0004).
 * It answers `get` only: git's `store` and `erase` calls find nothing to save anywhere.
 */
const PIPE_HELPER = '!f() { test "$1" = get && cat <&3; }; f';

/** GitHub over its REST API and over git's HTTPS transport. Error messages never include a response body's echo of the token. */
@Injectable()
export class GitHubRepoHost extends RepoHost {
  constructor(
    @Inject(AppConfig)
    private readonly config: Pick<AppConfig, 'githubApiUrl' | 'githubGitUrl'>,
  ) {
    super();
  }

  async verify(token: string, repos: RepoRef[]): Promise<RepoHostAccess> {
    const user = await this.request(token, 'GET', '/user');
    this.throwOnFailure(user);
    const { login } = (await user.json()) as { login?: unknown };
    if (typeof login !== 'string' || login === '') {
      throw new RepoHostUnavailableError("GitHub didn't say whose token this is.");
    }

    const access: RepoHostAccess['repos'] = [];
    for (const { owner, repo } of repos) {
      const response = await this.request(token, 'GET', `/repos/${owner}/${repo}`);
      // A repo the token can't see is one it can't push to; the token itself is still good.
      if (response.status === 404 || (response.status === 403 && !isRateLimited(response))) {
        access.push({ owner, repo, canPush: false });
        continue;
      }
      this.throwOnFailure(response);
      const body = (await response.json()) as { permissions?: { push?: unknown } };
      access.push({ owner, repo, canPush: body.permissions?.push === true });
    }
    return { login, repos: access };
  }

  async pushBranch(input: PushBranchInput): Promise<void> {
    const { repoPath, target, branch, commit, token } = input;
    if (!SAFE_REF.test(branch) || !SAFE_COMMIT.test(commit)) {
      throw new RepoHostRejectedError(`${branch} at ${commit} isn't something git can push.`);
    }
    const url = `${this.config.githubGitUrl.replace(/\/+$/, '')}/${target.owner}/${target.repo}.git`;
    const args = [
      // An empty helper clears the ones the host configured, such as the macOS keychain, so the
      // push uses only the stored token and nothing is saved anywhere.
      '-c',
      'credential.helper=',
      '-c',
      `credential.helper=${PIPE_HELPER}`,
      '-c',
      'core.askPass=',
      // No header the host's git setup adds to its own requests goes along with the token.
      '-c',
      'http.extraHeader=',
      'push',
      '--porcelain',
      // The clone's own hooks would run with the developer's access and this command's pipe.
      '--no-verify',
      url,
      // The commit, not the branch, so what's pushed is what was reviewed. No `+`, so never forced.
      `${commit}:refs/heads/${branch}`,
    ];

    const { code, stderr, stdout, timedOut } = await runGitWithSecret(repoPath, args, token);
    if (code === 0) return;

    const output = scrub(`${stderr}\n${stdout}`, token);
    if (timedOut) throw new RepoHostUnavailableError('The push to GitHub timed out.');
    if (
      /Authentication failed|could not read (Username|Password)|HTTP 401|returned error: 401|Invalid username or (password|token)/i.test(
        output,
      )
    ) {
      throw new RepoHostAuthError('GitHub rejected the credential for this push.');
    }
    if (
      /HTTP 403|returned error: 403|Permission to .* denied|Repository not found|HTTP 404|returned error: 404/i.test(
        output,
      )
    ) {
      throw new RepoHostAuthError(
        `The credential can't push to ${target.owner}/${target.repo} on GitHub.`,
      );
    }
    if (
      /Could not resolve host|Failed to connect|Connection refused|Connection timed out|unable to access|HTTP 5\d\d|returned error: 5\d\d/i.test(
        output,
      )
    ) {
      throw new RepoHostUnavailableError("GitHub can't be reached for the push.");
    }
    if (/non-fast-forward|\[rejected\]|fetch first/i.test(output)) {
      throw new RepoHostRejectedError(
        `GitHub refused the push: ${branch} already has other commits there, and a push is never forced.`,
      );
    }
    throw new RepoHostRejectedError(`git couldn't push ${branch}: ${lastLine(output)}`);
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<PullRequestRef> {
    const { target, headBranch, baseBranch, title, body, token } = input;
    const pulls = `/repos/${target.owner}/${target.repo}/pulls`;

    const existing = await this.request(token, 'GET', pulls, {
      query: { head: `${target.owner}:${headBranch}`, state: 'open', per_page: '1' },
    });
    this.throwOnFailure(existing, target);
    const [open] = (await existing.json()) as { number: number; html_url: string }[];
    if (open) return { number: open.number, url: open.html_url };

    const created = await this.request(token, 'POST', pulls, {
      body: { title, body, head: headBranch, base: baseBranch },
    });
    if (created.status === 422) {
      throw new RepoHostRejectedError(
        scrub(`GitHub refused the pull request: ${await rejectionReason(created)}`, token),
      );
    }
    this.throwOnFailure(created, target);
    const pull = (await created.json()) as { number: number; html_url: string };
    return { number: pull.number, url: pull.html_url };
  }

  private async request(
    token: string,
    method: string,
    path: string,
    options: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<Response> {
    const url = new URL(path, this.config.githubApiUrl);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(name, value);
    }
    try {
      return await fetch(url, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'slop-control',
          authorization: `Bearer ${token}`,
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new RepoHostUnavailableError("GitHub can't be reached.");
    }
  }

  private throwOnFailure(response: Response, target?: RepoRef): void {
    if (response.ok) return;
    if (isRateLimited(response))
      throw new RepoHostUnavailableError('GitHub is rate limiting this token.');
    if (response.status === 401) throw new RepoHostAuthError('GitHub rejected the credential.');
    if (response.status === 403 || response.status === 404) {
      throw new RepoHostAuthError(
        target
          ? `The credential can't open pull requests in ${target.owner}/${target.repo}.`
          : "The credential isn't allowed to do this on GitHub.",
      );
    }
    throw new RepoHostUnavailableError(`GitHub returned an error (${response.status}).`);
  }
}

function isRateLimited(response: Response): boolean {
  return (
    response.status === 429 ||
    (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
  );
}

interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Runs one git command with the token on file descriptor 3, where only the credential helper
 * reads it. Prompts are off, so a credential git won't take ends the command instead of hanging.
 */
function runGitWithSecret(cwd: string, args: string[], token: string): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' },
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, PUSH_TIMEOUT_MS);

    child.stdout!.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const secret = child.stdio[3] as NodeJS.WritableStream;
    // Git may never ask, e.g. for a local address, and then nobody reads the pipe.
    secret.on('error', () => undefined);
    secret.end(`username=${TOKEN_USERNAME}\npassword=${token}\n`);

    const finish = (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };
    child.on('error', (error) => {
      stderr += error.message;
      finish(null);
    });
    child.on('close', finish);
  });
}

/** GitHub's own reason for a 422, e.g. "No commits between main and slop/x". */
async function rejectionReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      message?: unknown;
      errors?: { message?: unknown }[];
    };
    const detail = body.errors?.map((error) => error.message).find((m) => typeof m === 'string');
    const message = typeof body.message === 'string' ? body.message : '';
    return (detail as string | undefined) ?? (message || 'it gave no reason.');
  } catch {
    return 'it gave no reason.';
  }
}

/** Git doesn't print credentials, and this makes sure of it before a message leaves this file. */
function scrub(text: string, token: string): string {
  return text
    .split(token)
    .join('[REDACTED]')
    .split(Buffer.from(`${TOKEN_USERNAME}:${token}`).toString('base64'))
    .join('[REDACTED]');
}

function lastLine(output: string): string {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? 'git gave no reason.';
}
