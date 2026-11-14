import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { REMOTES_DIR } from './env';

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=slop-e2e', '-c', 'user.email=slop-e2e@example.invalid', ...args],
    { cwd, stdio: 'ignore' },
  );
}

/**
 * A temporary repo that looks like a clone of a GitHub repo: one commit and an `origin/main` ref.
 * Its origin is never contacted: the run's server is only allowed git's file transport, so the
 * fetch before a session fails at once and the worktree starts from the local ref.
 */
export function makeClone(owner: string, repo: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'slop-e2e-clone-')));
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), `# ${repo}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  git(dir, 'remote', 'add', 'origin', `https://github.com/${owner}/${repo}.git`);
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  return dir;
}

/**
 * The bare repo the server pushes to for a clone made by `makeClone`, holding the clone's `main`.
 * It's rebuilt for every run, so a branch found in it was pushed by this run.
 */
export function makeRemote(owner: string, repo: string, clone: string): string {
  const dir = join(REMOTES_DIR, owner, `${repo}.git`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  git(dirname(dir), 'init', '-q', '--bare', '-b', 'main', dir);
  git(clone, 'push', '-q', dir, 'main');
  return dir;
}

/** Reads from a repo with git, e.g. a bare repo's refs. Throws if git fails. */
export function gitOutput(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}
