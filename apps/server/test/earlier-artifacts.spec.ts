import type { Session } from '@slop-control/shared';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ticket } from './support/fake-tracker';
import { git } from './support/git';
import { resetDatabase } from './support/test-app';
import {
  completeSession,
  createHarness,
  KEY,
  linkSecondRepo,
  reportStarted,
  seedWorkspace,
  sendMessage,
  startSession,
  waitForSession,
  type Harness,
  type Seeded,
} from './support/session-harness';

const contextFile = (session: Session, phase: string) =>
  join(session.worktreePath, '.slop/context', `${phase}.md`);
const read = (session: Session, phase: string) => readFileSync(contextFile(session, phase), 'utf8');

describe('earlier artifacts', () => {
  let h: Harness;
  let seeded: Seeded;
  let workspaceId: string;

  const terminal = (s: Session) => ['ended', 'failed', 'stopped'].includes(s.status);

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.reset();
    seeded = await seedWorkspace(h);
    ({ workspaceId } = seeded);
  });
  afterAll(() => h.close());

  it('gives a planning session the investigation, as a file and not in the brief', async () => {
    const investigation = await completeSession(h, seeded, 'investigation', {
      content: '# Findings\nThe login loops.\n',
    });
    const planning = await startSession(h, seeded, 'planning');

    expect(read(planning, 'investigation')).toBe('# Findings\nThe login loops.\n');
    expect(planning.inputArtifacts).toEqual([
      {
        sessionId: investigation.id,
        round: 1,
        phase: 'investigation',
        path: '.slop/context/investigation.md',
      },
    ]);
    expect(planning.brief).toContain('.slop/context/investigation.md');
    expect(planning.brief).toContain('investigation');
    expect(planning.brief).not.toContain('The login loops.');
  });

  it('gives an implementation session the investigation and the plan', async () => {
    await completeSession(h, seeded, 'investigation', { content: '# Findings\n' });
    await completeSession(h, seeded, 'planning', { content: '# Plan\n' });
    const implementation = await startSession(h, seeded, 'implementation');

    expect(read(implementation, 'investigation')).toBe('# Findings\n');
    expect(read(implementation, 'planning')).toBe('# Plan\n');
    expect(implementation.inputArtifacts.map((input) => input.phase)).toEqual([
      'investigation',
      'planning',
    ]);
  });

  it('gives a code review session the implementation report', async () => {
    const implementation = await completeSession(h, seeded, 'implementation', {
      content: '# Report\n',
    });
    const review = await startSession(h, seeded, 'code_review');
    expect(read(review, 'implementation')).toBe('# Report\n');
    expect(review.inputArtifacts).toEqual([
      {
        sessionId: implementation.id,
        round: 1,
        phase: 'implementation',
        path: '.slop/context/implementation.md',
      },
    ]);
  });

  it('gives an implementation started after a review the review report and what came before', async () => {
    await completeSession(h, seeded, 'investigation', { content: '# Findings\n' });
    await completeSession(h, seeded, 'planning', { content: '# Plan\n' });
    await completeSession(h, seeded, 'implementation', { content: '# Report\n' });
    await completeSession(h, seeded, 'code_review', { content: '# Review\n' });

    const again = await startSession(h, seeded, 'implementation');
    expect(read(again, 'code_review')).toBe('# Review\n');
    expect(read(again, 'planning')).toBe('# Plan\n');
    expect(read(again, 'investigation')).toBe('# Findings\n');
    expect(again.inputArtifacts.map((input) => input.phase)).toEqual([
      'investigation',
      'planning',
      'code_review',
    ]);
    expect(existsSync(contextFile(again, 'implementation'))).toBe(false);
  });

  it('passes only the later of two complete results', async () => {
    await completeSession(h, seeded, 'investigation', { content: '# First\n' });
    const later = await completeSession(h, seeded, 'investigation', { content: '# Second\n' });
    const planning = await startSession(h, seeded, 'planning');
    expect(read(planning, 'investigation')).toBe('# Second\n');
    expect(planning.inputArtifacts[0]!.sessionId).toBe(later.id);
  });

  it.each([
    ['ended without its artifact', (run: Harness['runtime']['lastRun']) => run.ended('success')],
    [
      'failed without an artifact',
      (run: Harness['runtime']['lastRun']) => run.ended('error', 'boom'),
    ],
    ['is still running', () => undefined],
  ])('passes nothing for a phase whose only session %s', async (_name, act) => {
    const investigation = await startSession(h, seeded, 'investigation');
    reportStarted(h.runtime.lastRun);
    act(h.runtime.lastRun);
    await waitForSession(h, investigation, (s) => s.status !== 'starting');

    const planning = await startSession(h, seeded, 'planning');
    expect(planning.inputArtifacts).toEqual([]);
    expect(existsSync(join(planning.worktreePath, '.slop/context'))).toBe(false);
    expect(planning.brief).not.toContain('.slop/context');
  });

  it('passes an earlier complete result over a later incomplete one', async () => {
    const complete = await completeSession(h, seeded, 'investigation', { content: '# Kept\n' });
    const incomplete = await startSession(h, seeded, 'investigation');
    h.runtime.lastRun.ended('success');
    await waitForSession(h, incomplete, terminal);

    const planning = await startSession(h, seeded, 'planning');
    expect(read(planning, 'investigation')).toBe('# Kept\n');
    expect(planning.inputArtifacts[0]!.sessionId).toBe(complete.id);
  });

  it("leaves out the session's own phase", async () => {
    await completeSession(h, seeded, 'investigation');
    await completeSession(h, seeded, 'planning');
    const again = await startSession(h, seeded, 'planning');
    expect(again.inputArtifacts.map((input) => input.phase)).toEqual(['investigation']);
    expect(existsSync(contextFile(again, 'planning'))).toBe(false);
  });

  it("doesn't pass another ticket's results", async () => {
    h.tracker.add(ticket('acme/widgets#2'));
    await completeSession(h, seeded, 'investigation', { key: 'acme/widgets#2' });
    const planning = await startSession(h, seeded, 'planning');
    expect(planning.inputArtifacts).toEqual([]);
  });

  it("doesn't pass results between two sources that use the same key", async () => {
    h.tracker.source('acme/gadgets').add(ticket(KEY));
    const gadgets = await h.api
      .post(`/workspaces/${workspaceId}/sources`)
      .send({ type: 'github_issues', githubOwner: 'acme', githubRepo: 'gadgets' });
    const other = { workspaceId, sourceId: gadgets.body.id as string };
    await completeSession(h, other, 'investigation');

    expect((await startSession(h, seeded, 'planning')).inputArtifacts).toEqual([]);
    expect((await startSession(h, other, 'planning')).inputArtifacts).toHaveLength(1);
  });

  it('passes a result from a session that ran in another linked repo', async () => {
    const second = await linkSecondRepo(h, workspaceId);
    await completeSession(h, seeded, 'investigation', {
      linkedRepoId: seeded.repoId,
      content: '# From repo A\n',
    });
    const planning = await startSession(h, seeded, 'planning', { linkedRepoId: second.repoId });
    expect(planning.linkedRepoId).toBe(second.repoId);
    expect(read(planning, 'investigation')).toBe('# From repo A\n');
  });

  it("passes the stored copy once the source session's worktree is removed", async () => {
    const investigation = await completeSession(h, seeded, 'investigation', {
      content: '# Stored\n',
    });
    await h.api.delete(`/workspaces/${workspaceId}/sessions/${investigation.id}/worktree`);
    expect(existsSync(investigation.worktreePath)).toBe(false);

    const planning = await startSession(h, seeded, 'planning');
    expect(read(planning, 'investigation')).toBe('# Stored\n');
  });

  it('keeps the files out of git status and out of a commit of everything', async () => {
    await completeSession(h, seeded, 'investigation');
    const implementation = await startSession(h, seeded, 'implementation');
    expect(existsSync(contextFile(implementation, 'investigation'))).toBe(true);
    expect(git(implementation.worktreePath, 'status', '--porcelain')).toBe('');

    h.runtime.lastRun.writeFile('feature.txt', 'feature');
    h.runtime.lastRun.commit('feature');
    const committed = git(implementation.worktreePath, 'show', '--name-only', '--format=', 'HEAD');
    expect(committed).toBe('feature.txt');
  });

  it("passes the latest round's content, and says which round", async () => {
    const investigation = await completeSession(h, seeded, 'investigation', {
      content: '# Round 1\n',
    });
    await sendMessage(h, investigation, 'Look deeper.');
    h.runtime.lastRun.writeFile('.slop/investigation.md', '# Round 2\n');
    h.runtime.lastRun.ended('success');
    await waitForSession(h, investigation, (s) => s.status === 'ended');

    const planning = await startSession(h, seeded, 'planning');
    expect(read(planning, 'investigation')).toBe('# Round 2\n');
    expect(planning.inputArtifacts).toEqual([
      {
        sessionId: investigation.id,
        round: 2,
        phase: 'investigation',
        path: '.slop/context/investigation.md',
      },
    ]);
  });

  // Test plan Q2: a result counts while the session's latest round is complete.
  it("passes nothing once the source session's latest round is incomplete", async () => {
    const investigation = await completeSession(h, seeded, 'investigation');
    await sendMessage(h, investigation, 'Also commit your work.');
    h.runtime.lastRun.ended('success');
    const ended = await waitForSession(h, investigation, (s) => s.status === 'ended');
    expect(ended.artifactStatus).toBe('incomplete');

    expect((await startSession(h, seeded, 'planning')).inputArtifacts).toEqual([]);
  });
});
