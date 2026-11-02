import type { LoggerService } from '@nestjs/common';
import type { Session } from '@slop-control/shared';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, tempDir } from './support/git';
import {
  createHarness,
  ENCODED_KEY,
  seedWorkspace,
  startSession,
  waitForSession,
  type Harness,
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
  let workspaceId: string;

  const terminal = (s: Session) => ['ended', 'failed', 'stopped'].includes(s.status);

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.tickets.clear();
    h.runtime.throwOnStart = null;
    ({ workspaceId } = await seedWorkspace(h));
  });
  afterAll(() => h.close());

  it('moves to running with the runtime session ID and transcript path', async () => {
    const session = await startSession(h, workspaceId);
    h.runtime.lastRun.started('abc-123', '/transcripts/abc-123.jsonl');
    const running = await waitForSession(h, session, (s) => s.status === 'running');
    expect(running.runtimeSessionId).toBe('abc-123');
    expect(running.transcriptPath).toBe('/transcripts/abc-123.jsonl');
    expect(running.endedAt).toBeNull();
    expect(running.resumeCommand).toBeNull();
  });

  it('moves to ended on success, with an end time and no reason', async () => {
    const session = await startSession(h, workspaceId);
    h.runtime.lastRun.started();
    h.runtime.lastRun.ended('success');
    const ended = await waitForSession(h, session, (s) => s.status === 'ended');
    expect(ended.endedAt).not.toBeNull();
    expect(ended.statusReason).toBeNull();
  });

  it('moves to failed with the reason when the runtime reports an error', async () => {
    const session = await startSession(h, workspaceId);
    h.runtime.lastRun.started();
    h.runtime.lastRun.ended('error', 'auto mode was unavailable');
    const failed = await waitForSession(h, session, (s) => s.status === 'failed');
    expect(failed.statusReason).toBe('auto mode was unavailable');
    expect(failed.endedAt).not.toBeNull();
  });

  it('fails when the event stream closes without session_ended', async () => {
    const session = await startSession(h, workspaceId);
    h.runtime.lastRun.started();
    h.runtime.lastRun.closeEarly();
    const failed = await waitForSession(h, session, (s) => s.status === 'failed');
    expect(failed.statusReason).toContain('closed');
  });

  it('fails when the event stream throws, keeping the worktree', async () => {
    const session = await startSession(h, workspaceId);
    h.runtime.lastRun.fail(new Error('could not spawn'));
    const failed = await waitForSession(h, session, (s) => s.status === 'failed');
    expect(failed.statusReason).toContain('could not spawn');
    expect(existsSync(failed.worktreePath)).toBe(true);
  });

  it('fails when the runtime throws while starting, keeping the session and worktree', async () => {
    h.runtime.throwOnStart = new Error('sdk blew up');
    const session = await startSession(h, workspaceId);
    const failed = await waitForSession(h, session, (s) => s.status === 'failed');
    expect(failed.statusReason).toContain('sdk blew up');
    expect(existsSync(failed.worktreePath)).toBe(true);
  });

  describe('resume command', () => {
    it('appears on a finished session, and disappears with its worktree', async () => {
      const session = await startSession(h, workspaceId);
      h.runtime.lastRun.started('abc-123');
      h.runtime.lastRun.ended('success');
      const ended = await waitForSession(h, session, (s) => s.status === 'ended');
      expect(ended.resumeCommand).toBe(`cd ${session.worktreePath} && claude --resume abc-123`);

      const removed = await h.api.delete(`/workspaces/${workspaceId}/sessions/${session.id}/worktree`);
      expect(removed.body.resumeCommand).toBeNull();
    });

    it('is absent when the runtime never reported a session ID', async () => {
      const session = await startSession(h, workspaceId);
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
      const session = await startSession(h, workspaceId);
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
      const session = await startSession(h, workspaceId, phase);
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
      const session = await startSession(h, workspaceId, 'investigation');
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
      ['a directory', (s: Session) => mkdirSync(join(s.worktreePath, '.slop/investigation.md'), { recursive: true })],
    ])('is incomplete when the artifact is %s, with nothing stored', async (_name, arrange) => {
      const session = await startSession(h, workspaceId);
      arrange(session);
      const ended = await finish(session);
      expect(ended.status).toBe('ended');
      expect(ended.artifactStatus).toBe('incomplete');
      expect((await artifactOf(session)).status).toBe(404);
    });

    it('does not follow a symlinked artifact out of the worktree', async () => {
      const secret = join(tempDir(), 'secret.md');
      writeFileSync(secret, 'outside the worktree');
      const session = await startSession(h, workspaceId);
      mkdirSync(join(session.worktreePath, '.slop'));
      symlinkSync(secret, join(session.worktreePath, '.slop/investigation.md'));

      expect((await finish(session)).artifactStatus).toBe('incomplete');
      expect((await artifactOf(session)).status).toBe(404);
    });

    it('does not follow a symlinked .slop folder out of the worktree', async () => {
      const outside = tempDir();
      writeFileSync(join(outside, 'investigation.md'), 'outside the worktree');
      const session = await startSession(h, workspaceId);
      symlinkSync(outside, join(session.worktreePath, '.slop'));

      expect((await finish(session)).artifactStatus).toBe('incomplete');
      expect((await artifactOf(session)).status).toBe(404);
    });

    it('is also checked on a failed or stopped session', async () => {
      const failed = await startSession(h, workspaceId);
      writeArtifact(failed, '.slop/investigation.md', '# Partial\n');
      h.runtime.lastRun.ended('error', 'boom');
      const result = await waitForSession(h, failed, terminal);
      expect(result.status).toBe('failed');
      expect(result.artifactStatus).toBe('complete');
    });

    it('stays readable after the worktree is removed', async () => {
      const session = await startSession(h, workspaceId);
      writeArtifact(session, '.slop/investigation.md', '# Kept\n');
      await finish(session);
      await h.api.delete(`/workspaces/${workspaceId}/sessions/${session.id}/worktree`);

      expect(existsSync(session.worktreePath)).toBe(false);
      expect((await artifactOf(session)).body.markdown).toBe('# Kept\n');
    });

    it('is stored before the final status can be seen', async () => {
      const session = await startSession(h, workspaceId);
      writeArtifact(session, '.slop/investigation.md', '# Ready\n');
      await finish(session);
      expect((await artifactOf(session)).status).toBe(200);
    });
  });

  describe('stop', () => {
    const stop = (session: Session) =>
      h.api.post(`/workspaces/${workspaceId}/sessions/${session.id}/stop`);

    it('stops the runtime and ends up stopped', async () => {
      const session = await startSession(h, workspaceId);
      h.runtime.lastRun.started();
      await waitForSession(h, session, (s) => s.status === 'running');

      const res = await stop(session);
      expect(res.status).toBe(200);
      expect(h.runtime.lastRun.stopCalls).toBe(1);
      const stopped = await waitForSession(h, session, (s) => s.status === 'stopped');
      expect(stopped.endedAt).not.toBeNull();
      expect(stopped.statusReason).toBeNull();
    });

    it('is safe to repeat', async () => {
      const session = await startSession(h, workspaceId);
      h.runtime.lastRun.started();
      await waitForSession(h, session, (s) => s.status === 'running');
      expect((await stop(session)).status).toBe(200);
      expect((await stop(session)).status).toBe(200);
      await waitForSession(h, session, (s) => s.status === 'stopped');
      expect((await stop(session)).status).toBe(200);
    });

    it('has no effect on a session that already ended', async () => {
      const session = await startSession(h, workspaceId);
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
      const session = await startSession(h, workspaceId);
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
      const session = await startSession(h, workspaceId);
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
      expect((await h.api.get(`/workspaces/${workspaceId}/sessions/${session.id}`)).body.worktreeRemovedAt).toBeNull();

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
      const res = await h.api.get(`/workspaces/${workspaceId}/tickets/${ENCODED_KEY}/sessions`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns 404 for an unknown workspace', async () => {
      const res = await h.api.get(
        `/workspaces/00000000-0000-4000-8000-000000000000/tickets/${ENCODED_KEY}/sessions`,
      );
      expect(res.status).toBe(404);
    });
  });
});

describe('server restart', () => {
  beforeEach(resetDatabase);

  it('marks interrupted sessions as failed on boot, and leaves finished ones alone', async () => {
    const first = await createHarness();
    const { workspaceId } = await seedWorkspace(first);
    const finished = await startSession(first, workspaceId);
    first.runtime.lastRun.started();
    first.runtime.lastRun.ended('success');
    await waitForSession(first, finished, (s) => s.status === 'ended');

    const starting = await startSession(first, workspaceId);
    const running = await startSession(first, workspaceId);
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
  let workspaceId: string;

  beforeAll(async () => {
    h = await createHarness();
    h.app.useLogger(logger);
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.tickets.clear();
    lines.length = 0;
    ({ workspaceId } = await seedWorkspace(h));
  });
  afterAll(() => h.close());

  it.each([
    ['a reported error', (run: Harness['runtime']['lastRun']) => run.ended('error', `bad token ${CANARY_GITHUB_TOKEN}`)],
    ['a thrown error', (run: Harness['runtime']['lastRun']) => run.fail(new Error(`bad token ${CANARY_GITHUB_TOKEN}`))],
  ])('redacts the token from %s, in the record and in logs', async (_name, act) => {
    const session = await startSession(h, workspaceId);
    act(h.runtime.lastRun);
    const failed = await waitForSession(h, session, (s) => s.status === 'failed');

    expect(failed.statusReason).toContain('bad token');
    expect(JSON.stringify(failed)).not.toContain(CANARY_GITHUB_TOKEN);
    expect(lines.join('\n')).toContain('bad token');
    expect(lines.join('\n')).not.toContain(CANARY_GITHUB_TOKEN);
  });
});
