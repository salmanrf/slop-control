import { Inject, Injectable } from '@nestjs/common';
import type { CreateWorktreeInput, WorktreeInfo } from '@slop-control/shared';
import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { AppConfig } from '../config';

const run = promisify(execFile);

const EXCLUDE_LINE = '/.slop/';
const SHORT_ID_LENGTH = 8;

export class WorktreeCreateError extends Error {}
export class WorktreeDirtyError extends Error {}

export abstract class WorktreeManager {
  /**
   * @params input: the clone, base ref, and the IDs that name the worktree and its branch
   * @return the path, branch, and starting commit of the new worktree, or throws WorktreeCreateError if git fails
   * Creates a worktree on a new `slop/<ticketSlug>/<shortSessionId>` branch, with `/.slop/` excluded from git.
   */
  abstract create(input: CreateWorktreeInput): Promise<WorktreeInfo>;

  /**
   * @params repoPath: root of the linked clone; worktreePath: the worktree to remove; force: discard uncommitted changes
   * @return nothing, or throws WorktreeDirtyError if the worktree is dirty and force is false
   * Removes the worktree and keeps its branch. Does nothing if it is already gone.
   */
  abstract remove(repoPath: string, worktreePath: string, force: boolean): Promise<void>;

  /**
   * @params repoPath: root of the linked clone; worktreePath: where the worktree was; branch: the branch it was on
   * @return nothing, or throws WorktreeCreateError if the branch is gone or git fails
   * Recreates a removed worktree at the same path on its existing branch. Does nothing if it is already there.
   */
  abstract restore(repoPath: string, worktreePath: string, branch: string): Promise<void>;

  /**
   * @params worktreePath: the worktree to check; baseCommit: the commit it started from
   * @return true if it has uncommitted changes or commits since `baseCommit`, ignoring `/.slop/`
   * Tells whether code changed, for flagging read-only phases.
   */
  abstract hasCodeChanges(worktreePath: string, baseCommit: string): Promise<boolean>;
}

@Injectable()
export class GitWorktreeManager extends WorktreeManager {
  constructor(@Inject(AppConfig) private readonly config: Pick<AppConfig, 'dataDir'>) {
    super();
  }

  async create(input: CreateWorktreeInput): Promise<WorktreeInfo> {
    const slug = ticketSlug(input.ticketKey);
    const shortId = input.sessionId.slice(0, SHORT_ID_LENGTH);
    const path = join(this.config.dataDir, 'worktrees', input.workspaceId, `${slug}-${shortId}`);
    const branch = `slop/${slug}/${shortId}`;

    try {
      await mkdir(dirname(path), { recursive: true });
      await excludeSlopFolder(input.repoPath);
      await git(
        input.repoPath,
        'worktree',
        'add',
        '--quiet',
        '--no-track',
        '-b',
        branch,
        path,
        input.baseRef,
      );
      return { path, branch, baseCommit: await git(path, 'rev-parse', 'HEAD') };
    } catch (error) {
      throw new WorktreeCreateError(`git couldn't create the worktree: ${describe(error)}`);
    }
  }

  async remove(repoPath: string, worktreePath: string, force: boolean): Promise<void> {
    if (!(await exists(worktreePath))) {
      await git(repoPath, 'worktree', 'prune');
      return;
    }
    if (!force) {
      const changes = await git(worktreePath, 'status', '--porcelain');
      if (changes.length > 0) {
        throw new WorktreeDirtyError(`${worktreePath} has uncommitted changes.`);
      }
    }
    // An excluded `.slop/` counts as untracked content to git itself, so removal always forces;
    // the dirty check above is what protects the developer's work.
    await git(repoPath, 'worktree', 'remove', '--force', worktreePath);
  }

  async restore(repoPath: string, worktreePath: string, branch: string): Promise<void> {
    if (await exists(worktreePath)) return;
    try {
      // A folder deleted by hand leaves git's record of the worktree behind.
      await git(repoPath, 'worktree', 'prune');
      await git(repoPath, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
      await mkdir(dirname(worktreePath), { recursive: true });
      await excludeSlopFolder(repoPath);
      await git(repoPath, 'worktree', 'add', '--quiet', worktreePath, branch);
    } catch (error) {
      await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
      throw new WorktreeCreateError(
        `git couldn't restore the worktree on ${branch}: ${describe(error)}`,
      );
    }
  }

  /** Files git ignores, `/.slop/` among them, show in neither check. */
  async hasCodeChanges(worktreePath: string, baseCommit: string): Promise<boolean> {
    const uncommitted = await git(worktreePath, 'status', '--porcelain');
    if (uncommitted.length > 0) return true;
    const commits = await git(worktreePath, 'rev-list', '--count', `${baseCommit}..HEAD`);
    return Number(commits) > 0;
  }
}

/** Makes a ticket key safe for git refs and paths: `owner/repo#123` becomes `owner-repo-123`. */
function ticketSlug(ticketKey: string): string {
  const slug = ticketKey.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'ticket';
}

/** The clone's local exclude file is shared by all its worktrees, and is never committed. */
async function excludeSlopFolder(repoPath: string): Promise<void> {
  const commonDir = await git(repoPath, 'rev-parse', '--git-common-dir');
  const excludePath = resolve(repoPath, commonDir, 'info', 'exclude');
  const current = await readFile(excludePath, 'utf8').catch(() => '');
  if (current.split('\n').includes(EXCLUDE_LINE)) return;

  await mkdir(dirname(excludePath), { recursive: true });
  const separator = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
  await appendFile(excludePath, `${separator}${EXCLUDE_LINE}\n`);
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd });
  return stdout.trim();
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function describe(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr?.trim();
  return stderr || (error instanceof Error ? error.message : String(error));
}
