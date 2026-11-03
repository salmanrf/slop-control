import type { RuntimeEvent, RuntimeHandle, RuntimeStartInput } from '@slop-control/shared';
import type { SessionRuntime } from '../../src/sessions/runtime';

/** Drives one implementation through the behaviour every runtime must share. */
export interface ContractDriver {
  runtime: SessionRuntime;
  /** Makes the run started by `start` report its session ID and finish normally. */
  finishNormally(handle: RuntimeHandle): void;
  /** Makes the run started by `start` report its session ID, then stay running. */
  keepRunning(handle: RuntimeHandle): void;
  /** Makes the run started by `start` fail before it can report a session ID. */
  failToStart(handle: RuntimeHandle): void;
}

const INPUT: RuntimeStartInput = {
  brief: 'Do the thing.',
  cwd: process.cwd(),
  setup: { permissionMode: 'auto' },
};

async function collect(handle: RuntimeHandle): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of handle.events) events.push(event);
  return events;
}

/** Runs against the fake, so the fake stays faithful, and against the real runtime's mapping. */
export function describeRuntimeContract(name: string, makeDriver: () => ContractDriver): void {
  describe(`SessionRuntime contract: ${name}`, () => {
    let driver: ContractDriver;

    beforeEach(() => {
      driver = makeDriver();
    });

    it('reports session_started, then session_ended, then finishes', async () => {
      const handle = driver.runtime.start(INPUT);
      driver.finishNormally(handle);
      const events = await collect(handle);
      expect(events.map((event) => event.type)).toEqual(['session_started', 'session_ended']);
      expect(events[1]).toMatchObject({ outcome: 'success' });
    });

    it('reports stopped after stop, and stop can be called again', async () => {
      const handle = driver.runtime.start(INPUT);
      driver.keepRunning(handle);
      const iterator = handle.events[Symbol.asyncIterator]();
      expect((await iterator.next()).value).toMatchObject({ type: 'session_started' });

      await handle.stop();
      await handle.stop();

      expect((await iterator.next()).value).toMatchObject({
        type: 'session_ended',
        outcome: 'stopped',
      });
      expect((await iterator.next()).done).toBe(true);
    });

    it('reports a start failure through its events, not by throwing from start', async () => {
      const handle = driver.runtime.start(INPUT);
      driver.failToStart(handle);
      const events = await collect(handle);
      expect(events.at(-1)).toMatchObject({ type: 'session_ended', outcome: 'error' });
    });
  });
}
