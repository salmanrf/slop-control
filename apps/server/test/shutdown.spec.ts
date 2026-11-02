import {
  createHarness,
  ENCODED_KEY,
  seedWorkspace,
  startSession,
  type Harness,
} from './support/session-harness';
import { resetDatabase, signToken } from './support/test-app';

/** Closing takes a moment while sessions stop, and the server still takes requests until it's done. */
describe('shutting down with a session running', () => {
  let h: Harness;
  let baseUrl: string;
  let workspaceId: string;
  let headers: Record<string, string>;

  beforeEach(async () => {
    await resetDatabase();
    h = await createHarness();
    await h.app.listen(0, '127.0.0.1');
    baseUrl = await h.app.getUrl();
    headers = { authorization: `Bearer ${await signToken()}`, 'content-type': 'application/json' };
    ({ workspaceId } = await seedWorkspace(h));
    await startSession(h, workspaceId);
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
    const late = await fetch(
      `${baseUrl}/workspaces/${workspaceId}/tickets/${ENCODED_KEY}/sessions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ phase: 'investigation' }),
      },
    );
    expect(late.status).toBe(503);
    expect(h.runtime.runs.length).toBe(runs);
    await closing;
  });
});
