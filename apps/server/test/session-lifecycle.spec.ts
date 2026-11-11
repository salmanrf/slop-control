import type { LoggerService } from '@nestjs/common';
import type { Session } from '@slop-control/shared';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { FakeRuntime } from './support/fake-runtime';
import { ticket } from './support/fake-tracker';
import { git, tempDir } from './support/git';
import {
  createHarness,
  KEY,
  seedWorkspace,
  sendMessage,
  startSession,
  ticketPath,
  waitForSession,
  type Harness,
  type Seeded,
} from './support/session-harness';
import { resetDatabase } from './support/test-app';
import { CANARY_GITHUB_TOKEN } from './support/test-env';

const writeArtifact = (session: Session, relativePath: string, content: string | Buffer) => {
  const path = join(session.worktreePath, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

describe('session lifecycle', () => {
  let h: Harness;
  let seeded: Seeded;
  let workspaceId: string;

  const terminal = (s: Session) => ['ended', 'failed', 'stopped'].includes(s.status);

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.tickets.clear();
    h.runtime.throwOnStart = null;
    seeded = await seedWorkspace(h);
    ({ workspaceId } = seeded);
  });
  afterAll(() => h.close());

  it('moves to running with the runtime session ID and transcript path', async () => {
    const session = await startSession(h, seeded);
    h.runtime.lastRun.started('abc-123', '/transcripts/abc-123.jsonl');
    const running = await waitForSession(h, session, (s) => s.status === 'running');
    expect(running.runtimeSessionId).toBe('abc-123');
    expect(running.transcriptPath).toBe('/transcripts/abc-123.jsonl');
    expect(running.endedAt).toBeNull();
    expect(running.resumeCommand).toBeNull();
  });

  it('moves to ended on success, with an end time and no reason', async () => {
    const session = await startSession(h, seeded);
    h.runtime.lastRun.started();
    h.runtime.lastRun.ended('success');
    const ended = await waitForSession(h, session, (s) => s.status === 'ended');
    expect(ended.endedAt).not.toBeNull();
    expect(ended.statusReason).toBeNull();
  });

  it('moves to failed with the reason when the runtime reports an error', async () => {
    const session = await startSession(h, seeded);
    h.runtime.lastRun.started();
    h.runtime.lastRun.ended('error', 'auto mode was unavailable');
    const failed = await waitForSession(h, session, (s) => s.status === 'failed');
    expect(failed.statusReason).toBe('auto mode was unavailable');
    expect(failed.endedAt).not.toBeNull();
  });

  it('fails when the event stream closes without session_ended', async () => {
    const session = await startSession(h, seeded);
    h.runtime.lastRun.started();
    h.runtime.lastRun.closeEarly();
    const failed = await waitForSession(h, session, (s) => s.status === 'failed');
    expect(failed.statusReason).toContain('closed');
  });

  it('fails when the event stream throws, keeping the worktree', async () => {
    const session = await startSession(h, seeded);
    h.runtime.lastRun.fail(new Error('could not spawn'));
    const failed = await waitForSession(h, session, (s) => s.status === 'failed');
    expect(failed.statusReason).toContain('could not spawn');
    expect(existsSync(failed.worktreePath)).toBe(true);
  });

  it('fails when the runtime throws while starting, keeping the session and worktree', async () => {
    h.runtime.throwOnStart = new Error('sdk blew up');
    const session = await startSession(h, seeded);
    const failed = await waitForSession(h, session, (s) => s.status === 'failed');
    expect(failed.statusReason).toContain('sdk blew up');
    expect(existsSync(failed.worktreePath)).toBe(true);
  });

  describe('resume command', () => {
    it('appears on a finished session, and disappears with its worktree', async () => {
      const session = await startSession(h, seeded);
      h.runtime.lastRun.started('abc-123');
      h.runtime.lastRun.ended('success');
      const ended = await waitForSession(h, session, (s) => s.status === 'ended');
      expect(ended.resumeCommand).toBe(`cd ${session.worktreePath} && claude --resume abc-123`);

      const removed = await h.api.delete(
        `/workspaces/${workspaceId}/sessions/${session.id}/worktree`,
      );
      expect(removed.body.resumeCommand).toBeNull();
    });

    it('is absent when the runtime never reported a session ID', async () => {
      const session = await startSession(h, seeded);
      h.runtime.lastRun.closeEarly();
      const failed = await waitForSession(h, session, (s) => s.status === 'failed');
      expect(failed.resumeCommand).toBeNull();
    });
  });

  describe('required artifact', () => {
    const finish = async (session: Session) => {
      h.runtime.lastRun.started();
      h.runtime.lastRun.ended('success');
      return waitForSession(h, session, terminal);
    };
    const artifactOf = (session: Session) =>
      h.api.get(`/workspaces/${workspaceId}/sessions/${session.id}/artifact`);

    it('stays null until the session ends', async () => {
      const session = await startSession(h, seeded);
      h.runtime.lastRun.started();
      const running = await waitForSession(h, session, (s) => s.status === 'running');
      expect(running.artifactStatus).toBeNull();
    });

    it.each([
      ['investigation', '.slop/investigation.md'],
      ['planning', '.slop/plan.md'],
      ['implementation', '.slop/implementation-report.md'],
      ['code_review', '.slop/review-report.md'],
    ])('is complete for %s when its artifact exists', async (phase, path) => {
      const session = await startSession(h, seeded, phase);
      writeArtifact(session, path, '# Result\n');
      const ended = await finish(session);
      expect(ended.artifactStatus).toBe('complete');
      const artifact = await artifactOf(session);
      expect(artifact.status).toBe(200);
      expect(artifact.body).toMatchObject({
        sessionId: session.id,
        round: 1,
        path,
        markdown: '# Result\n',
      });
    });

    it("is incomplete when the file is another phase's artifact", async () => {
      const session = await startSession(h, seeded, 'investigation');
      writeArtifact(session, '.slop/plan.md', '# Plan\n');
      expect((await finish(session)).artifactStatus).toBe('incomplete');
    });

    it.each([
      ['missing', () => undefined],
      ['empty', (s: Session) => writeArtifact(s, '.slop/investigation.md', '')],
      [
        'not valid UTF-8',
        (s: Session) => writeArtifact(s, '.slop/investigation.md', Buffer.from([0xc3, 0x28])),
      ],
      [
        'holding a NUL byte, which Postgres text cannot store',
        (s: Session) => writeArtifact(s, '.slop/investigation.md', 'a\u0000b'),
      ],
      [
        'a directory',
        (s: Session) =>
          mkdirSync(join(s.worktreePath, '.slop/investigation.md'), { recursive: true }),
      ],
    ])('is incomplete when the artifact is %s, with nothing stored', async (_name, arrange) => {
      const session = await startSession(h, seeded);
      arrange(session);
      const ended = await finish(session);
      expect(ended.status).toBe('ended');
      expect(ended.artifactStatus).toBe('incomplete');
      expect((await artifactOf(session)).status).toBe(404);
    });

    it('does not follow a symlinked artifact out of the worktree', async () => {
      const secret = join(tempDir(), 'secret.md');
      writeFileSync(secret, 'outside the worktree');
      const session = await startSession(h, seeded);
      mkdirSync(join(session.worktreePath, '.slop'));
      symlinkSync(secret, join(session.worktreePath, '.slop/investigation.md'));

      expect((await finish(session)).artifactStatus).toBe('incomplete');
      expect((await artifactOf(session)).status).toBe(404);
    });

    it('does not follow a symlinked .slop folder out of the worktree', async () => {
      const outside = tempDir();
      writeFileSync(join(outside, 'investigation.md'), 'outside the worktree');
      const session = await startSession(h, seeded);
      symlinkSync(outside, join(session.worktreePath, '.slop'));

      expect((await finish(session)).artifactStatus).toBe('incomplete');
      expect((await artifactOf(session)).status).toBe(404);
    });

    it('is also checked on a failed or stopped session', async () => {
      const failed = await startSession(h, seeded);
      writeArtifact(failed, '.slop/investigation.md', '# Partial\n');
      h.runtime.lastRun.ended('error', 'boom');
      const result = await waitForSession(h, failed, terminal);
      expect(result.status).toBe('failed');
      expect(result.artifactStatus).toBe('complete');
    });

    it('stays readable after the worktree is removed', async () => {
      const session = await startSession(h, seeded);
      writeArtifact(session, '.slop/investigation.md', '# Kept\n');
      await finish(session);
      await h.api.delete(`/workspaces/${workspaceId}/sessions/${session.id}/worktree`);

      expect(existsSync(session.worktreePath)).toBe(false);
      expect((await artifactOf(session)).body.markdown).toBe('# Kept\n');
    });

    it('is stored before the final status can be seen', async () => {
      const session = await startSession(h, seeded);
      writeArtifact(session, '.slop/investigation.md', '# Ready\n');
      await finish(session);
      expect((await artifactOf(session)).status).toBe(200);
    });
  });

  describe('stop', () => {
    const stop = (session: Session) =>
      h.api.post(`/workspaces/${workspaceId}/sessions/${session.id}/stop`);

    it('stops the runtime and ends up stopped', async () => {
      const session = await startSession(h, seeded);
      h.runtime.lastRun.started();
      await waitForSession(h, session, (s) => s.status === 'running');

      const res = await stop(session);
      expect(res.status).toBe(200);
      expect(h.runtime.lastRun.stopCalls).toBe(1);
      const stopped = await waitForSession(h, session, (s) => s.status === 'stopped');
      expect(stopped.endedAt).not.toBeNull();
      expect(stopped.statusReason).toBeNull();
    });

    it('answers with the session already stopped', async () => {
      const session = await startSession(h, seeded);
      h.runtime.lastRun.started();
      await waitForSession(h, session, (s) => s.status === 'running');

      const res = await stop(session);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('stopped');
      expect(res.body.endedAt).not.toBeNull();
    });

    it('answers after the grace period when the agent is slow to end', async () => {
      const slow = await createHarness({ stopGraceMs: 50 });
      try {
        const other = await seedWorkspace(slow, 'slow');
        const session = await startSession(slow, other);
        const run = slow.runtime.lastRun;
        run.started();
        await waitForSession(slow, session, (s) => s.status === 'running');
        run.ignoreStop = true;

        const asked = Date.now();
        const res = await slow.api.post(
          `/workspaces/${other.workspaceId}/sessions/${session.id}/stop`,
        );
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('running');
        const waited = Date.now() - asked;
        expect(waited).toBeGreaterThanOrEqual(45);
        expect(waited).toBeLessThan(2000);

        // The end still reaches the record when it comes.
        run.ended('stopped');
        await waitForSession(slow, session, (s) => s.status === 'stopped');
      } finally {
        await slow.close();
      }
    });

    it('is safe to repeat', async () => {
      const session = await startSession(h, seeded);
      h.runtime.lastRun.started();
      await waitForSession(h, session, (s) => s.status === 'running');
      expect((await stop(session)).status).toBe(200);
      expect((await stop(session)).status).toBe(200);
      await waitForSession(h, session, (s) => s.status === 'stopped');
      expect((await stop(session)).status).toBe(200);
    });

    it('has no effect on a session that already ended', async () => {
      const session = await startSession(h, seeded);
      h.runtime.lastRun.ended('success');
      await waitForSession(h, session, terminal);
      const res = await stop(session);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ended');
      expect(h.runtime.lastRun.stopCalls).toBe(0);
    });

    it('returns 404 for an unknown session', async () => {
      const res = await h.api.post(
        `/workspaces/${workspaceId}/sessions/00000000-0000-4000-8000-000000000000/stop`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('worktree removal', () => {
    const remove = (session: Session, query = '') =>
      h.api.delete(`/workspaces/${workspaceId}/sessions/${session.id}/worktree${query}`);
    const finished = async () => {
      const session = await startSession(h, seeded);
      h.runtime.lastRun.started();
      h.runtime.lastRun.ended('success');
      await waitForSession(h, session, terminal);
      return session;
    };

    it('removes the worktree and keeps the branch', async () => {
      const session = await finished();
      const clone = (await h.api.get(`/workspaces/${workspaceId}/repos`)).body[0].localPath;
      const res = await remove(session);
      expect(res.status).toBe(200);
      expect(res.body.worktreeRemovedAt).not.toBeNull();
      expect(existsSync(session.worktreePath)).toBe(false);
      expect(git(clone, 'rev-parse', '--verify', session.branch)).not.toBe('');
    });

    it.each([['starting'], ['running']])('refuses while the session is %s', async (state) => {
      const session = await startSession(h, seeded);
      if (state === 'running') {
        h.runtime.lastRun.started();
        await waitForSession(h, session, (s) => s.status === 'running');
      }
      const res = await remove(session);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SESSION_ACTIVE');
      expect(existsSync(session.worktreePath)).toBe(true);
      h.runtime.lastRun.ended('success');
      await waitForSession(h, session, terminal);
    });

    it('refuses a dirty worktree unless forced', async () => {
      const session = await finished();
      writeFileSync(join(session.worktreePath, 'uncommitted.txt'), 'work');

      const refused = await remove(session);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('WORKTREE_DIRTY');
      expect(existsSync(session.worktreePath)).toBe(true);
      expect(
        (await h.api.get(`/workspaces/${workspaceId}/sessions/${session.id}`)).body
          .worktreeRemovedAt,
      ).toBeNull();

      const forced = await remove(session, '?force=true');
      expect(forced.status).toBe(200);
      expect(existsSync(session.worktreePath)).toBe(false);
    });

    it('has no effect the second time', async () => {
      const session = await finished();
      const first = await remove(session);
      const second = await remove(session);
      expect(second.status).toBe(200);
      expect(second.body.worktreeRemovedAt).toBe(first.body.worktreeRemovedAt);
    });
  });

  describe('history', () => {
    it('is empty for a ticket with no sessions', async () => {
      const res = await h.api.get(`${ticketPath(seeded)}/sessions`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns 404 for an unknown workspace', async () => {
      const res = await h.api.get(
        `${ticketPath({ ...seeded, workspaceId: '00000000-0000-4000-8000-000000000000' })}/sessions`,
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 for an unknown source', async () => {
      const res = await h.api.get(
        `${ticketPath({ workspaceId, sourceId: '00000000-0000-4000-8000-000000000000' })}/sessions`,
      );
      expect(res.status).toBe(404);
    });

    it("shows each session's ticket, repo, round, and flags", async () => {
      const session = await startSession(h, seeded);
      const res = await h.api.get(`${ticketPath(seeded)}/sessions`);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        id: session.id,
        ticketSourceId: seeded.sourceId,
        ticketTitle: `Title of ${KEY}`,
        linkedRepoId: seeded.repoId,
        round: 1,
        scopeFlags: [],
      });
    });
  });
});

describe('server restart', () => {
  beforeEach(resetDatabase);

  it('marks interrupted sessions as failed on boot, and leaves finished ones alone', async () => {
    const first = await createHarness();
    const seeded = await seedWorkspace(first);
    const { workspaceId } = seeded;
    const finished = await startSession(first, seeded);
    first.runtime.lastRun.started();
    first.runtime.lastRun.ended('success');
    await waitForSession(first, finished, (s) => s.status === 'ended');

    const starting = await startSession(first, seeded);
    const running = await startSession(first, seeded);
    first.runtime.lastRun.started();
    await waitForSession(first, running, (s) => s.status === 'running');
    await first.close();

    const second = await createHarness();
    try {
      const read = async (id: string) =>
        (await second.api.get(`/workspaces/${workspaceId}/sessions/${id}`)).body as Session;
      for (const id of [starting.id, running.id]) {
        const session = await read(id);
        expect(session.status).toBe('failed');
        expect(session.statusReason).toBe('server_restarted');
        expect(session.endedAt).not.toBeNull();
        expect(session.artifactStatus).toBe('incomplete');
      }
      expect((await read(finished.id)).status).toBe('ended');
      expect([...second.runtime.terminated].sort()).toEqual(
        [starting.worktreePath, running.worktreePath].sort(),
      );
    } finally {
      await second.close();
    }
  });
});

describe('server restart when cleaning up fails', () => {
  beforeEach(resetDatabase);

  it('still marks the session failed and finishes booting', async () => {
    const first = await createHarness();
    const seeded = await seedWorkspace(first);
    const { workspaceId } = seeded;
    const session = await startSession(first, seeded);
    await first.close();

    const runtime = new FakeRuntime();
    runtime.terminateFailure = new Error('lsof is missing');
    const second = await createHarness({ runtime });
    try {
      const read = await second.api.get(`/workspaces/${workspaceId}/sessions/${session.id}`);
      expect(read.body.status).toBe('failed');
      expect(read.body.statusReason).toBe('server_restarted');
    } finally {
      await second.close();
    }
  });
});

describe('credentials (NFR-4)', () => {
  const lines: string[] = [];
  const logger: LoggerService = {
    log: (message) => void lines.push(String(message)),
    error: (message) => void lines.push(String(message)),
    warn: (message) => void lines.push(String(message)),
  };
  let h: Harness;
  let seeded: Seeded;
  let workspaceId: string;

  beforeAll(async () => {
    h = await createHarness();
    h.app.useLogger(logger);
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.tickets.clear();
    lines.length = 0;
    seeded = await seedWorkspace(h);
    ({ workspaceId } = seeded);
  });
  afterAll(() => h.close());

  it.each([
    [
      'a reported error',
      (run: Harness['runtime']['lastRun']) =>
        run.ended('error', `bad token ${CANARY_GITHUB_TOKEN}`),
    ],
    [
      'a thrown error',
      (run: Harness['runtime']['lastRun']) =>
        run.fail(new Error(`bad token ${CANARY_GITHUB_TOKEN}`)),
    ],
  ])('redacts the token from %s, in the record and in logs', async (_name, act) => {
    const session = await startSession(h, seeded);
    act(h.runtime.lastRun);
    const failed = await waitForSession(h, session, (s) => s.status === 'failed');

    expect(failed.statusReason).toContain('bad token');
    expect(JSON.stringify(failed)).not.toContain(CANARY_GITHUB_TOKEN);
    expect(lines.join('\n')).toContain('bad token');
    expect(lines.join('\n')).not.toContain(CANARY_GITHUB_TOKEN);
  });

  it('keeps the token out of the session record, at launch and after a follow-up', async () => {
    h.tracker.add(
      ticket(KEY, {
        title: `Rotate ${CANARY_GITHUB_TOKEN}`,
        body: `The token ${CANARY_GITHUB_TOKEN} leaked.`,
      }),
    );
    const session = await startSession(h, seeded);
    expect(session.brief).toContain('leaked');
    expect(JSON.stringify(session)).not.toContain(CANARY_GITHUB_TOKEN);
    expect(JSON.stringify(h.runtime.starts.at(-1))).not.toContain(CANARY_GITHUB_TOKEN);

    h.runtime.lastRun.started('rt-1');
    h.runtime.lastRun.ended('success');
    await waitForSession(h, session, (s) => s.status === 'ended');
    const resumed = await sendMessage(h, session);
    expect(JSON.stringify(resumed)).not.toContain(CANARY_GITHUB_TOKEN);

    h.runtime.lastRun.ended('error', `resume failed with ${CANARY_GITHUB_TOKEN}`);
    const failed = await waitForSession(h, session, (s) => s.status === 'failed');
    expect(failed.statusReason).toContain('resume failed');
    expect(JSON.stringify(failed)).not.toContain(CANARY_GITHUB_TOKEN);
    const history = await h.api.get(`${ticketPath(seeded)}/sessions`);
    expect(JSON.stringify(history.body)).not.toContain(CANARY_GITHUB_TOKEN);
  });

  it('keeps the token out of the worktree, including the context files', async () => {
    const investigation = await startSession(h, seeded);
    h.runtime.lastRun.started('rt-1');
    h.runtime.lastRun.writeFile(
      '.slop/investigation.md',
      `# Findings\nThe token is ${CANARY_GITHUB_TOKEN}.\n`,
    );
    h.runtime.lastRun.ended('success');
    await waitForSession(h, investigation, (s) => s.status === 'ended');
    const stored = await h.api.get(
      `/workspaces/${workspaceId}/sessions/${investigation.id}/artifact`,
    );
    expect(stored.body.markdown).toContain('# Findings');
    expect(stored.body.markdown).not.toContain(CANARY_GITHUB_TOKEN);

    const planning = await startSession(h, seeded, 'planning');
    const files = readdirSync(planning.worktreePath, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
    expect(files).toContain(join(planning.worktreePath, '.slop/context/investigation.md'));
    for (const file of files) {
      expect(readFileSync(file, 'utf8')).not.toContain(CANARY_GITHUB_TOKEN);
    }
  });

  it('keeps the token out of the logs across a launch, a follow-up, a restore, and a preview', async () => {
    h.tracker.add(ticket(KEY, { body: `The token ${CANARY_GITHUB_TOKEN} leaked.` }));
    const session = await startSession(h, seeded);
    h.runtime.lastRun.started('rt-1');
    h.runtime.lastRun.writeFile('.slop/investigation.md', `token ${CANARY_GITHUB_TOKEN}`);
    h.runtime.lastRun.ended('success');
    await waitForSession(h, session, (s) => s.status === 'ended');
    await h.api.delete(`/workspaces/${workspaceId}/sessions/${session.id}/worktree`);

    await sendMessage(h, session);
    h.runtime.lastRun.fail(new Error(`resume failed with ${CANARY_GITHUB_TOKEN}`));
    await waitForSession(h, session, (s) => s.status === 'failed');
    const preview = await h.api.get(`${ticketPath(seeded)}/launch-preview?phase=planning`);
    expect(preview.status).toBe(200);
    expect(JSON.stringify(preview.body)).not.toContain(CANARY_GITHUB_TOKEN);

    expect(lines.join('\n')).toContain('resume failed');
    expect(lines.join('\n')).not.toContain(CANARY_GITHUB_TOKEN);
  });
});
