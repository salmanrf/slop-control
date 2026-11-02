import type {
  RuntimeEvent,
  RuntimeHandle,
  RuntimeReadiness,
  RuntimeResumeInput,
  RuntimeStartInput,
} from '@slop-control/shared';
import { SessionRuntime } from '../../src/sessions/runtime';

/** One scripted run. The test decides what the runtime reports and when. */
export class FakeRun implements RuntimeHandle {
  stopCalls = 0;
  /** Makes the run ignore `stop`, as a slow-to-die process would. */
  ignoreStop = false;
  private readonly queue: (RuntimeEvent | { fail: Error } | 'close')[] = [];
  private wake: (() => void) | null = null;
  private finished = false;

  constructor(readonly input: RuntimeStartInput | RuntimeResumeInput) {}

  emit(event: RuntimeEvent): void {
    this.push(event);
  }
  started(runtimeSessionId = 'runtime-session-1', transcriptPath: string | null = null): void {
    this.emit({ type: 'session_started', runtimeSessionId, transcriptPath });
  }
  ended(outcome: 'success' | 'error' | 'stopped' = 'success', message: string | null = null): void {
    this.emit({ type: 'session_ended', outcome, message });
  }
  /** Ends the stream without `session_ended`, as a dying process would. */
  closeEarly(): void {
    this.push('close');
  }
  /** Makes the stream throw, as a failed start would. */
  fail(error: Error): void {
    this.push({ fail: error });
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    if (this.stopCalls === 1 && !this.finished && !this.ignoreStop) this.ended('stopped');
  }

  readonly events: AsyncIterable<RuntimeEvent> = {
    [Symbol.asyncIterator]: () => this.iterate(),
  };

  private push(item: RuntimeEvent | { fail: Error } | 'close'): void {
    this.queue.push(item);
    this.wake?.();
  }

  private async *iterate(): AsyncGenerator<RuntimeEvent> {
    while (true) {
      while (this.queue.length === 0) {
        await new Promise<void>((resolve) => (this.wake = resolve));
      }
      const item = this.queue.shift()!;
      if (item === 'close') {
        this.finished = true;
        return;
      }
      if ('fail' in item) {
        this.finished = true;
        throw item.fail;
      }
      yield item;
      if (item.type === 'session_ended') {
        this.finished = true;
        return;
      }
    }
  }
}

export class FakeRuntime extends SessionRuntime {
  readiness: RuntimeReadiness = { ready: true };
  throwOnStart: Error | null = null;
  readonly runs: FakeRun[] = [];
  terminateFailure: Error | null = null;
  readonly terminated: string[] = [];

  async checkReady(): Promise<RuntimeReadiness> {
    return this.readiness;
  }
  start(input: RuntimeStartInput): RuntimeHandle {
    if (this.throwOnStart) throw this.throwOnStart;
    const run = new FakeRun(input);
    this.runs.push(run);
    return run;
  }
  resume(input: RuntimeResumeInput): RuntimeHandle {
    const run = new FakeRun(input);
    this.runs.push(run);
    return run;
  }
  async terminateLeftovers(cwd: string): Promise<void> {
    if (this.terminateFailure) throw this.terminateFailure;
    this.terminated.push(cwd);
  }
  get lastRun(): FakeRun {
    return this.runs.at(-1)!;
  }
}
