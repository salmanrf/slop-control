import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim();
}

export function tempDir(prefix = 'slop-test-'): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** A repo with one commit and, when given an origin URL, a local `origin/<branch>` ref. No network. */
export function makeClone(
  options: { origin?: string | null; defaultBranch?: string; setOriginHead?: boolean } = {},
): string {
  const {
    origin = 'git@github.com:acme/widgets.git',
    defaultBranch = 'main',
    setOriginHead = true,
  } = options;
  const dir = tempDir('slop-clone-');
  git(dir, 'init', '-q', '-b', defaultBranch);
  writeFileSync(join(dir, 'README.md'), '# widgets\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  if (origin) {
    git(dir, 'remote', 'add', 'origin', origin);
    git(dir, 'update-ref', `refs/remotes/origin/${defaultBranch}`, 'HEAD');
    if (setOriginHead) {
      git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${defaultBranch}`);
    }
  }
  return dir;
}
