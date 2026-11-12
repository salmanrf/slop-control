import type { DraftedAction, Session } from '@slop-control/shared';

export interface SessionStreamOptions {
  workspaceId: string;
  getToken: () => Promise<string | null>;
  onSession: (session: Session) => void;
  onAction: (action: DraftedAction) => void;
  /** Fires once subscribed, so the caller refetches and can't miss a change made in between. */
  onConnected: () => void;
  /** Fires each time a connection is lost or can't be made, before the next attempt. */
  onDisconnected?: () => void;
  onUnauthorized: () => void;
  fetchFn?: typeof fetch;
  retryDelayMs?: number;
  /** With a 30-second heartbeat, this long with no data means the connection is dead. */
  staleAfterMs?: number;
}

const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_STALE_AFTER_MS = 45_000;
const FRAME_END = '\n\n';

/**
 * Reads the status stream with `fetch`, because `EventSource` can't set headers and a token in the
 * URL would end up in logs. Reconnects on its own, with a fresh token each time.
 * @return a function that closes the stream for good
 */
export function connectSessionUpdates(options: SessionStreamOptions): () => void {
  const {
    workspaceId,
    getToken,
    onSession,
    onAction,
    onConnected,
    onDisconnected,
    onUnauthorized,
    fetchFn = (...args) => fetch(...args),
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
  } = options;

  let stopped = false;
  let current: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const readOnce = async (): Promise<'retry' | 'unauthorized'> => {
    const controller = new AbortController();
    current = controller;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<string> | undefined;
    const resetStaleTimer = () => {
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        controller.abort();
        void reader?.cancel().catch(() => undefined);
      }, staleAfterMs);
    };

    try {
      const token = await getToken();
      if (!token) return 'unauthorized';
      resetStaleTimer();
      const response = await fetchFn(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/session-updates`,
        {
          headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
          signal: controller.signal,
        },
      );
      if (response.status === 401) return 'unauthorized';
      if (!response.ok || !response.body) return 'retry';

      onConnected();
      resetStaleTimer();

      reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) return 'retry';
        resetStaleTimer();
        buffer += value;
        let end: number;
        while ((end = buffer.indexOf(FRAME_END)) !== -1) {
          const frame = parseFrame(buffer.slice(0, end));
          buffer = buffer.slice(end + FRAME_END.length);
          if (frame?.event === 'session_updated') onSession(frame.data);
          if (frame?.event === 'drafted_action_updated') onAction(frame.data);
        }
      }
    } catch {
      return 'retry';
    } finally {
      clearTimeout(staleTimer);
    }
  };

  const loop = async () => {
    while (!stopped) {
      const outcome = await readOnce();
      if (stopped) return;
      if (outcome === 'unauthorized') {
        onUnauthorized();
        return;
      }
      onDisconnected?.();
      await new Promise<void>((resolve) => {
        retryTimer = setTimeout(resolve, retryDelayMs);
      });
    }
  };
  void loop();

  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    current?.abort();
  };
}

type Frame =
  | { event: 'session_updated'; data: Session }
  | { event: 'drafted_action_updated'; data: DraftedAction };

const FRAME_EVENTS: Frame['event'][] = ['session_updated', 'drafted_action_updated'];

function parseFrame(frame: string): Frame | null {
  const lines = frame.split('\n');
  const event = FRAME_EVENTS.find((name) => lines.includes(`event: ${name}`));
  if (!event) return null;
  const data = lines.find((line) => line.startsWith('data: '));
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data.slice('data: '.length)) } as Frame;
  } catch {
    return null;
  }
}
