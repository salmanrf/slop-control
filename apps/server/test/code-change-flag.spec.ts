import type { Session } from '@slop-control/shared';
import { resetDatabase } from './support/test-app';
import type { FakeRun } from './support/fake-runtime';
import {
  completeSession,
  createHarness,
  reportStarted,
  seedWorkspace,
  startSession,
  ticketPath,
  waitForSession,
  type Harness,
  type Seeded,
} from './support/session-harness';

const READ_ONLY = [['investigation'], ['planning'], ['code_review']] as const;

describe('code changes by read-only phases', () => {
  let h: Harness;
  let seeded: Seeded;
  let workspaceId: string;

  const terminal = (s: Session) => ['ended', 'failed', 'stopped'].includes(s.status);
  /** Starts a session, lets the test act in its worktree, and ends the run without an artifact. */
  const runSession = async (phase: string, work: (run: FakeRun) => void) => {
    const session = await startSession(h, seeded, phase);
    const run = h.runtime.lastRun;
    reportStarted(run);
    work(run);
    run.ended('success');
    return waitForSession(h, session, terminal);
  };
  const implement = () =>
    completeSession(h, seeded, 'implementation', {
      work: (run) => {
        run.writeFile('feature.txt', 'feature');
        run.commit('feature');
      },
    });

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

  it.each(READ_ONLY)('flags %s for an uncommitted change to a tracked file', async (phase) => {
    const ended = await runSession(phase, (run) => run.writeFile('README.md', 'changed'));
    expect(ended.scopeFlags).toEqual(['code_changed']);
  });

  it('flags a new untracked file outside .slop', async () => {
    const ended = await runSession('investigation', (run) => run.writeFile('notes/new.txt', 'new'));
    expect(ended.scopeFlags).toEqual(['code_changed']);
  });

  it('flags a commit, even when the worktree is left clean', async () => {
    const ended = await runSession('planning', (run) => {
      run.writeFile('README.md', 'changed');
      run.commit('sneaky');
    });
    expect(ended.scopeFlags).toEqual(['code_changed']);
  });

  it("doesn't flag the artifact or other files under .slop", async () => {
    const ended = await runSession('investigation', (run) => {
      run.writeFile('.slop/investigation.md', '# Findings\n');
      run.writeFile('.slop/scratch/notes.md', 'notes');
      run.writeFile('.slop/context/extra.md', 'extra');
    });
    expect(ended.scopeFlags).toEqual([]);
    expect(ended.artifactStatus).toBe('complete');
  });

  it("doesn't flag a session that was given context files and changed nothing", async () => {
    await completeSession(h, seeded, 'investigation');
    const planning = await completeSession(h, seeded, 'planning');
    expect(planning.inputArtifacts).toHaveLength(1);
    expect(planning.scopeFlags).toEqual([]);
  });

  it('never flags an implementation session', async () => {
    const committed = await implement();
    expect(committed.scopeFlags).toEqual([]);
    const uncommitted = await completeSession(h, seeded, 'implementation', {
      work: (run) => run.writeFile('README.md', 'changed'),
    });
    expect(uncommitted.scopeFlags).toEqual([]);
  });

  it("leaves a flagged session's status and result alone", async () => {
    const ended = await completeSession(h, seeded, 'investigation', {
      content: '# Findings\n',
      work: (run) => run.writeFile('README.md', 'changed'),
    });
    expect(ended).toMatchObject({
      status: 'ended',
      statusReason: null,
      artifactStatus: 'complete',
      scopeFlags: ['code_changed'],
    });
    const artifact = await h.api.get(`/workspaces/${workspaceId}/sessions/${ended.id}/artifact`);
    expect(artifact.body.markdown).toBe('# Findings\n');
  });

  it.each([
    ['fails', 'failed', (run: FakeRun) => run.ended('error', 'boom')],
    ['closes its stream early', 'failed', (run: FakeRun) => run.closeEarly()],
    ['throws', 'failed', (run: FakeRun) => run.fail(new Error('boom'))],
  ])('flags a session that changes code and then %s', async (_name, status, end) => {
    const session = await startSession(h, seeded, 'investigation');
    reportStarted(h.runtime.lastRun);
    h.runtime.lastRun.writeFile('README.md', 'changed');
    end(h.runtime.lastRun);
    const ended = await waitForSession(h, session, terminal);
    expect(ended.status).toBe(status);
    expect(ended.scopeFlags).toEqual(['code_changed']);
  });

  it('flags a session that changes code and is then stopped', async () => {
    const session = await startSession(h, seeded, 'investigation');
    reportStarted(h.runtime.lastRun);
    await waitForSession(h, session, (s) => s.status === 'running');
    h.runtime.lastRun.writeFile('README.md', 'changed');
    await h.api.post(`/workspaces/${workspaceId}/sessions/${session.id}/stop`);
    const stopped = await waitForSession(h, session, terminal);
    expect(stopped.status).toBe('stopped');
    expect(stopped.scopeFlags).toEqual(['code_changed']);
  });

  it('shows the flag on the first read that shows the terminal status', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const session = await startSession(h, seeded, 'investigation');
      h.runtime.lastRun.writeFile('README.md', 'changed');
      h.runtime.lastRun.ended('success');
      // `waitForSession` returns the first read that passes, so no later read can add the flag.
      const first = await waitForSession(h, session, terminal);
      expect(first.scopeFlags).toEqual(['code_changed']);
      expect(first.artifactStatus).toBe('incomplete');
    }
  });

  it("doesn't flag a code review for the implementation's commits it started from", async () => {
    await implement();
    const review = await completeSession(h, seeded, 'code_review');
    expect(review.baseRef).not.toBe('origin/main');
    expect(review.scopeFlags).toEqual([]);
  });

  it('flags a code review that commits on top of the implementation', async () => {
    await implement();
    const review = await completeSession(h, seeded, 'code_review', {
      work: (run) => {
        run.writeFile('feature.txt', 'reviewed');
        run.commit('fix it myself');
      },
    });
    expect(review.scopeFlags).toEqual(['code_changed']);
  });

  it("carries the flag in the ticket's history", async () => {
    const flagged = await runSession('investigation', (run) => run.writeFile('README.md', 'x'));
    const clean = await runSession('investigation', () => undefined);
    const history = (await h.api.get(`${ticketPath(seeded)}/sessions`)).body as Session[];
    expect(history.find((s) => s.id === flagged.id)!.scopeFlags).toEqual(['code_changed']);
    expect(history.find((s) => s.id === clean.id)!.scopeFlags).toEqual([]);
  });
});
