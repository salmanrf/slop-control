import type { Session } from '@slop-control/shared';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TrackerUnavailableError } from '../src/tickets/tracker';
import type { FakeRun } from './support/fake-runtime';
import { git } from './support/git';
import { resetDatabase } from './support/test-app';
import {
  completeSession,
  createHarness,
  reportStarted,
  seedWorkspace,
  sendMessage,
  startSession,
  waitForSession,
  type Harness,
  type Seeded,
} from './support/session-harness';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const ARTIFACT = '.slop/investigation.md';

describe('follow-up messages', () => {
  let h: Harness;
  let seeded: Seeded;
  let workspaceId: string;
  let clone: string;

  const terminal = (s: Session) => ['ended', 'failed', 'stopped'].includes(s.status);
  const base = (session: { id: string }) => `/workspaces/${workspaceId}/sessions/${session.id}`;
  const post = (session: { id: string }, body: unknown = { message: 'Carry on.' }) =>
    h.api.post(`${base(session)}/messages`).send(body as object);
  const read = async (session: { id: string }) => (await h.api.get(base(session))).body as Session;
  const artifactOf = (session: { id: string }) => h.api.get(`${base(session)}/artifact`);
  /** Ends the round in progress, after letting the test act in the worktree. */
  const endRound = async (
    session: Session,
    work: (run: FakeRun) => void = () => undefined,
    outcome: 'success' | 'error' = 'success',
  ) => {
    const run = h.runtime.lastRun;
    work(run);
    run.ended(outcome, outcome === 'error' ? 'boom' : null);
    return waitForSession(h, session, terminal);
  };
  /** A complete investigation, with `# Round 1` as its stored result. */
  const investigated = () =>
    completeSession(h, seeded, 'investigation', { content: '# Round 1\n' });

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.runtime.readiness = { ready: true };
    h.tracker.reset();
    seeded = await seedWorkspace(h);
    ({ workspaceId, clone } = seeded);
  });
  afterAll(() => h.close());

  it('resumes an ended session as a new round, without starting it again', async () => {
    const session = await investigated();
    const starts = h.runtime.starts.length;
    const resumes = h.runtime.resumes.length;

    const res = await post(session, { message: 'Look at the tests too.' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      id: session.id,
      status: 'running',
      round: 2,
      statusReason: null,
      endedAt: null,
      artifactStatus: null,
      resumeCommand: null,
      runtimeSessionId: session.runtimeSessionId,
    });
    expect(h.runtime.resumes).toHaveLength(resumes + 1);
    expect(h.runtime.resumes.at(-1)).toMatchObject({
      runtimeSessionId: session.runtimeSessionId,
      message: 'Look at the tests too.',
      cwd: session.worktreePath,
    });
    expect(h.runtime.starts).toHaveLength(starts);
    await endRound(session);
  });

  it.each([
    ['failed', (run: FakeRun) => run.ended('error', 'boom')],
    ['stopped', (run: FakeRun) => void run.stop()],
  ])('accepts a follow-up to a %s session that has a runtime session ID', async (status, end) => {
    const session = await startSession(h, seeded);
    const runtimeSessionId = reportStarted(h.runtime.lastRun);
    await waitForSession(h, session, (s) => s.status === 'running');
    end(h.runtime.lastRun);
    expect((await waitForSession(h, session, terminal)).status).toBe(status);

    const res = await post(session);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'running', round: 2, statusReason: null });
    expect(h.runtime.resumes.at(-1)!.runtimeSessionId).toBe(runtimeSessionId);
    await endRound(session);
  });

  describe("the round's artifact", () => {
    it('is stored under the new round when it changed', async () => {
      const session = await investigated();
      await sendMessage(h, session);
      const ended = await endRound(session, (run) => run.writeFile(ARTIFACT, '# Round 2\n'));
      expect(ended).toMatchObject({ status: 'ended', round: 2, artifactStatus: 'complete' });
      expect((await artifactOf(session)).body).toMatchObject({ round: 2, markdown: '# Round 2\n' });
    });

    it('leaves the round incomplete when untouched, with the earlier copy still readable', async () => {
      const session = await investigated();
      await sendMessage(h, session, 'Also commit your work.');
      const ended = await endRound(session);
      expect(ended).toMatchObject({ status: 'ended', round: 2, artifactStatus: 'incomplete' });
      expect((await artifactOf(session)).body).toMatchObject({ round: 1, markdown: '# Round 1\n' });
    });

    it('compares content, so rewriting the same text is still incomplete', async () => {
      const session = await investigated();
      await sendMessage(h, session);
      const ended = await endRound(session, (run) => run.writeFile(ARTIFACT, '# Round 1\n'));
      expect(ended.artifactStatus).toBe('incomplete');
      expect((await artifactOf(session)).body.round).toBe(1);
    });

    it('completes a session whose first round wrote nothing', async () => {
      const session = await startSession(h, seeded);
      reportStarted(h.runtime.lastRun);
      h.runtime.lastRun.ended('success');
      expect((await waitForSession(h, session, terminal)).artifactStatus).toBe('incomplete');
      expect((await artifactOf(session)).status).toBe(404);

      await sendMessage(h, session, 'Write the investigation.');
      const ended = await endRound(session, (run) => run.writeFile(ARTIFACT, '# At last\n'));
      expect(ended.artifactStatus).toBe('complete');
      expect((await artifactOf(session)).body).toMatchObject({ round: 2, markdown: '# At last\n' });
    });

    it("stays readable as the previous round's while a new round runs", async () => {
      const session = await investigated();
      await sendMessage(h, session);
      h.runtime.lastRun.writeFile(ARTIFACT, '# Half written\n');
      expect((await read(session)).status).toBe('running');
      expect((await artifactOf(session)).body).toMatchObject({ round: 1, markdown: '# Round 1\n' });
      await endRound(session);
    });

    it('returns the latest stored copy across three rounds', async () => {
      const session = await investigated();
      await sendMessage(h, session);
      expect((await endRound(session, (run) => run.writeFile(ARTIFACT, '# Round 2\n'))).round).toBe(
        2,
      );
      expect((await artifactOf(session)).body.markdown).toBe('# Round 2\n');

      await sendMessage(h, session);
      const third = await endRound(session);
      expect(third).toMatchObject({ round: 3, artifactStatus: 'incomplete' });
      expect((await artifactOf(session)).body).toMatchObject({ round: 2, markdown: '# Round 2\n' });
      expect(h.runtime.resumes.filter((r) => r.cwd === session.worktreePath)).toHaveLength(2);
    });
  });

  describe('a removed worktree', () => {
    /** An implementation given the investigation, with a commit, whose worktree is then removed. */
    const removedImplementation = async () => {
      const investigation = await completeSession(h, seeded, 'investigation', {
        content: '# Findings v1\n',
      });
      const session = await completeSession(h, seeded, 'implementation', {
        content: '# Report\n',
        work: (run) => {
          run.writeFile('feature.txt', 'feature');
          run.commit('feature');
        },
      });
      const removed = await h.api.delete(`${base(session)}/worktree`);
      expect(removed.body.worktreeRemovedAt).not.toBeNull();
      expect(existsSync(session.worktreePath)).toBe(false);
      return { investigation, session };
    };

    it('is restored on its branch with its commits, artifact, and context files', async () => {
      const { session } = await removedImplementation();
      const tip = git(clone, 'rev-parse', session.branch);

      const res = await post(session);
      expect(res.status).toBe(202);
      expect(res.body.worktreeRemovedAt).toBeNull();
      expect(res.body.worktreePath).toBe(session.worktreePath);
      expect(git(session.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(session.branch);
      expect(git(session.worktreePath, 'rev-parse', 'HEAD')).toBe(tip);
      expect(readFileSync(join(session.worktreePath, 'feature.txt'), 'utf8')).toBe('feature');
      expect(
        readFileSync(join(session.worktreePath, '.slop/implementation-report.md'), 'utf8'),
      ).toBe('# Report\n');
      expect(
        readFileSync(join(session.worktreePath, '.slop/context/investigation.md'), 'utf8'),
      ).toBe('# Findings v1\n');
      expect(git(session.worktreePath, 'status', '--porcelain')).toBe('');

      const ended = await endRound(session, (run) =>
        run.writeFile('.slop/implementation-report.md', '# Report, round 2\n'),
      );
      expect(ended).toMatchObject({
        round: 2,
        artifactStatus: 'complete',
        worktreeRemovedAt: null,
      });
      expect(ended.resumeCommand).not.toBeNull();
    });

    it('gets back the context it was originally given, not a newer round of it', async () => {
      const { investigation, session } = await removedImplementation();
      await sendMessage(h, investigation, 'Look deeper.');
      await endRound(investigation, (run) => run.writeFile(ARTIFACT, '# Findings v2\n'));

      await sendMessage(h, session);
      expect(
        readFileSync(join(session.worktreePath, '.slop/context/investigation.md'), 'utf8'),
      ).toBe('# Findings v1\n');
      expect((await read(session)).inputArtifacts[0]).toMatchObject({
        sessionId: investigation.id,
        round: 1,
      });
      await endRound(session);
    });

    it("can't be restored once its branch is deleted, and the session is left as it was", async () => {
      const { session } = await removedImplementation();
      const before = await read(session);
      git(clone, 'branch', '-D', session.branch);
      const resumes = h.runtime.resumes.length;

      const res = await post(session);
      expect(res.status).toBe(500);
      expect(res.body.code).toBe('WORKTREE_CREATE_FAILED');
      expect(await read(session)).toEqual(before);
      expect(before.worktreeRemovedAt).not.toBeNull();
      expect(h.runtime.resumes).toHaveLength(resumes);
      expect(existsSync(session.worktreePath)).toBe(false);
    });

    it("isn't restored when the runtime isn't ready", async () => {
      const { session } = await removedImplementation();
      const before = await read(session);
      h.runtime.readiness = { ready: false, message: "Claude Code isn't signed in." };

      const res = await post(session);
      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        code: 'RUNTIME_NOT_READY',
        message: "Claude Code isn't signed in.",
      });
      expect(await read(session)).toEqual(before);
      expect(existsSync(session.worktreePath)).toBe(false);
    });

    it("isn't flagged for being restored, when a read-only round changes nothing", async () => {
      await completeSession(h, seeded, 'investigation');
      const planning = await completeSession(h, seeded, 'planning');
      await h.api.delete(`${base(planning)}/worktree`);

      await sendMessage(h, planning);
      const ended = await endRound(planning);
      expect(ended.scopeFlags).toEqual([]);
      expect(ended.worktreeRemovedAt).toBeNull();
    });
  });

  it('runs with the setup the session started with, whatever the phase setup says now', async () => {
    const session = await investigated();
    await h.api
      .patch(`/workspaces/${workspaceId}/phase-setups/investigation`)
      .send({ instruction: 'Do something else entirely.', userLevelSource: true });

    const resumed = await sendMessage(h, session);
    expect(h.runtime.resumes.at(-1)!.setup).toEqual({
      permissionMode: 'auto',
      scope: session.setup.scope,
      userLevelSource: false,
    });
    expect(resumed.setup).toEqual(session.setup);
    expect((await endRound(session)).setup).toEqual(session.setup);
  });

  it.each([['starting'], ['running']])('is rejected while the session is %s', async (state) => {
    const session = await startSession(h, seeded);
    if (state === 'running') {
      reportStarted(h.runtime.lastRun);
      await waitForSession(h, session, (s) => s.status === 'running');
    }
    const resumes = h.runtime.resumes.length;
    const res = await post(session);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SESSION_ACTIVE');
    expect((await read(session)).round).toBe(1);
    expect(h.runtime.resumes).toHaveLength(resumes);
    await endRound(session);
  });

  it('is rejected while a follow-up round is running', async () => {
    const session = await investigated();
    await sendMessage(h, session);
    const res = await post(session);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SESSION_ACTIVE');
    expect((await read(session)).round).toBe(2);
    await endRound(session);
  });

  it('lets only one of two requests at once start a round', async () => {
    const session = await investigated();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const resumes = h.runtime.resumes.length;
      const before = (await read(session)).round;

      const responses = await Promise.all([post(session), post(session)]);
      expect(responses.map((res) => res.status).sort()).toEqual([202, 409]);
      expect(responses.find((res) => res.status === 409)!.body.code).toBe('SESSION_ACTIVE');
      expect(h.runtime.resumes).toHaveLength(resumes + 1);
      expect((await read(session)).round).toBe(before + 1);
      await endRound(session);
    }
  });

  it("can't resume a session Claude Code never started, and says so", async () => {
    const session = await startSession(h, seeded);
    h.runtime.lastRun.closeEarly();
    const failed = await waitForSession(h, session, terminal);
    expect(failed.runtimeSessionId).toBeNull();

    const res = await post(session);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SESSION_NOT_RESUMABLE');
    expect(res.body.message).toContain('new session');
    expect(await read(session)).toEqual(failed);
  });

  it.each([
    ['blank', { message: '' }],
    ['whitespace only', { message: ' \n\t ' }],
    ['missing', {}],
    ['not text', { message: 42 }],
  ])('rejects a message that is %s', async (_name, body) => {
    const session = await investigated();
    const resumes = h.runtime.resumes.length;
    const res = await post(session, body);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(await read(session)).toEqual(session);
    expect(h.runtime.resumes).toHaveLength(resumes);
  });

  it("is refused when the runtime isn't ready, leaving the session as it was", async () => {
    const session = await investigated();
    h.runtime.readiness = { ready: false, message: "Claude Code isn't signed in." };
    const res = await post(session);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('RUNTIME_NOT_READY');
    expect(await read(session)).toEqual(session);
  });

  it('returns 404 for an unknown session, and for a session in another workspace', async () => {
    const session = await investigated();
    expect((await post({ id: UNKNOWN })).status).toBe(404);

    const other = await seedWorkspace(h, 'other');
    const res = await h.api
      .post(`/workspaces/${other.workspaceId}/sessions/${session.id}/messages`)
      .send({ message: 'Carry on.' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect((await read(session)).round).toBe(1);
  });

  it('can be stopped like any running session, and then continued again', async () => {
    const session = await investigated();
    await sendMessage(h, session);
    const round = h.runtime.lastRun;

    const res = await h.api.post(`${base(session)}/stop`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'stopped', round: 2 });
    expect(round.stopCalls).toBe(1);
    const stopped = await waitForSession(h, session, terminal);
    expect(stopped).toMatchObject({ status: 'stopped', round: 2, statusReason: null });
    expect((await artifactOf(session)).body).toMatchObject({ round: 1, markdown: '# Round 1\n' });

    const third = await post(session);
    expect(third.status).toBe(202);
    expect(third.body.round).toBe(3);
    await endRound(session);
  });

  it.each([
    ['reports an error', 'boom', (run: FakeRun) => run.ended('error', 'boom')],
    ['closes its stream early', 'closed', (run: FakeRun) => run.closeEarly()],
    ['throws', 'could not resume', (run: FakeRun) => run.fail(new Error('could not resume'))],
  ])(
    'fails the round when its run %s, and accepts another follow-up',
    async (_name, reason, end) => {
      const session = await investigated();
      await sendMessage(h, session);
      end(h.runtime.lastRun);
      const failed = await waitForSession(h, session, terminal);
      expect(failed).toMatchObject({ status: 'failed', round: 2, artifactStatus: 'incomplete' });
      expect(failed.statusReason).toContain(reason);
      expect(failed.endedAt).not.toBeNull();

      const again = await post(session);
      expect(again.status).toBe(202);
      expect(again.body).toMatchObject({ round: 3, statusReason: null });
      await endRound(session);
    },
  );

  describe('code changes by a read-only session', () => {
    it('are flagged when they happen in a later round only', async () => {
      const session = await investigated();
      expect(session.scopeFlags).toEqual([]);
      await sendMessage(h, session, 'Fix it while you are there.');
      const ended = await endRound(session, (run) => run.writeFile('README.md', 'changed'));
      expect(ended.scopeFlags).toEqual(['code_changed']);
    });

    it('stay flagged after a later round reverts them', async () => {
      const session = await completeSession(h, seeded, 'investigation', {
        work: (run) => run.writeFile('extra.txt', 'changed'),
      });
      expect(session.scopeFlags).toEqual(['code_changed']);

      await sendMessage(h, session, 'Undo that.');
      const ended = await endRound(session, () => {
        git(session.worktreePath, 'clean', '-fdq', '--', 'extra.txt');
      });
      expect(git(session.worktreePath, 'status', '--porcelain')).toBe('');
      expect(ended.scopeFlags).toEqual(['code_changed']);
    });
  });

  it.each([
    [
      'is disconnected',
      async () =>
        void (await h.api.delete(`/workspaces/${workspaceId}/sources/${seeded.sourceId}`)),
    ],
    [
      'is unreachable',
      async () => {
        h.tracker.failure = new TrackerUnavailableError('down');
      },
    ],
  ])("doesn't read the ticket, so it works when the source %s", async (_name, arrange) => {
    const session = await investigated();
    await arrange();
    const calls = { ...h.tracker.source().calls };

    const res = await post(session);
    expect(res.status).toBe(202);
    expect(h.tracker.source().calls).toEqual(calls);
    await endRound(session);
  });

  it('hides the resume command while a round runs, and brings it back after', async () => {
    const session = await investigated();
    expect(session.resumeCommand).not.toBeNull();
    expect((await sendMessage(h, session)).resumeCommand).toBeNull();
    expect((await read(session)).resumeCommand).toBeNull();
    expect((await endRound(session)).resumeCommand).toBe(session.resumeCommand);
  });

  it('keeps stop and worktree removal working on a disconnected source', async () => {
    const session = await investigated();
    await h.api.delete(`/workspaces/${workspaceId}/sources/${seeded.sourceId}`);
    await sendMessage(h, session);

    expect((await h.api.post(`${base(session)}/stop`)).status).toBe(200);
    await waitForSession(h, session, terminal);
    const removed = await h.api.delete(`${base(session)}/worktree`);
    expect(removed.status).toBe(200);
    expect(removed.body.worktreeRemovedAt).not.toBeNull();
  });
});

describe('server restart during a follow-up round', () => {
  beforeEach(resetDatabase);

  it('marks the round failed on boot, and keeps the earlier result readable', async () => {
    const first = await createHarness();
    const seeded = await seedWorkspace(first);
    const session = await completeSession(first, seeded, 'investigation', {
      content: '# Round 1\n',
    });
    await sendMessage(first, session);
    first.runtime.lastRun.ignoreStop = true;
    await first.close();

    const second = await createHarness();
    try {
      const path = `/workspaces/${seeded.workspaceId}/sessions/${session.id}`;
      const read = (await second.api.get(path)).body as Session;
      expect(read).toMatchObject({
        status: 'failed',
        statusReason: 'server_restarted',
        round: 2,
        artifactStatus: 'incomplete',
      });
      expect(read.endedAt).not.toBeNull();
      expect(second.runtime.terminated).toEqual([session.worktreePath]);
      expect((await second.api.get(`${path}/artifact`)).body).toMatchObject({
        round: 1,
        markdown: '# Round 1\n',
      });
    } finally {
      await second.close();
    }
  });
});
