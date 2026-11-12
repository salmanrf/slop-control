import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DraftedAction, Session } from '@slop-control/shared';
import { connectSessionUpdates } from '../src/lib/session-stream';

const session = (id: string) => ({ id, status: 'running' }) as Session;
const frame = (s: Session) => `event: session_updated\ndata: ${JSON.stringify(s)}\n\n`;

/** A stream response the test writes to, as the server would. */
function openStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
  return {
    response: new Response(body, { status: 200 }),
    write: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup(responses: (Response | Error)[]) {
  const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
    const next = responses.shift();
    if (!next) {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    }
    if (next instanceof Error) throw next;
    return next;
  });
  const onSession = vi.fn();
  const onAction = vi.fn();
  const onConnected = vi.fn();
  const onDisconnected = vi.fn();
  const onUnauthorized = vi.fn();
  let tokenCount = 0;
  const stop = connectSessionUpdates({
    workspaceId: 'w1',
    getToken: async () => `token-${++tokenCount}`,
    onSession,
    onAction,
    onConnected,
    onDisconnected,
    onUnauthorized,
    fetchFn: fetchFn as unknown as typeof fetch,
    retryDelayMs: 1,
    staleAfterMs: 40,
  });
  return { fetchFn, onSession, onAction, onConnected, onDisconnected, onUnauthorized, stop };
}

describe('connectSessionUpdates', () => {
  let cleanupStream: (() => void) | undefined;
  afterEach(() => cleanupStream?.());

  it('sends the token in a header, never in the URL', async () => {
    const stream = openStream();
    const t = setup([stream.response]);
    cleanupStream = t.stop;
    await flush();
    const [url, init] = t.fetchFn.mock.calls[0]!;
    expect(url).toBe('/api/workspaces/w1/session-updates');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token-1');
  });

  it('passes on each session, including frames split across chunks', async () => {
    const stream = openStream();
    const t = setup([stream.response]);
    cleanupStream = t.stop;
    await flush();

    const text = frame(session('a')) + frame(session('b'));
    stream.write(text.slice(0, 20));
    await flush();
    expect(t.onSession).not.toHaveBeenCalled();
    stream.write(text.slice(20));
    await flush();
    expect(t.onSession.mock.calls.map(([s]) => s.id)).toEqual(['a', 'b']);
  });

  it('passes on a drafted action frame as an action, not as a session', async () => {
    const stream = openStream();
    const t = setup([stream.response]);
    cleanupStream = t.stop;
    await flush();

    const action = { id: 'act-1', status: 'pending' } as DraftedAction;
    stream.write(`event: drafted_action_updated\ndata: ${JSON.stringify(action)}\n\n`);
    stream.write(frame(session('a')));
    await flush();
    expect(t.onAction.mock.calls.map(([a]) => a.id)).toEqual(['act-1']);
    expect(t.onSession.mock.calls.map(([s]) => s.id)).toEqual(['a']);
  });

  it('ignores a frame of an event it does not know', async () => {
    const stream = openStream();
    const t = setup([stream.response]);
    cleanupStream = t.stop;
    await flush();
    stream.write('event: something_else\ndata: {"id":"x"}\n\n');
    await flush();
    expect(t.onSession).not.toHaveBeenCalled();
    expect(t.onAction).not.toHaveBeenCalled();
  });

  it('ignores heartbeat comments', async () => {
    const stream = openStream();
    const t = setup([stream.response]);
    cleanupStream = t.stop;
    await flush();
    stream.write(': heartbeat\n\n');
    await flush();
    expect(t.onSession).not.toHaveBeenCalled();
  });

  it('tells the caller to refetch only once it is subscribed', async () => {
    const stream = openStream();
    const t = setup([stream.response]);
    cleanupStream = t.stop;
    expect(t.onConnected).not.toHaveBeenCalled();
    await flush();
    expect(t.onConnected).toHaveBeenCalledTimes(1);
  });

  it('reconnects with a fresh token after a drop, and refetches again', async () => {
    const first = openStream();
    const second = openStream();
    const t = setup([first.response, second.response]);
    cleanupStream = t.stop;
    await flush();
    first.end();
    await flush();
    await flush();

    expect(t.fetchFn).toHaveBeenCalledTimes(2);
    expect(new Headers(t.fetchFn.mock.calls[1]![1].headers).get('authorization')).toBe(
      'Bearer token-2',
    );
    expect(t.onConnected).toHaveBeenCalledTimes(2);
  });

  it('reports a lost connection, so a view can say its status may be out of date', async () => {
    const stream = openStream();
    const t = setup([stream.response]);
    cleanupStream = t.stop;
    await flush();
    expect(t.onDisconnected).not.toHaveBeenCalled();
    stream.end();
    await flush();
    expect(t.onDisconnected).toHaveBeenCalledTimes(1);
  });

  it('retries after a network error', async () => {
    const stream = openStream();
    const t = setup([new TypeError('network down'), stream.response]);
    cleanupStream = t.stop;
    await flush();
    await flush();
    expect(t.onConnected).toHaveBeenCalledTimes(1);
  });

  it('reconnects when nothing, not even a heartbeat, arrives in time', async () => {
    const dead = openStream();
    const live = openStream();
    const t = setup([dead.response, live.response]);
    cleanupStream = t.stop;
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(t.fetchFn).toHaveBeenCalledTimes(2);
  });

  it('stays connected while heartbeats keep arriving', async () => {
    const stream = openStream();
    const t = setup([stream.response]);
    cleanupStream = t.stop;
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      stream.write(': heartbeat\n\n');
    }
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports an expired sign-in and stops trying', async () => {
    const t = setup([new Response('{}', { status: 401 })]);
    cleanupStream = t.stop;
    await flush();
    await flush();
    expect(t.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect after being stopped', async () => {
    const stream = openStream();
    const t = setup([stream.response]);
    await flush();
    t.stop();
    await flush();
    await flush();
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
  });
});
