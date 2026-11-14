import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server } from 'node:net';
import {
  BranchNotFoundError,
  GitWorktreeManager,
  WorktreeCreateError,
  WorktreeDirtyError,
  WorktreeFetchError,
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

    it('returns the commit the base ref pointed to', async () => {
      const worktree = await create();
      expect(worktree.baseCommit).toBe(git(repoPath, 'rev-parse', 'origin/main'));
    });

    it('returns the starting commit of another branch used as the base', async () => {
      const first = await create();
      writeFileSync(join(first.path, 'work.txt'), 'work');
      git(first.path, 'add', '.');
      git(first.path, 'commit', '-qm', 'work');
      const tip = git(first.path, 'rev-parse', 'HEAD');

      const second = await create({
        baseRef: first.branch,
        sessionId: '7b7b7b7b-0000-4000-8000-000000000000',
      });
      expect(second.baseCommit).toBe(tip);
      expect(second.baseCommit).not.toBe(first.baseCommit);
      expect(existsSync(join(second.path, 'work.txt'))).toBe(true);
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

  describe('hasCodeChanges', () => {
    it('is false for a fresh worktree', async () => {
      const worktree = await create();
      await expect(manager.hasCodeChanges(worktree.path, worktree.baseCommit)).resolves.toBe(false);
    });

    it.each([
      [
        'a modified tracked file',
        (dir: string) => writeFileSync(join(dir, 'README.md'), 'changed'),
      ],
      [
        'a staged change',
        (dir: string) => {
          writeFileSync(join(dir, 'README.md'), 'changed');
          git(dir, 'add', 'README.md');
        },
      ],
      ['a new untracked file', (dir: string) => writeFileSync(join(dir, 'new.txt'), 'new')],
      ['a deleted file', (dir: string) => rmSync(join(dir, 'README.md'))],
    ])('is true for %s', async (_name, change) => {
      const worktree = await create();
      change(worktree.path);
      await expect(manager.hasCodeChanges(worktree.path, worktree.baseCommit)).resolves.toBe(true);
    });

    it('is true for a commit since the start, even with a clean worktree', async () => {
      const worktree = await create();
      writeFileSync(join(worktree.path, 'work.txt'), 'work');
      git(worktree.path, 'add', '.');
      git(worktree.path, 'commit', '-qm', 'work');
      expect(git(worktree.path, 'status', '--porcelain')).toBe('');
      await expect(manager.hasCodeChanges(worktree.path, worktree.baseCommit)).resolves.toBe(true);
    });

    it('is true for a change that was committed and then reverted', async () => {
      const worktree = await create();
      writeFileSync(join(worktree.path, 'README.md'), 'changed');
      git(worktree.path, 'commit', '-qam', 'change');
      git(worktree.path, 'revert', '--no-edit', 'HEAD');
      await expect(manager.hasCodeChanges(worktree.path, worktree.baseCommit)).resolves.toBe(true);
    });

    it('ignores files under .slop, however deep', async () => {
      const worktree = await create();
      mkdirSync(join(worktree.path, '.slop/context/deeper'), { recursive: true });
      writeFileSync(join(worktree.path, '.slop/investigation.md'), '# result');
      writeFileSync(join(worktree.path, '.slop/context/planning.md'), '# plan');
      writeFileSync(join(worktree.path, '.slop/context/deeper/note.md'), 'note');
      await expect(manager.hasCodeChanges(worktree.path, worktree.baseCommit)).resolves.toBe(false);
    });

    // Q9 in the test plan: otherwise an investigation that installs dependencies is always flagged.
    it("ignores files the repo's own .gitignore ignores", async () => {
      writeFileSync(join(repoPath, '.gitignore'), 'node_modules/\n');
      git(repoPath, 'add', '.');
      git(repoPath, 'commit', '-qm', 'ignore');
      git(repoPath, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

      const worktree = await create();
      mkdirSync(join(worktree.path, 'node_modules/left-pad'), { recursive: true });
      writeFileSync(join(worktree.path, 'node_modules/left-pad/index.js'), '');
      await expect(manager.hasCodeChanges(worktree.path, worktree.baseCommit)).resolves.toBe(false);
    });

    it('does not count commits a branch base already had', async () => {
      const first = await create();
      writeFileSync(join(first.path, 'work.txt'), 'work');
      git(first.path, 'add', '.');
      git(first.path, 'commit', '-qm', 'work');
      const second = await create({
        baseRef: first.branch,
        sessionId: '7b7b7b7b-0000-4000-8000-000000000000',
      });
      await expect(manager.hasCodeChanges(second.path, second.baseCommit)).resolves.toBe(false);
    });
  });

  describe('restore', () => {
    it('brings a removed worktree back at the same path, on its branch, with its commits', async () => {
      const worktree = await create();
      writeFileSync(join(worktree.path, 'work.txt'), 'work');
      git(worktree.path, 'add', '.');
      git(worktree.path, 'commit', '-qm', 'work');
      const commit = git(worktree.path, 'rev-parse', 'HEAD');
      await manager.remove(repoPath, worktree.path, false);

      await manager.restore(repoPath, worktree.path, worktree.branch);

      expect(git(worktree.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(worktree.branch);
      expect(git(worktree.path, 'rev-parse', 'HEAD')).toBe(commit);
      expect(existsSync(join(worktree.path, 'work.txt'))).toBe(true);
    });

    it('still keeps .slop out of git in the restored worktree', async () => {
      const worktree = await create();
      await manager.remove(repoPath, worktree.path, false);
      await manager.restore(repoPath, worktree.path, worktree.branch);

      mkdirSync(join(worktree.path, '.slop'));
      writeFileSync(join(worktree.path, '.slop/investigation.md'), '# result');
      expect(git(worktree.path, 'status', '--porcelain')).toBe('');
      await expect(manager.hasCodeChanges(worktree.path, worktree.baseCommit)).resolves.toBe(false);
    });

    it('does nothing when the worktree is still there, leaving uncommitted work alone', async () => {
      const worktree = await create();
      writeFileSync(join(worktree.path, 'draft.txt'), 'draft');
      await manager.restore(repoPath, worktree.path, worktree.branch);
      expect(readFileSync(join(worktree.path, 'draft.txt'), 'utf8')).toBe('draft');
    });

    it('throws WorktreeCreateError when the branch is gone, leaving no folder behind', async () => {
      const worktree = await create();
      await manager.remove(repoPath, worktree.path, false);
      git(repoPath, 'branch', '-D', worktree.branch);

      await expect(
        manager.restore(repoPath, worktree.path, worktree.branch),
      ).rejects.toBeInstanceOf(WorktreeCreateError);
      expect(existsSync(worktree.path)).toBe(false);
    });

    it('recreates a worktree whose folder was deleted by hand', async () => {
      const worktree = await create();
      rmSync(worktree.path, { recursive: true, force: true });
      await manager.restore(repoPath, worktree.path, worktree.branch);
      expect(git(worktree.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(worktree.branch);
    });

    it("keeps a session's commit in the clone's git folder through remove and restore", async () => {
      const worktree = await create();
      writeFileSync(join(worktree.path, 'work.txt'), 'work');
      git(worktree.path, 'add', '.');
      git(worktree.path, 'commit', '-qm', 'work');
      const commit = git(worktree.path, 'rev-parse', 'HEAD');
      expect(git(repoPath, 'cat-file', '-t', commit)).toBe('commit');

      await manager.remove(repoPath, worktree.path, false);
      expect(git(repoPath, 'rev-parse', worktree.branch)).toBe(commit);
      await manager.restore(repoPath, worktree.path, worktree.branch);
      expect(git(worktree.path, 'rev-parse', 'HEAD')).toBe(commit);
    });
  });

  describe('fetch', () => {
    /** A clone whose origin is a real repo on this machine, so a fetch needs no network. */
    function cloneOfLocalOrigin(): { origin: string; clone: string } {
      const origin = makeClone({ origin: null });
      const clone = tempDir('slop-fetch-clone-');
      git(clone, 'clone', '-q', origin, '.');
      return { origin, clone };
    }

    it("updates origin's branch from the remote, and no local branch or worktree", async () => {
      const { origin, clone } = cloneOfLocalOrigin();
      const localBefore = git(clone, 'rev-parse', 'main');
      writeFileSync(join(origin, 'later.txt'), 'added after the clone\n');
      git(origin, 'add', '.');
      git(origin, 'commit', '-qm', 'later');

      await manager.fetch(clone, 'main');

      expect(git(clone, 'rev-parse', 'origin/main')).toBe(git(origin, 'rev-parse', 'main'));
      expect(git(clone, 'rev-parse', 'main')).toBe(localBefore);
      expect(existsSync(join(clone, 'later.txt'))).toBe(false);
    });

    it('throws WorktreeFetchError when the remote cannot be reached, or has no such branch', async () => {
      const { clone } = cloneOfLocalOrigin();
      await expect(manager.fetch(clone, 'no-such-branch')).rejects.toBeInstanceOf(
        WorktreeFetchError,
      );
      git(clone, 'remote', 'set-url', 'origin', join(tempDir(), 'gone.git'));
      await expect(manager.fetch(clone, 'main')).rejects.toBeInstanceOf(WorktreeFetchError);
      // The clone the other suites use: GitHub over SSH, which the test setup makes fail at once.
      await expect(manager.fetch(repoPath, 'main')).rejects.toBeInstanceOf(WorktreeFetchError);
    });

    it('gives up on a remote that never answers', async () => {
      const sockets: import('node:net').Socket[] = [];
      const silent: Server = createServer((socket) => sockets.push(socket));
      await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
      const { port } = silent.address() as { port: number };
      try {
        const { clone } = cloneOfLocalOrigin();
        git(clone, 'remote', 'set-url', 'origin', `http://127.0.0.1:${port}/acme/widgets.git`);
        const impatient = new GitWorktreeManager({ dataDir, fetchTimeoutMs: 400 });
        const started = Date.now();
        await expect(impatient.fetch(clone, 'main')).rejects.toThrow('took too long');
        expect(Date.now() - started).toBeLessThan(5000);
      } finally {
        sockets.forEach((socket) => socket.destroy());
        await new Promise((resolve) => silent.close(resolve));
      }
    });
  });

  describe('reading a branch', () => {
    const write = (root: string, path: string, content: string | Buffer) => {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), content);
    };
    const commitAll = (root: string, message: string) => {
      git(root, 'add', '-A');
      git(root, 'commit', '-qm', message);
      return git(root, 'rev-parse', 'HEAD');
    };

    it('reports the head and the commits since the base, with and without the worktree', async () => {
      const worktree = await create();
      expect(await manager.branchState(repoPath, worktree.branch, worktree.baseCommit)).toEqual({
        headCommit: worktree.baseCommit,
        commitCount: 0,
      });

      write(worktree.path, 'a.txt', 'a\n');
      commitAll(worktree.path, 'one');
      write(worktree.path, 'b.txt', 'b\n');
      const head = commitAll(worktree.path, 'two');
      const expected = { headCommit: head, commitCount: 2 };
      expect(await manager.branchState(repoPath, worktree.branch, worktree.baseCommit)).toEqual(
        expected,
      );

      await manager.remove(repoPath, worktree.path, true);
      expect(await manager.branchState(repoPath, worktree.branch, worktree.baseCommit)).toEqual(
        expected,
      );
    });

    it('throws BranchNotFoundError for a branch that was deleted', async () => {
      const worktree = await create();
      await manager.remove(repoPath, worktree.path, true);
      git(repoPath, 'branch', '-D', worktree.branch);
      const { branch, baseCommit } = worktree;
      await expect(manager.branchState(repoPath, branch, baseCommit)).rejects.toBeInstanceOf(
        BranchNotFoundError,
      );
      await expect(manager.diff(repoPath, baseCommit, branch)).rejects.toBeInstanceOf(
        BranchNotFoundError,
      );
      await expect(manager.mergeBase(repoPath, 'origin/main', branch)).rejects.toBeInstanceOf(
        BranchNotFoundError,
      );
    });

    it('diffs added, modified, deleted, renamed, and binary files, the same without the worktree', async () => {
      write(repoPath, 'old-name.txt', Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'));
      write(repoPath, 'doomed.txt', 'bye\n');
      commitAll(repoPath, 'more files');
      git(repoPath, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
      const worktree = await create();

      write(worktree.path, 'README.md', '# widgets\n\nNow with more.\n');
      write(worktree.path, 'src/new file.ts', 'export const one = 1;\nexport const two = 2;\n');
      rmSync(join(worktree.path, 'doomed.txt'));
      git(worktree.path, 'mv', 'old-name.txt', 'new-name.txt');
      write(worktree.path, 'image.bin', Buffer.from([0, 1, 2, 0, 255, 254, 0, 7]));
      // Excluded by git, so it's never part of the branch.
      write(worktree.path, '.slop/implementation-report.md', '# Report\n');
      commitAll(worktree.path, 'work');

      const read = () => manager.diff(repoPath, worktree.baseCommit, worktree.branch);
      const { files, truncated } = await read();
      expect(truncated).toBe(false);
      const byPath = new Map(files.map((file) => [file.path, file]));
      expect([...byPath.keys()].sort()).toEqual(
        ['README.md', 'doomed.txt', 'image.bin', 'new-name.txt', 'src/new file.ts'].sort(),
      );
      expect(byPath.get('README.md')).toMatchObject({
        status: 'modified',
        previousPath: null,
        additions: 2,
        deletions: 0,
        binary: false,
      });
      expect(byPath.get('README.md')!.patch).toContain('+Now with more.');
      expect(byPath.get('src/new file.ts')).toMatchObject({ status: 'added', additions: 2 });
      expect(byPath.get('src/new file.ts')!.patch).toContain('+export const one = 1;');
      expect(byPath.get('doomed.txt')).toMatchObject({ status: 'deleted', deletions: 1 });
      expect(byPath.get('doomed.txt')!.patch).toContain('-bye');
      expect(byPath.get('new-name.txt')).toMatchObject({
        status: 'renamed',
        previousPath: 'old-name.txt',
        additions: 0,
        deletions: 0,
      });
      expect(byPath.get('image.bin')).toEqual({
        path: 'image.bin',
        previousPath: null,
        status: 'added',
        additions: null,
        deletions: null,
        binary: true,
        patch: null,
      });
      // Each file's text is its own, not its neighbour's.
      expect(byPath.get('README.md')!.patch).not.toContain('doomed');

      await manager.remove(repoPath, worktree.path, true);
      expect(await read()).toEqual({ files, truncated });
    });

    it('lists an oversized file without its text, and says the diff was cut', async () => {
      const worktree = await create();
      write(worktree.path, 'small.txt', 'small\n');
      write(worktree.path, 'huge.txt', `${'x'.repeat(100)}\n`.repeat(3000));
      commitAll(worktree.path, 'big');
      const { files, truncated } = await manager.diff(
        repoPath,
        worktree.baseCommit,
        worktree.branch,
      );
      expect(truncated).toBe(true);
      expect(files.find((file) => file.path === 'huge.txt')).toMatchObject({
        status: 'added',
        additions: 3000,
        binary: false,
        patch: null,
      });
      expect(files.find((file) => file.path === 'small.txt')!.patch).toContain('+small');
    });

    it('stops adding text once the whole diff is large, and still lists every file', async () => {
      const worktree = await create();
      for (let i = 0; i < 12; i += 1) {
        write(
          worktree.path,
          `chunk-${String(i).padStart(2, '0')}.txt`,
          `${'y'.repeat(99)}\n`.repeat(2400),
        );
      }
      commitAll(worktree.path, 'many');
      const { files, truncated } = await manager.diff(
        repoPath,
        worktree.baseCommit,
        worktree.branch,
      );
      expect(files).toHaveLength(12);
      expect(truncated).toBe(true);
      const withText = files.filter((file) => file.patch !== null);
      expect(withText.length).toBeGreaterThan(0);
      expect(withText.length).toBeLessThan(12);
      const total = withText.reduce((sum, file) => sum + Buffer.byteLength(file.patch!), 0);
      expect(total).toBeLessThanOrEqual(2 * 1024 * 1024);
    });

    it('lists uncommitted and untracked files by state, leaving out .slop', async () => {
      write(repoPath, 'tracked.txt', 'one\n');
      write(repoPath, 'to-delete.txt', 'x\n');
      write(repoPath, 'to-rename.txt', 'the same content, moved\n');
      commitAll(repoPath, 'tracked');
      git(repoPath, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
      const worktree = await create();
      expect(await manager.uncommitted(worktree.path)).toEqual([]);

      write(worktree.path, 'tracked.txt', 'two\n');
      write(worktree.path, 'dir/untracked.txt', 'new\n');
      write(worktree.path, 'staged.txt', 'staged\n');
      git(worktree.path, 'add', 'staged.txt');
      rmSync(join(worktree.path, 'to-delete.txt'));
      git(worktree.path, 'mv', 'to-rename.txt', 'renamed.txt');
      write(worktree.path, '.slop/investigation.md', '# Findings\n');

      const files = await manager.uncommitted(worktree.path);
      expect(files!.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
        { path: 'dir/untracked.txt', state: 'untracked' },
        { path: 'renamed.txt', state: 'renamed' },
        { path: 'staged.txt', state: 'added' },
        { path: 'to-delete.txt', state: 'deleted' },
        { path: 'tracked.txt', state: 'modified' },
      ]);
      // Uncommitted work is not part of the branch.
      expect((await manager.diff(repoPath, worktree.baseCommit, worktree.branch)).files).toEqual(
        [],
      );
    });

    it('returns null for the uncommitted files of a removed worktree', async () => {
      const worktree = await create();
      await manager.remove(repoPath, worktree.path, true);
      expect(await manager.uncommitted(worktree.path)).toBeNull();
    });

    it('finds where a branch left its base', async () => {
      const worktree = await create();
      write(worktree.path, 'a.txt', 'a\n');
      commitAll(worktree.path, 'one');
      expect(await manager.mergeBase(repoPath, 'origin/main', worktree.branch)).toBe(
        worktree.baseCommit,
      );
    });
  });
});
