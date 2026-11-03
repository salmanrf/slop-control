import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GitWorktreeManager,
  WorktreeCreateError,
  WorktreeDirtyError,
} from '../src/worktrees/worktree-manager';
import { git, makeClone, tempDir } from './support/git';

const SESSION_ID = '3f2a9c1e-0000-4000-8000-000000000000';
const WORKSPACE_ID = 'aaaaaaaa-0000-4000-8000-000000000000';

describe('WorktreeManager', () => {
  let dataDir: string;
  let repoPath: string;
  let manager: GitWorktreeManager;

  const create = (overrides: Partial<Parameters<GitWorktreeManager['create']>[0]> = {}) =>
    manager.create({
      repoPath,
      baseRef: 'origin/main',
      workspaceId: WORKSPACE_ID,
      ticketKey: 'acme/widgets#123',
      sessionId: SESSION_ID,
      ...overrides,
    });

  beforeEach(() => {
    dataDir = tempDir('slop-data-');
    repoPath = makeClone();
    manager = new GitWorktreeManager({ dataDir });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  describe('create', () => {
    it('lays out the worktree under the data directory, on a slop branch', async () => {
      const worktree = await create();
      expect(worktree.path).toBe(
        join(dataDir, 'worktrees', WORKSPACE_ID, 'acme-widgets-123-3f2a9c1e'),
      );
      expect(worktree.branch).toBe('slop/acme-widgets-123/3f2a9c1e');
      expect(existsSync(join(worktree.path, 'README.md'))).toBe(true);
      expect(git(worktree.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(worktree.branch);
    });

    it('starts from the base ref, not from the current checkout', async () => {
      const base = git(repoPath, 'rev-parse', 'origin/main');
      writeFileSync(join(repoPath, 'later.txt'), 'later');
      git(repoPath, 'add', '.');
      git(repoPath, 'commit', '-qm', 'later');

      const worktree = await create();
      expect(git(worktree.path, 'rev-parse', 'HEAD')).toBe(base);
      expect(existsSync(join(worktree.path, 'later.txt'))).toBe(false);
    });

    it.each([
      ['a dotted repo', 'acme/my.repo#7', 'acme-my-repo-7'],
      ['consecutive dots', 'acme/a..b#7', 'acme-a-b-7'],
      ['a lock suffix', 'acme/x.lock#7', 'acme-x-lock-7'],
      ['leading punctuation', '-acme/x#7', 'acme-x-7'],
      ['spaces and shell characters', 'a b/$(x);#7', 'a-b-x-7'],
    ])('makes a ticket key with %s safe for refs and paths', async (_name, ticketKey, slug) => {
      const worktree = await create({ ticketKey });
      expect(worktree.branch).toBe(`slop/${slug}/3f2a9c1e`);
      expect(worktree.path.endsWith(`${slug}-3f2a9c1e`)).toBe(true);
    });

    it('keeps two sessions on one ticket apart', async () => {
      const first = await create();
      const second = await create({ sessionId: '7b7b7b7b-0000-4000-8000-000000000000' });
      expect(second.path).not.toBe(first.path);
      expect(second.branch).not.toBe(first.branch);
    });

    it('keeps files in .slop out of git status, in the clone-wide exclude file', async () => {
      const worktree = await create();
      mkdirSync(join(worktree.path, '.slop'));
      writeFileSync(join(worktree.path, '.slop/investigation.md'), '# result');
      expect(git(worktree.path, 'status', '--porcelain')).toBe('');
    });

    it('adds the exclude line only once', async () => {
      await create();
      await create({ sessionId: '7b7b7b7b-0000-4000-8000-000000000000' });
      const exclude = readFileSync(join(repoPath, '.git/info/exclude'), 'utf8');
      expect(exclude.split('\n').filter((line) => line === '/.slop/')).toHaveLength(1);
    });

    it('commits nothing to the repo', async () => {
      await create();
      expect(git(repoPath, 'status', '--porcelain')).toBe('');
    });

    it('throws WorktreeCreateError when git cannot create it', async () => {
      await expect(create({ baseRef: 'origin/does-not-exist' })).rejects.toBeInstanceOf(
        WorktreeCreateError,
      );
    });
  });

  describe('remove', () => {
    it('removes the worktree and keeps its branch and commits', async () => {
      const worktree = await create();
      writeFileSync(join(worktree.path, 'work.txt'), 'work');
      git(worktree.path, 'add', '.');
      git(worktree.path, 'commit', '-qm', 'work');
      const commit = git(worktree.path, 'rev-parse', 'HEAD');

      await manager.remove(repoPath, worktree.path, false);

      expect(existsSync(worktree.path)).toBe(false);
      expect(git(repoPath, 'rev-parse', worktree.branch)).toBe(commit);
    });

    it.each([
      ['an untracked file', (dir: string) => writeFileSync(join(dir, 'new.txt'), 'new')],
      ['a modified file', (dir: string) => writeFileSync(join(dir, 'README.md'), 'changed')],
    ])('refuses to remove a worktree with %s', async (_name, dirty) => {
      const worktree = await create();
      dirty(worktree.path);
      await expect(manager.remove(repoPath, worktree.path, false)).rejects.toBeInstanceOf(
        WorktreeDirtyError,
      );
      expect(existsSync(worktree.path)).toBe(true);
    });

    it('does not count the .slop folder as uncommitted work', async () => {
      const worktree = await create();
      mkdirSync(join(worktree.path, '.slop'));
      writeFileSync(join(worktree.path, '.slop/investigation.md'), '# result');
      await manager.remove(repoPath, worktree.path, false);
      expect(existsSync(worktree.path)).toBe(false);
    });

    it('removes a dirty worktree when forced', async () => {
      const worktree = await create();
      writeFileSync(join(worktree.path, 'new.txt'), 'new');
      await manager.remove(repoPath, worktree.path, true);
      expect(existsSync(worktree.path)).toBe(false);
      expect(git(repoPath, 'rev-parse', '--verify', worktree.branch)).not.toBe('');
    });

    it('does nothing when the worktree is already gone', async () => {
      const worktree = await create();
      await manager.remove(repoPath, worktree.path, false);
      await expect(manager.remove(repoPath, worktree.path, false)).resolves.toBeUndefined();
    });

    it('cleans up when the folder was deleted by hand', async () => {
      const worktree = await create();
      rmSync(worktree.path, { recursive: true, force: true });
      await manager.remove(repoPath, worktree.path, false);
      expect(git(repoPath, 'worktree', 'list')).not.toContain(worktree.path);
    });
  });
});
