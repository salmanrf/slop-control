import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=slop-e2e', '-c', 'user.email=slop-e2e@example.invalid', ...args],
    { cwd, stdio: 'ignore' },
  );
}

/**
 * A temporary repo that looks like a clone of a GitHub repo: one commit and an `origin/main` ref.
 * Its origin is never contacted, because worktrees start from the local ref.
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
