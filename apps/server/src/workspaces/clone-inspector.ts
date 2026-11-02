import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { ApiException, validationFailed } from '../common/api-exception';
import { AppConfig } from '../config';

const run = promisify(execFile);

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com', 'ssh.github.com']);
const SAFE_HOST = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface CloneInfo {
  localPath: string;
  githubOwner: string;
  githubRepo: string;
  defaultBranch: string;
}

interface ParsedRemote {
  transport: 'https' | 'ssh';
  host: string;
  owner: string;
  repo: string;
}

/** Validates a path on the host as a local clone of a GitHub repo. Never touches the network. */
@Injectable()
export class CloneInspector {
  constructor(private readonly config: AppConfig) {}

  async inspect(path: unknown): Promise<CloneInfo> {
    if (typeof path !== 'string' || !isAbsolute(path)) {
      throw validationFailed('The path must be absolute.');
    }
    if (!(await pathExists(path))) {
      throw new ApiException(422, 'PATH_NOT_FOUND', `${path} doesn't exist on this machine.`);
    }

    const root = await gitOutput(path, 'rev-parse', '--show-toplevel');
    if (root === null) {
      throw new ApiException(422, 'NOT_A_GIT_REPO', `${path} isn't inside a git repo.`);
    }

    const remote = await this.readGithubRemote(root);
    return {
      localPath: await realpath(root),
      githubOwner: remote.owner,
      githubRepo: remote.repo,
      defaultBranch: await detectDefaultBranch(root),
    };
  }

  private async readGithubRemote(root: string): Promise<ParsedRemote> {
    const noRemote = new ApiException(
      422,
      'NO_GITHUB_REMOTE',
      `${root} has no GitHub remote named origin.`,
    );
    const url = await gitOutput(root, 'remote', 'get-url', 'origin');
    const remote = url === null ? null : parseRemote(url);
    if (!remote) throw noRemote;

    const host = remote.transport === 'ssh' ? await this.resolveSshHost(remote.host) : remote.host;
    if (!host || !GITHUB_HOSTS.has(host.toLowerCase())) throw noRemote;
    return remote;
  }

  /** An ssh host can be an alias, so ask ssh which host it really points to. */
  private async resolveSshHost(host: string): Promise<string | null> {
    if (!SAFE_HOST.test(host)) return null;
    const configArgs = this.config.sshConfigFile ? ['-F', this.config.sshConfigFile] : [];
    try {
      const { stdout } = await run('ssh', [...configArgs, '-G', host]);
      const line = stdout.split('\n').find((candidate) => candidate.startsWith('hostname '));
      return line ? line.slice('hostname '.length).trim() : null;
    } catch {
      return null;
    }
  }
}

function parseRemote(url: string): ParsedRemote | null {
  const standard = /^(https|ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  if (standard) {
    const [, scheme, host, owner, repo] = standard as unknown as [string, string, string, string, string];
    return { transport: scheme === 'https' ? 'https' : 'ssh', host, owner, repo };
  }
  const scpLike = /^(?:[^@/]+@)?([^/:]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  if (scpLike) {
    const [, host, owner, repo] = scpLike as unknown as [string, string, string, string];
    return { transport: 'ssh', host, owner, repo };
  }
  return null;
}

async function detectDefaultBranch(root: string): Promise<string> {
  const head = await gitOutput(root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  if (head?.startsWith('origin/')) return head.slice('origin/'.length);
  for (const branch of ['main', 'master']) {
    const ref = await gitOutput(root, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`);
    if (ref !== null) return branch;
  }
  return 'main';
}

async function gitOutput(cwd: string, ...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', args, { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
