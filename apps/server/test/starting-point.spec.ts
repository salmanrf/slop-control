import type { LaunchPreview, Session } from '@slop-control/shared';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './support/git';
import { resetDatabase } from './support/test-app';
import {
  completeSession,
  createHarness,
  linkSecondRepo,
  reportStarted,
  seedWorkspace,
  startSession,
  ticketPath,
  waitForSession,
  type Harness,
  type Seeded,
} from './support/session-harness';

describe('starting point', () => {
  let h: Harness;
  let seeded: Seeded;
  let workspaceId: string;
  let clone: string;

  /** An implementation that commits `feature.txt` on its branch. */
  const implement = (file = 'feature.txt', options: { linkedRepoId?: string } = {}) =>
    completeSession(h, seeded, 'implementation', {
      ...options,
      work: (run) => {
        run.writeFile(file, 'feature');
        run.commit(`add ${file}`);
      },
    });
  const preview = async (query: string) =>
    (await h.api.get(`${ticketPath(seeded)}/launch-preview${query}`)).body as LaunchPreview;
  const history = async () => (await h.api.get(`${ticketPath(seeded)}/sessions`)).body as Session[];

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.reset();
    seeded = await seedWorkspace(h);
    ({ workspaceId, clone } = seeded);
  });
  afterAll(() => h.close());

  it.each([['investigation'], ['planning'], ['implementation']])(
    'starts %s from the default branch, even after an implementation',
    async (phase) => {
      await implement();
      const session = await startSession(h, seeded, phase);
      expect(session.baseRef).toBe('origin/main');
      expect(session.baseCommit).toBe(git(clone, 'rev-parse', 'origin/main'));
      expect(existsSync(join(session.worktreePath, 'feature.txt'))).toBe(false);
    },
  );

  it('starts a code review from the default branch when nothing was implemented', async () => {
    expect((await preview('?phase=code_review')).compareRef).toBeNull();
    const review = await startSession(h, seeded, 'code_review');
    expect(review.baseRef).toBe('origin/main');
    expect(review.baseCommit).toBe(git(clone, 'rev-parse', 'origin/main'));
    expect(review.brief).not.toContain('Compare');
  });

  it("starts a code review from the implementation's branch, in its own worktree and branch", async () => {
    const implementation = await implement();
    const tip = git(clone, 'rev-parse', implementation.branch);

    const review = await startSession(h, seeded, 'code_review');
    expect(existsSync(join(review.worktreePath, 'feature.txt'))).toBe(true);
    expect(review.baseRef).toBe(implementation.branch);
    expect(review.baseCommit).toBe(tip);
    expect(review.worktreePath).not.toBe(implementation.worktreePath);
    expect(review.branch).not.toBe(implementation.branch);
    expect(review.branch.startsWith('slop/')).toBe(true);
    expect(git(review.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(review.branch);

    h.runtime.lastRun.writeFile('review-fix.txt', 'fix');
    h.runtime.lastRun.commit('fix');
    expect(git(clone, 'rev-parse', implementation.branch)).toBe(tip);
  });

  it('tells the code review which ref to compare against', async () => {
    const implementation = await implement();
    const review = await startSession(h, seeded, 'code_review');
    expect(review.brief).toContain(implementation.branch);
    expect(review.brief).toContain(`\`${implementation.baseRef}\``);
    expect(implementation.baseRef).toBe('origin/main');
  });

  it('uses the most recent of two implementation sessions', async () => {
    await implement('first.txt');
    const second = await implement('second.txt');
    const review = await startSession(h, seeded, 'code_review');
    expect(review.baseRef).toBe(second.branch);
    expect(existsSync(join(review.worktreePath, 'second.txt'))).toBe(true);
    expect(existsSync(join(review.worktreePath, 'first.txt'))).toBe(false);
  });

  it("still uses the implementation's branch once its worktree is removed", async () => {
    const implementation = await implement();
    await h.api.delete(`/workspaces/${workspaceId}/sessions/${implementation.id}/worktree`);

    const review = await startSession(h, seeded, 'code_review');
    expect(review.baseRef).toBe(implementation.branch);
    expect(existsSync(join(review.worktreePath, 'feature.txt'))).toBe(true);
  });

  it('starts from the default branch when the implementation ran in another repo, and still passes its report', async () => {
    const second = await linkSecondRepo(h, workspaceId);
    const implementation = await implement('feature.txt', { linkedRepoId: second.repoId });

    const review = await startSession(h, seeded, 'code_review', { linkedRepoId: seeded.repoId });
    expect(review.baseRef).toBe('origin/main');
    expect(review.brief).not.toContain('Compare');
    expect(review.inputArtifacts.map((input) => input.sessionId)).toEqual([implementation.id]);
  });

  // The limit in the spec's Further Notes: only committed work is on the branch.
  it("doesn't contain work the implementation left uncommitted", async () => {
    await completeSession(h, seeded, 'implementation', {
      work: (run) => run.writeFile('uncommitted.txt', 'work'),
    });
    const review = await startSession(h, seeded, 'code_review');
    expect(existsSync(join(review.worktreePath, 'uncommitted.txt'))).toBe(false);
  });

  // Test plan Q4: any status counts as the most recent implementation session.
  it.each([
    ['failed', (run: Harness['runtime']['lastRun']) => run.ended('error', 'boom')],
    ['is still running', () => undefined],
  ])('uses the branch of an implementation session that %s', async (_name, act) => {
    await implement('earlier.txt');
    const latest = await startSession(h, seeded, 'implementation');
    reportStarted(h.runtime.lastRun);
    h.runtime.lastRun.writeFile('latest.txt', 'work');
    h.runtime.lastRun.commit('latest');
    act(h.runtime.lastRun);
    await waitForSession(h, latest, (s) => s.status !== 'starting');

    const review = await startSession(h, seeded, 'code_review');
    expect(review.baseRef).toBe(latest.branch);
    expect(existsSync(join(review.worktreePath, 'latest.txt'))).toBe(true);
  });

  // Test plan Q5.
  it('fails the launch when the implementation branch was deleted, though the preview still names it', async () => {
    const implementation = await implement();
    await h.api.delete(`/workspaces/${workspaceId}/sessions/${implementation.id}/worktree`);
    git(clone, 'branch', '-D', implementation.branch);

    expect((await preview('?phase=code_review')).baseRef).toBe(implementation.branch);
    const res = await h.api.post(`${ticketPath(seeded)}/sessions`).send({ phase: 'code_review' });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('WORKTREE_CREATE_FAILED');
    expect((await history()).map((s) => s.id)).toEqual([implementation.id]);
  });
});
