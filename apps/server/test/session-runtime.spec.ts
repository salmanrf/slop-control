import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeEvent, RuntimeHandle } from '@slop-control/shared';
import { ClaudeCodeRuntime, type SdkQuery } from '../src/sessions/claude-code.runtime';
import { FakeRun, FakeRuntime } from './support/fake-runtime';
import { tempDir } from './support/git';
import { describeRuntimeContract } from './support/runtime-contract';
import { CANARY_GITHUB_TOKEN } from './support/test-env';

describeRuntimeContract('fake', () => ({
  runtime: new FakeRuntime(),
  finishNormally: (handle) => {
    (handle as FakeRun).started();
    (handle as FakeRun).ended('success');
  },
  keepRunning: (handle) => (handle as FakeRun).started(),
  failToStart: (handle) => (handle as FakeRun).ended('error', 'no spawn'),
}));

const INIT = { type: 'system', subtype: 'init', session_id: 'sdk-1', permissionMode: 'auto' };
const SUCCESS = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  session_id: 'sdk-1',
  result: 'done',
};

/** Stands in for the Agent SDK's `query`, at the system boundary. */
class ScriptedSdk {
  options: Record<string, unknown> | null = null;
  prompt: string | null = null;
  private readonly queue: (object | Error | 'close')[] = [];
  private wake: (() => void) | null = null;

  push(...items: (object | Error | 'close')[]): void {
    this.queue.push(...items);
    this.wake?.();
  }

  query: SdkQuery = ({ prompt, options }) => {
    this.prompt = prompt;
    this.options = options as Record<string, unknown>;
    const abort = options.abortController as AbortController;
    abort.signal.addEventListener('abort', () => {
      this.push(new Error('Claude Code process aborted by user'));
    });
    const queue = this.queue;
    const waitForItem = () => new Promise<void>((resolve) => (this.wake = resolve));
    return (async function* () {
      while (true) {
        while (queue.length === 0) await waitForItem();
        const item = queue.shift()!;
        if (item === 'close') return;
        if (item instanceof Error) throw item;
        yield item;
      }
    })();
  };
}

/** A stand-in `claude` command on disk, so the readiness check runs a real child process. */
function fakeClaude(script: string): string {
  const dir = tempDir('slop-claude-');
  const path = join(dir, 'claude');
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

const LOGGED_IN = `echo '{"loggedIn":true,"email":"person@example.invalid","orgName":"Org","projectsDirectory":"/projects"}'`;

function makeRuntime(sdk: ScriptedSdk, claudeCommand = fakeClaude(LOGGED_IN)): ClaudeCodeRuntime {
  return new ClaudeCodeRuntime(
    { githubToken: CANARY_GITHUB_TOKEN },
    { claudeCommand, loadQuery: async () => sdk.query },
  );
}

async function collect(handle: RuntimeHandle): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of handle.events) events.push(event);
  return events;
}

const INPUT = { brief: 'Do it.', cwd: process.cwd(), setup: { permissionMode: 'auto' as const } };

describe('ClaudeCodeRuntime', () => {
  describeRuntimeContract('Claude Code over a scripted SDK', () => {
    const sdk = new ScriptedSdk();
    return {
      runtime: makeRuntime(sdk),
      finishNormally: () => sdk.push(INIT, SUCCESS, 'close'),
      keepRunning: () => sdk.push(INIT),
      failToStart: () => sdk.push(new Error('no spawn')),
    };
  });

  describe('checkReady', () => {
    it('is ready when signed in', async () => {
      await expect(makeRuntime(new ScriptedSdk()).checkReady()).resolves.toEqual({ ready: true });
    });

    it('says to sign in when signed out, as with exit code 1', async () => {
      const claude = fakeClaude(`echo '{"loggedIn":false}'; exit 1`);
      const result = await makeRuntime(new ScriptedSdk(), claude).checkReady();
      expect(result).toEqual({
        ready: false,
        message: expect.stringContaining('claude auth login'),
      });
    });

    it('says to install Claude Code when the command is missing', async () => {
      const result = await makeRuntime(new ScriptedSdk(), '/nonexistent/claude').checkReady();
      expect(result).toEqual({ ready: false, message: expect.stringContaining('install') });
    });

    it.each([
      ['output that cannot be parsed', `echo 'not json'`],
      ['a crash with no output', `exit 3`],
      ['JSON without the field', `echo '{}'`],
    ])('says the status could not be read after %s', async (_name, script) => {
      const result = await makeRuntime(new ScriptedSdk(), fakeClaude(script)).checkReady();
      expect(result).toEqual({
        ready: false,
        message: expect.stringContaining("couldn't be read"),
      });
    });

    it('never repeats account details in its message', async () => {
      const claude = fakeClaude(
        `echo '{"loggedIn":false,"email":"person@example.invalid"}'; exit 1`,
      );
      const result = await makeRuntime(new ScriptedSdk(), claude).checkReady();
      expect(JSON.stringify(result)).not.toContain('person@example.invalid');
    });

    it('checks again on every call, so fixing the host needs no restart', async () => {
      const dir = tempDir('slop-claude-');
      const path = join(dir, 'claude');
      mkdirSync(dir, { recursive: true });
      const runtime = makeRuntime(new ScriptedSdk(), path);
      expect((await runtime.checkReady()).ready).toBe(false);

      writeFileSync(path, `#!/bin/sh\n${LOGGED_IN}\n`);
      chmodSync(path, 0o755);
      expect((await runtime.checkReady()).ready).toBe(true);
    });
  });

  describe('start', () => {
    it('runs headless in auto mode in the worktree, with no one to ask', async () => {
      const sdk = new ScriptedSdk();
      const handle = makeRuntime(sdk).start(INPUT);
      sdk.push(INIT, SUCCESS, 'close');
      await collect(handle);
      expect(sdk.prompt).toBe('Do it.');
      expect(sdk.options).toMatchObject({
        cwd: process.cwd(),
        permissionMode: 'auto',
        permissionPrompts: 'none',
      });
      expect(sdk.options!.disallowedTools).toContain('AskUserQuestion');
    });

    it('computes the transcript path from the projects directory and the real cwd', async () => {
      const sdk = new ScriptedSdk();
      const cwd = tempDir('slop.dotted_dir ');
      const handle = makeRuntime(sdk).start({ ...INPUT, cwd });
      sdk.push(INIT, SUCCESS, 'close');
      const [started] = await collect(handle);
      const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-');
      expect(started).toEqual({
        type: 'session_started',
        runtimeSessionId: 'sdk-1',
        transcriptPath: `/projects/${encoded}/sdk-1.jsonl`,
      });
    });

    it('leaves the transcript path null when the projects directory is unknown', async () => {
      const sdk = new ScriptedSdk();
      const handle = makeRuntime(sdk, fakeClaude(`echo '{"loggedIn":true}'`)).start(INPUT);
      sdk.push(INIT, SUCCESS, 'close');
      expect((await collect(handle))[0]).toMatchObject({ transcriptPath: null });
    });

    it('reports a failed result as an error, once, even though the SDK then throws', async () => {
      const sdk = new ScriptedSdk();
      const handle = makeRuntime(sdk).start(INPUT);
      sdk.push(
        INIT,
        { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['it broke'] },
        new Error('Claude Code returned an error result: it broke'),
      );
      const events = await collect(handle);
      expect(events.filter((event) => event.type === 'session_ended')).toEqual([
        { type: 'session_ended', outcome: 'error', message: 'it broke' },
      ]);
    });

    it('treats a success result flagged as an error as an error', async () => {
      const sdk = new ScriptedSdk();
      const handle = makeRuntime(sdk).start(INPUT);
      sdk.push(INIT, { ...SUCCESS, is_error: true, result: 'Invalid API key' }, 'close');
      expect((await collect(handle)).at(-1)).toEqual({
        type: 'session_ended',
        outcome: 'error',
        message: 'Invalid API key',
      });
    });

    it('reports a thrown failure as an error', async () => {
      const sdk = new ScriptedSdk();
      const handle = makeRuntime(sdk).start(INPUT);
      sdk.push(new Error('could not spawn'));
      expect(await collect(handle)).toEqual([
        { type: 'session_ended', outcome: 'error', message: 'could not spawn' },
      ]);
    });

    it('does not fail a session for a denied call', async () => {
      const sdk = new ScriptedSdk();
      const handle = makeRuntime(sdk).start(INPUT);
      sdk.push(
        INIT,
        { type: 'system', subtype: 'permission_denied', tool_name: 'Bash' },
        SUCCESS,
        'close',
      );
      expect((await collect(handle)).at(-1)).toMatchObject({ outcome: 'success' });
    });

    it('ends without session_ended when the SDK simply stops, so the caller can flag it', async () => {
      const sdk = new ScriptedSdk();
      const handle = makeRuntime(sdk).start(INPUT);
      sdk.push(INIT, 'close');
      expect((await collect(handle)).map((event) => event.type)).toEqual(['session_started']);
    });
  });

  describe('falling back from auto mode', () => {
    it.each([
      ['init', [{ ...INIT, permissionMode: 'default' }]],
      [
        'a later status message, the one that really changes (S1-04)',
        [INIT, { type: 'system', subtype: 'status', status: null, permissionMode: 'default' }],
      ],
    ])('ends with an error when %s reports another mode', async (_name, messages) => {
      const sdk = new ScriptedSdk();
      const handle = makeRuntime(sdk).start(INPUT);
      sdk.push(...messages, SUCCESS, 'close');
      const events = await collect(handle);
      expect(events.at(-1)).toEqual({
        type: 'session_ended',
        outcome: 'error',
        message: expect.stringContaining('auto'),
      });
      expect(events.filter((event) => event.type === 'session_ended')).toHaveLength(1);
    });

    it('stops the underlying process', async () => {
      const sdk = new ScriptedSdk();
      const handle = makeRuntime(sdk).start(INPUT);
      sdk.push({ ...INIT, permissionMode: 'default' });
      await collect(handle);
      expect((sdk.options!.abortController as AbortController).signal.aborted).toBe(true);
    });

    it('accepts a status message that stays in auto mode', async () => {
      const sdk = new ScriptedSdk();
      const handle = makeRuntime(sdk).start(INPUT);
      sdk.push(
        INIT,
        { type: 'system', subtype: 'status', status: null, permissionMode: 'auto' },
        SUCCESS,
        'close',
      );
      expect((await collect(handle)).at(-1)).toMatchObject({ outcome: 'success' });
    });
  });

  describe('resume', () => {
    it('continues the given session in its worktree', async () => {
      const sdk = new ScriptedSdk();
      const handle = makeRuntime(sdk).resume({
        runtimeSessionId: 'sdk-1',
        message: 'Now fix it.',
        cwd: process.cwd(),
        setup: { permissionMode: 'auto' },
      });
      sdk.push(INIT, SUCCESS, 'close');
      await collect(handle);
      expect(sdk.prompt).toBe('Now fix it.');
      expect(sdk.options).toMatchObject({
        resume: 'sdk-1',
        cwd: process.cwd(),
        permissionMode: 'auto',
      });
    });
  });

  describe('child environment (NFR-4)', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    const envOfChild = async () => {
      const sdk = new ScriptedSdk();
      const handle = makeRuntime(sdk).start(INPUT);
      sdk.push(INIT, SUCCESS, 'close');
      await collect(handle);
      return sdk.options!.env as Record<string, string>;
    };

    it('leaves out the GitHub token and anything not on the allowlist', async () => {
      process.env.GITHUB_TOKEN = CANARY_GITHUB_TOKEN;
      process.env.GH_TOKEN = CANARY_GITHUB_TOKEN;
      process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
      process.env.DATABASE_URL = 'postgres://secret';
      process.env.SOME_RANDOM_API_KEY = 'nope';
      const env = await envOfChild();
      expect(JSON.stringify(env)).not.toContain(CANARY_GITHUB_TOKEN);
      expect(env).not.toHaveProperty('SUPABASE_JWT_SECRET');
      expect(env).not.toHaveProperty('DATABASE_URL');
      expect(env).not.toHaveProperty('SOME_RANDOM_API_KEY');
    });

    it('leaves out an allowlisted variable that holds the token', async () => {
      process.env.CLAUDE_SOMETHING = `prefix-${CANARY_GITHUB_TOKEN}`;
      expect(await envOfChild()).not.toHaveProperty('CLAUDE_SOMETHING');
    });

    it("keeps what Claude Code needs to run with the host's setup", async () => {
      process.env.CLAUDE_CONFIG_DIR = '/some/config';
      process.env.ANTHROPIC_API_KEY = 'host-key';
      const env = await envOfChild();
      expect(env.HOME).toBe(process.env.HOME);
      expect(env.PATH).toBe(process.env.PATH);
      expect(env.CLAUDE_CONFIG_DIR).toBe('/some/config');
      expect(env.ANTHROPIC_API_KEY).toBe('host-key');
    });
  });
});
