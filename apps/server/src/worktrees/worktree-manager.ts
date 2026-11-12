import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateWorktreeInput,
  DiffFile,
  DiffFileStatus,
  UncommittedFile,
  WorktreeInfo,
} from '@slop-control/shared';
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
export class WorktreeFetchError extends Error {}
export class BranchNotFoundError extends Error {}

/** A file's diff text is left out above this size, and every file's once the response holds this much. */
const MAX_FILE_PATCH_BYTES = 256 * 1024;
const MAX_TOTAL_PATCH_BYTES = 2 * 1024 * 1024;
const DIFF_BUFFER_BYTES = 256 * 1024 * 1024;

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

  /**
   * @params repoPath: root of the linked clone; branch: a branch on the clone's `origin`
   * @return nothing, or throws WorktreeFetchError if the fetch fails or takes longer than its time limit
   * Updates `origin/<branch>` from the clone's own remote, with prompts off. Changes no local branch and no worktree.
   */
  abstract fetch(repoPath: string, branch: string): Promise<void>;

  /**
   * @params repoPath: root of the linked clone; branch: a local branch; baseCommit: the commit to count from
   * @return the branch's head commit and how many commits it has since `baseCommit`, or throws BranchNotFoundError
   * Reads what a branch holds, from the clone, whether or not it has a worktree.
   */
  abstract branchState(
    repoPath: string,
    branch: string,
    baseCommit: string,
  ): Promise<{ headCommit: string; commitCount: number }>;

  /**
   * @params repoPath: root of the linked clone; baseCommit: the commit to compare against; branch: a local branch
   * @return the changed files with their diff text, and whether any text was left out for size; or throws BranchNotFoundError
   * Compares a branch's committed work with a commit. Files git ignores, `/.slop/` among them, never appear.
   */
  abstract diff(
    repoPath: string,
    baseCommit: string,
    branch: string,
  ): Promise<{ files: DiffFile[]; truncated: boolean }>;

  /**
   * @params worktreePath: a worktree
   * @return its uncommitted and untracked files, ignoring `/.slop/`; or null if the worktree no longer exists
   * Lists work that isn't on the branch.
   */
  abstract uncommitted(worktreePath: string): Promise<UncommittedFile[] | null>;

  /**
   * @params repoPath: root of the linked clone; ref: the ref a branch started from; branch: a local branch
   * @return the commit the two last shared, or throws BranchNotFoundError
   * Finds where a branch left its base, for sessions from before their starting commit was recorded.
   */
  abstract mergeBase(repoPath: string, ref: string, branch: string): Promise<string>;
}

@Injectable()
export class GitWorktreeManager extends WorktreeManager {
  constructor(
    @Inject(AppConfig)
    private readonly config: Pick<AppConfig, 'dataDir'> &
      Partial<Pick<AppConfig, 'fetchTimeoutMs'>>,
  ) {
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

  async fetch(repoPath: string, branch: string): Promise<void> {
    try {
      await run(
        'git',
        [
          'fetch',
          '--quiet',
          '--no-tags',
          'origin',
          `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
        ],
        {
          cwd: repoPath,
          timeout: this.config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          // The host's own git setup, as the developer's `git fetch` would use, but never a prompt.
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_ASKPASS: '/usr/bin/false',
            SSH_ASKPASS: '/usr/bin/false',
            SSH_ASKPASS_REQUIRE: 'never',
          },
        },
      );
    } catch (error) {
      const timedOut = (error as { killed?: boolean }).killed === true;
      throw new WorktreeFetchError(
        timedOut
          ? `Fetching ${branch} from origin took too long.`
          : `git couldn't fetch ${branch} from origin: ${describe(error)}`,
      );
    }
  }

  async branchState(
    repoPath: string,
    branch: string,
    baseCommit: string,
  ): Promise<{ headCommit: string; commitCount: number }> {
    const headCommit = await branchHead(repoPath, branch);
    const count = await git(repoPath, 'rev-list', '--count', `${baseCommit}..${headCommit}`);
    return { headCommit, commitCount: Number(count) };
  }

  async diff(
    repoPath: string,
    baseCommit: string,
    branch: string,
  ): Promise<{ files: DiffFile[]; truncated: boolean }> {
    const head = await branchHead(repoPath, branch);
    const range = [baseCommit, head];
    const [names, stats] = await Promise.all([
      gitRaw(repoPath, 'diff', '--name-status', '-z', '-M', ...range),
      gitRaw(repoPath, 'diff', '--numstat', '-z', '-M', ...range),
    ]);
    const files = parseNameStatus(names);
    const counts = parseNumstat(stats);

    // One pass for every file's text. If it's too much for one read, the files are still listed.
    let patches: string[] | null = null;
    try {
      const text = await gitRaw(repoPath, 'diff', '-M', '--no-color', '--no-ext-diff', ...range);
      const sections = text.split(/^(?=diff --git )/m).filter((section) => section.length > 0);
      if (sections.length === files.length) patches = sections;
    } catch {
      patches = null;
    }

    let truncated = false;
    let total = 0;
    let full = false;
    return {
      files: files.map((file, index) => {
        const count = counts.get(file.path);
        const binary = count?.binary ?? false;
        let patch = binary ? null : (patches?.[index] ?? null);
        if (patch !== null) {
          const size = Buffer.byteLength(patch);
          // Once the response is full, no later file's text is added, however small.
          if (total + size > MAX_TOTAL_PATCH_BYTES) full = true;
          if (full || size > MAX_FILE_PATCH_BYTES) patch = null;
          else total += size;
        }
        if (patch === null && !binary) truncated = true;
        return {
          ...file,
          additions: binary ? null : (count?.additions ?? 0),
          deletions: binary ? null : (count?.deletions ?? 0),
          binary,
          patch,
        };
      }),
      truncated,
    };
  }

  async uncommitted(worktreePath: string): Promise<UncommittedFile[] | null> {
    if (!(await exists(worktreePath))) return null;
    const output = await gitRaw(
      worktreePath,
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    );
    const entries = output.split('\0');
    const files: UncommittedFile[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      if (entry.length < 4) continue;
      const code = entry.slice(0, 2);
      // A rename's old path follows as its own entry.
      if (code.includes('R') || code.includes('C')) index += 1;
      files.push({ path: entry.slice(3), state: uncommittedState(code) });
    }
    return files;
  }

  async mergeBase(repoPath: string, ref: string, branch: string): Promise<string> {
    const head = await branchHead(repoPath, branch);
    try {
      return await git(repoPath, 'merge-base', ref, head);
    } catch {
      throw new BranchNotFoundError(`${ref} and ${branch} share no commit.`);
    }
  }
}

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

async function branchHead(repoPath: string, branch: string): Promise<string> {
  try {
    return await git(repoPath, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`);
  } catch {
    throw new BranchNotFoundError(`The branch ${branch} no longer exists in the clone.`);
  }
}

type ListedFile = Pick<DiffFile, 'path' | 'previousPath' | 'status'>;

/** `--name-status -z`: a status, then one path, or two for a rename. */
function parseNameStatus(output: string): ListedFile[] {
  const fields = output.split('\0');
  const files: ListedFile[] = [];
  for (let index = 0; index + 1 < fields.length;) {
    const letter = fields[index]![0];
    if (letter === 'R' || letter === 'C') {
      files.push({ path: fields[index + 2]!, previousPath: fields[index + 1]!, status: 'renamed' });
      index += 3;
    } else {
      files.push({ path: fields[index + 1]!, previousPath: null, status: diffStatus(letter) });
      index += 2;
    }
  }
  return files;
}

function diffStatus(letter: string | undefined): DiffFileStatus {
  if (letter === 'A') return 'added';
  if (letter === 'D') return 'deleted';
  return 'modified';
}

/** `--numstat -z`: counts and a path, or counts, an empty path, and two paths for a rename. A binary file has `-` for both counts. */
function parseNumstat(
  output: string,
): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const fields = output.split('\0');
  const counts = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  for (let index = 0; index < fields.length; index += 1) {
    const [added, deleted, path] = fields[index]!.split('\t');
    if (added === undefined || deleted === undefined || path === undefined) continue;
    let name = path;
    if (path === '') {
      name = fields[index + 2] ?? '';
      index += 2;
    }
    const binary = added === '-' || deleted === '-';
    counts.set(name, {
      additions: binary ? 0 : Number(added),
      deletions: binary ? 0 : Number(deleted),
      binary,
    });
  }
  return counts;
}

function uncommittedState(code: string): UncommittedFile['state'] {
  if (code === '??') return 'untracked';
  if (code.includes('R') || code.includes('C')) return 'renamed';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  return 'modified';
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

/** Untrimmed, and with room for a large diff. Paths aren't quoted, so they read as they are. */
async function gitRaw(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    maxBuffer: DIFF_BUFFER_BYTES,
  });
  return stdout;
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
