import type { RuntimeEvent, RuntimeHandle } from '@slop-control/shared';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeCodeRuntime } from '../src/sessions/claude-code.runtime';
import { makeClone, tempDir } from './support/git';

/**
 * Opt-in, off by default: runs real Claude Code on a throwaway repo and uses the host's plan.
 * Run with `npm run test:smoke -w @slop-control/server`.
 */
const describeSmoke = process.env.CLAUDE_SMOKE ? describe : describe.skip;

async function collect(handle: RuntimeHandle): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of handle.events) events.push(event);
  return events;
}

describeSmoke('ClaudeCodeRuntime smoke test', () => {
  jest.setTimeout(180_000);
  const runtime = new ClaudeCodeRuntime({ githubToken: '' });

  it('is ready on this host', async () => {
    await expect(runtime.checkReady()).resolves.toEqual({ ready: true });
  });

  it('reports not ready when CLAUDE_CONFIG_DIR points to an empty folder', async () => {
    const saved = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = tempDir('slop-empty-config-');
    try {
      expect(await runtime.checkReady()).toEqual({
        ready: false,
        message: expect.stringContaining('claude auth login'),
      });
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = saved;
    }
  });

  it('produces the required artifact and can be resumed', async () => {
    const cwd = makeClone();
    const events = await collect(
      runtime.start({
        brief: 'Remember the word PLUM-42. Write the single line "hello" to `.slop/investigation.md`.',
        cwd,
        setup: { permissionMode: 'auto' },
      }),
    );

    expect(events[0]?.type).toBe('session_started');
    expect(events.at(-1)).toMatchObject({ type: 'session_ended', outcome: 'success' });
    expect(readFileSync(join(cwd, '.slop/investigation.md'), 'utf8')).toContain('hello');

    const started = events[0] as Extract<RuntimeEvent, { type: 'session_started' }>;
    expect(started.transcriptPath && existsSync(started.transcriptPath)).toBe(true);

    const resumed = await collect(
      runtime.resume({
        runtimeSessionId: started.runtimeSessionId,
        message: 'Write the word I asked you to remember to `.slop/word.md`.',
        cwd,
        setup: { permissionMode: 'auto' },
      }),
    );
    expect(resumed.at(-1)).toMatchObject({ type: 'session_ended', outcome: 'success' });
    expect(readFileSync(join(cwd, '.slop/word.md'), 'utf8')).toContain('PLUM-42');
  });

  it('stops a running session', async () => {
    const cwd = makeClone();
    const handle = runtime.start({
      brief: 'Run `sleep 60` with Bash, then reply DONE.',
      cwd,
      setup: { permissionMode: 'auto' },
    });
    const events: RuntimeEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
      if (event.type === 'session_started') await handle.stop();
    }
    expect(events.at(-1)).toMatchObject({ type: 'session_ended', outcome: 'stopped' });
  });
});
