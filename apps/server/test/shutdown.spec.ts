import {
  createHarness,
  seedWorkspace,
  sendMessage,
  startSession,
  ticketPath,
  waitForSession,
  type Harness,
  type Seeded,
} from './support/session-harness';
import { resetDatabase, signToken } from './support/test-app';

/** Closing takes a moment while sessions stop, and the server still takes requests until it's done. */
describe('shutting down with a session running', () => {
  let h: Harness;
  let baseUrl: string;
  let workspaceId: string;
  let seeded: Seeded;
  let headers: Record<string, string>;

  beforeEach(async () => {
    await resetDatabase();
    h = await createHarness();
    await h.app.listen(0, '127.0.0.1');
    baseUrl = await h.app.getUrl();
    headers = { authorization: `Bearer ${await signToken()}`, 'content-type': 'application/json' };
    seeded = await seedWorkspace(h);
    ({ workspaceId } = seeded);
    await startSession(h, seeded);
    h.runtime.lastRun.started();
    h.runtime.lastRun.ignoreStop = true;
  });

  it('refuses a stream that connects late, and still exits', async () => {
    const closing = h.close();
    const late = await fetch(`${baseUrl}/workspaces/${workspaceId}/session-updates`, { headers });
    expect(late.status).toBe(503);

    const outcome = await Promise.race([
      closing.then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('still running'), 6000)),
    ]);
    expect(outcome).toBe('closed');
  });

  it('refuses to start a session', async () => {
    const runs = h.runtime.runs.length;
    const closing = h.close();
    const late = await fetch(`${baseUrl}${ticketPath(seeded)}/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phase: 'investigation' }),
    });
    expect(late.status).toBe(503);
    expect(h.runtime.runs.length).toBe(runs);
    await closing;
  });

  it('refuses a follow-up message', async () => {
    const runs = h.runtime.runs.length;
    const closing = h.close();
    const late = await fetch(
      `${baseUrl}/workspaces/${workspaceId}/sessions/00000000-0000-4000-8000-000000000000/messages`,
      { method: 'POST', headers, body: JSON.stringify({ message: 'Carry on.' }) },
    );
    expect(late.status).toBe(503);
    expect(((await late.json()) as { code: string }).code).toBe('RUNTIME_NOT_READY');
    expect(h.runtime.runs.length).toBe(runs);
    await closing;
  });
});

describe('shutting down during a follow-up round', () => {
  beforeEach(resetDatabase);

  it('stops the round like any running session, and the next boot marks it failed', async () => {
    const first = await createHarness();
    const seeded = await seedWorkspace(first);
    const session = await startSession(first, seeded);
    first.runtime.lastRun.started('rt-1');
    first.runtime.lastRun.writeFile('.slop/investigation.md', '# Round 1\n');
    first.runtime.lastRun.ended('success');
    await waitForSession(first, session, (s) => s.status === 'ended');

    await sendMessage(first, session);
    const round = first.runtime.lastRun;
    round.ignoreStop = true;
    await first.close();
    expect(round.stopCalls).toBe(1);

    const second = await createHarness();
    try {
      const base = `/workspaces/${seeded.workspaceId}/sessions/${session.id}`;
      const read = (await second.api.get(base)).body;
      expect(read).toMatchObject({ status: 'failed', statusReason: 'server_restarted', round: 2 });
      expect(second.runtime.terminated).toEqual([session.worktreePath]);
      expect((await second.api.get(`${base}/artifact`)).body).toMatchObject({
        round: 1,
        markdown: '# Round 1\n',
      });
    } finally {
      await second.close();
    }
  });
});
