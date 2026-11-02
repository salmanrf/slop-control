import type { Session } from '@slop-control/shared';
import {
  createHarness,
  seedWorkspace,
  startSession,
  waitForSession,
  type Harness,
} from './support/session-harness';
import { resetDatabase, signToken } from './support/test-app';

interface StreamClient {
  status: number;
  /** Resolves with the next `session_updated` payload. */
  next(): Promise<Session>;
  /** All raw text received so far. */
  raw(): string;
  close(): void;
}

const NOTHING_ARRIVED = 150;

async function connect(baseUrl: string, workspaceId: string, token: string): Promise<StreamClient> {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/workspaces/${workspaceId}/session-updates`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });

  const frames: Session[] = [];
  const waiters: ((session: Session) => void)[] = [];
  let raw = '';
  let buffer = '';

  if (response.status === 200) {
    void (async () => {
      const decoder = new TextDecoder();
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          const text = decoder.decode(chunk, { stream: true });
          raw += text;
          buffer += text;
          let end: number;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (!frame.split('\n').includes('event: session_updated')) continue;
            const data = frame.split('\n').find((line) => line.startsWith('data: '))!;
            const session = JSON.parse(data.slice('data: '.length)) as Session;
            const waiter = waiters.shift();
            if (waiter) waiter(session);
            else frames.push(session);
          }
        }
      } catch {
        // Aborted by the test.
      }
    })();
  }

  return {
    status: response.status,
    next: () =>
      new Promise((resolve, reject) => {
        const queued = frames.shift();
        if (queued) return resolve(queued);
        const timer = setTimeout(() => reject(new Error('no frame arrived in time')), 3000);
        waiters.push((session) => {
          clearTimeout(timer);
          resolve(session);
        });
      }),
    raw: () => raw,
    close: () => controller.abort(),
  };
}

describe('session status stream', () => {
  let h: Harness;
  let baseUrl: string;
  let token: string;
  let workspaceId: string;
  const open: StreamClient[] = [];

  const listen = async (workspace = workspaceId) => {
    const client = await connect(baseUrl, workspace, token);
    open.push(client);
    return client;
  };

  beforeAll(async () => {
    h = await createHarness({ heartbeatMs: 50 });
    await h.app.listen(0, '127.0.0.1');
    baseUrl = await h.app.getUrl();
    token = await signToken();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.tickets.clear();
    ({ workspaceId } = await seedWorkspace(h));
  });
  afterEach(() => {
    open.splice(0).forEach((client) => client.close());
  });
  afterAll(() => h.close());

  it.each([
    ['no token', ''],
    ['a bad token', 'not-a-token'],
  ])('rejects a connection with %s', async (_name, value) => {
    const res = await fetch(`${baseUrl}/workspaces/${workspaceId}/session-updates`, {
      headers: value ? { authorization: `Bearer ${value}` } : {},
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('rejects an expired token', async () => {
    const expired = await signToken({ expiresIn: '-1m' });
    const res = await fetch(`${baseUrl}/workspaces/${workspaceId}/session-updates`, {
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown workspace', async () => {
    const res = await fetch(`${baseUrl}/workspaces/00000000-0000-4000-8000-000000000000/session-updates`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('serves an event stream', async () => {
    const res = await fetch(`${baseUrl}/workspaces/${workspaceId}/session-updates`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    await res.body?.cancel();
  });

  it('pushes every status change as a full session', async () => {
    const client = await listen();
    const session = await startSession(h, workspaceId);
    expect(await client.next()).toMatchObject({ id: session.id, status: 'starting' });

    h.runtime.lastRun.started('abc');
    expect(await client.next()).toMatchObject({ id: session.id, status: 'running', runtimeSessionId: 'abc' });

    h.runtime.lastRun.ended('success');
    const ended = await client.next();
    expect(ended).toMatchObject({ id: session.id, status: 'ended', artifactStatus: 'incomplete' });
    expect(ended.resumeCommand).toContain('claude --resume abc');
  });

  it('delivers a change within a second of the runtime reporting it', async () => {
    const client = await listen();
    await startSession(h, workspaceId);
    await client.next();

    const reportedAt = Date.now();
    h.runtime.lastRun.started();
    await client.next();
    expect(Date.now() - reportedAt).toBeLessThan(1000);
  });

  it('publishes a change that is already saved', async () => {
    const client = await listen();
    const session = await startSession(h, workspaceId);
    await client.next();
    h.runtime.lastRun.started('abc');
    const pushed = await client.next();

    const read = await h.api.get(`/workspaces/${workspaceId}/sessions/${session.id}`);
    expect(read.body).toEqual(pushed);
  });

  it('also pushes a removed worktree', async () => {
    const session = await startSession(h, workspaceId);
    h.runtime.lastRun.ended('success');
    await waitForSession(h, session, (s) => s.status === 'ended');
    const client = await listen();

    await h.api.delete(`/workspaces/${workspaceId}/sessions/${session.id}/worktree`);
    const frame = await client.next();
    expect(frame.worktreeRemovedAt).not.toBeNull();
    expect(frame.resumeCommand).toBeNull();
  });

  it("only sends a client its own workspace's sessions", async () => {
    const other = await seedWorkspace(h, 'other');
    const mine = await listen();
    const theirs = await listen(other.workspaceId);

    const session = await startSession(h, other.workspaceId);
    expect((await theirs.next()).id).toBe(session.id);

    const race = await Promise.race([
      mine.next().then(() => 'received'),
      new Promise((resolve) => setTimeout(() => resolve('nothing'), NOTHING_ARRIVED)),
    ]);
    expect(race).toBe('nothing');
  });

  it('replays nothing; a change made before connecting is visible through REST', async () => {
    const session = await startSession(h, workspaceId);
    h.runtime.lastRun.started('abc');
    let read = await h.api.get(`/workspaces/${workspaceId}/sessions/${session.id}`);
    for (let i = 0; i < 100 && read.body.status !== 'running'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      read = await h.api.get(`/workspaces/${workspaceId}/sessions/${session.id}`);
    }
    expect(read.body.status).toBe('running');

    const client = await listen();
    const race = await Promise.race([
      client.next().then(() => 'received'),
      new Promise((resolve) => setTimeout(() => resolve('nothing'), NOTHING_ARRIVED)),
    ]);
    expect(race).toBe('nothing');
  });

  it('sends heartbeat comments', async () => {
    const client = await listen();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(client.raw()).toMatch(/^: heartbeat$/m);
  });

  it('lets the server close while a client is connected', async () => {
    const extra = await createHarness({ heartbeatMs: 50 });
    await extra.app.listen(0, '127.0.0.1');
    const { workspaceId: ws } = await seedWorkspace(extra, 'closing');
    const client = await connect(await extra.app.getUrl(), ws, token);
    await extra.close();
    client.close();
  });
});
