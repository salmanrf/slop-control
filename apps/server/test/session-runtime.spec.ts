import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeEvent, RuntimeHandle, RuntimeSetup } from '@slop-control/shared';
import { Redactor } from '../src/common/redactor';
import { BASELINE_ENV, BLOCKED_MESSAGE, denyOutwardActions } from '../src/sessions/baseline-scope';
import { ClaudeCodeRuntime, type SdkQuery } from '../src/sessions/claude-code.runtime';
import { FakeRun, FakeRuntime } from './support/fake-runtime';
import { makeClone, tempDir } from './support/git';
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

/** The host check is stubbed, so these cases don't depend on the machine they run on. */
function makeRuntime(
  sdk: ScriptedSdk,
  claudeCommand = fakeClaude(LOGGED_IN),
  scopeProblem: string | null = null,
): ClaudeCodeRuntime {
  return new ClaudeCodeRuntime(
    { holdsSecret: (value: string) => value.includes(CANARY_GITHUB_TOKEN) },
    {
      claudeCommand,
      loadQuery: async () => sdk.query,
      checkScopeEnforcement: async () => scopeProblem,
    },
  );
}

async function collect(handle: RuntimeHandle): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of handle.events) events.push(event);
  return events;
}

const READ_ONLY: RuntimeSetup = {
  permissionMode: 'auto',
  scope: { mayChangeCode: false },
  userLevelSource: false,
};
const INPUT = { brief: 'Do it.', cwd: process.cwd(), setup: READ_ONLY };
const RESUME = { runtimeSessionId: 'sdk-1', message: 'Now fix it.', cwd: process.cwd() };

/** Every combination a phase setup can produce. */
const SETUPS: [string, RuntimeSetup][] = [
  ['a read-only phase', READ_ONLY],
  ['a phase that may change code', { ...READ_ONLY, scope: { mayChangeCode: true } }],
  ['the user-level source on', { ...READ_ONLY, userLevelSource: true }],
  ['both', { permissionMode: 'auto', scope: { mayChangeCode: true }, userLevelSource: true }],
];

/** The baseline scope options, without the parts that differ per run. */
function baselineOf(options: Record<string, unknown>) {
  const { strictMcpConfig, mcpServers, sandbox, settings, managedSettings, hooks } = options;
  return { strictMcpConfig, mcpServers, sandbox, settings, managedSettings, hooks };
}

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
        setup: READ_ONLY,
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

  const optionsOf = async (kind: 'start' | 'resume', setup: RuntimeSetup, cwd = process.cwd()) => {
    const sdk = new ScriptedSdk();
    const runtime = makeRuntime(sdk);
    const handle =
      kind === 'start'
        ? runtime.start({ ...INPUT, cwd, setup })
        : runtime.resume({ ...RESUME, cwd, setup });
    sdk.push(INIT, SUCCESS, 'close');
    await collect(handle);
    return sdk.options!;
  };

  describe('user-level source (FR-41)', () => {
    it.each([['start'], ['resume']] as const)(
      'leaves ~/.claude out of a %s by default, keeping the project and local sources',
      async (kind) => {
        const options = await optionsOf(kind, READ_ONLY);
        expect(options.settingSources).toEqual(['project', 'local']);
      },
    );

    it.each([['start'], ['resume']] as const)(
      'adds the user source to a %s when the switch is on',
      async (kind) => {
        const options = await optionsOf(kind, { ...READ_ONLY, userLevelSource: true });
        expect(options.settingSources).toEqual(
          expect.arrayContaining(['user', 'project', 'local']),
        );
        expect(options.settingSources).toHaveLength(3);
      },
    );

    it('is still ready when signed in, since sign-in does not come from the user source', async () => {
      await expect(makeRuntime(new ScriptedSdk()).checkReady()).resolves.toEqual({ ready: true });
    });
  });

  describe('baseline scope (FR-27)', () => {
    it.each(SETUPS)('is applied to a start and a resume with %s', async (_name, setup) => {
      for (const kind of ['start', 'resume'] as const) {
        const options = await optionsOf(kind, setup);
        expect(options.sandbox).toMatchObject({
          enabled: true,
          failIfUnavailable: true,
          allowUnsandboxedCommands: false,
        });
        expect(options.strictMcpConfig).toBe(true);
        expect(options.mcpServers).toEqual({});
        expect(options.settings).toMatchObject({ disableClaudeAiConnectors: true });
        const deny = (options.settings as { permissions: { deny: string[] } }).permissions.deny;
        expect(deny).toEqual(
          expect.arrayContaining(['Bash(git push:*)', 'Bash(gh:*)', 'Bash(ssh:*)']),
        );
        const hooks = options.hooks as { PreToolUse: { hooks: unknown[] }[] };
        expect(hooks.PreToolUse[0]!.hooks).toContain(denyOutwardActions);
      }
    });

    it('is identical for a start and a resume, whatever the setup says', async () => {
      const reference = baselineOf(await optionsOf('start', READ_ONLY));
      for (const [, setup] of SETUPS) {
        expect(baselineOf(await optionsOf('start', setup))).toEqual(reference);
        expect(baselineOf(await optionsOf('resume', setup))).toEqual(reference);
      }
    });

    it("keeps the developer's account connectors out, in the managed tier as well", async () => {
      const options = await optionsOf('start', READ_ONLY);
      expect(options.managedSettings).toMatchObject({
        disableClaudeAiConnectors: true,
        sandbox: { enabled: true, allowUnsandboxedCommands: false },
      });
    });

    it("lets a worktree's commits reach the clone's git folder, and nothing else outside it", async () => {
      const clone = makeClone();
      const options = await optionsOf('start', READ_ONLY, clone);
      const sandbox = options.sandbox as { filesystem: { allowWrite: string[] } };
      expect(sandbox.filesystem.allowWrite).toEqual([join(clone, '.git')]);
    });

    it('denies reading where the host keeps its logins', async () => {
      const options = await optionsOf('start', READ_ONLY);
      const sandbox = options.sandbox as { filesystem: { denyRead: string[] } };
      expect(sandbox.filesystem.denyRead).toEqual(
        expect.arrayContaining(['~/.ssh', '~/.config/gh', '~/.git-credentials']),
      );
    });

    it('blocks GitHub on the network', async () => {
      const options = await optionsOf('start', READ_ONLY);
      const sandbox = options.sandbox as { network: { deniedDomains: string[] } };
      expect(sandbox.network.deniedDomains).toEqual(
        expect.arrayContaining(['github.com', '*.github.com']),
      );
    });

    describe('when the host cannot enforce it', () => {
      const PROBLEM = 'bwrap must be installed';

      it.each([['start'], ['resume']] as const)(
        'ends a %s with an error that says so, and never starts the agent',
        async (kind) => {
          const sdk = new ScriptedSdk();
          const runtime = makeRuntime(sdk, fakeClaude(LOGGED_IN), PROBLEM);
          const handle =
            kind === 'start'
              ? runtime.start(INPUT)
              : runtime.resume({ ...RESUME, setup: READ_ONLY });
          expect(await collect(handle)).toEqual([
            { type: 'session_ended', outcome: 'error', message: expect.stringContaining(PROBLEM) },
          ]);
          expect(sdk.options).toBeNull();
        },
      );

      it('reports not ready with the same reason', async () => {
        const sdk = new ScriptedSdk();
        const runtime = makeRuntime(sdk, fakeClaude(LOGGED_IN), PROBLEM);
        const readiness = await runtime.checkReady();
        const [ended] = await collect(runtime.start(INPUT));
        expect(readiness).toEqual({ ready: false, message: expect.stringContaining(PROBLEM) });
        expect((ended as { message: string }).message).toBe(
          (readiness as { message: string }).message,
        );
      });

      it('still asks for a sign-in first when signed out', async () => {
        const claude = fakeClaude(`echo '{"loggedIn":false}'; exit 1`);
        const readiness = await makeRuntime(new ScriptedSdk(), claude, PROBLEM).checkReady();
        expect(readiness).toEqual({
          ready: false,
          message: expect.stringContaining('claude auth login'),
        });
      });
    });

    it('does not fail a session for a call the baseline scope denied', async () => {
      const sdk = new ScriptedSdk();
      const handle = makeRuntime(sdk).start(INPUT);
      sdk.push(
        INIT,
        {
          type: 'system',
          subtype: 'permission_denied',
          tool_name: 'Bash',
          message: BLOCKED_MESSAGE,
        },
        SUCCESS,
        'close',
      );
      expect((await collect(handle)).at(-1)).toMatchObject({ outcome: 'success' });
    });
  });

  describe('the pre-tool hook', () => {
    const bash = (command: string) =>
      denyOutwardActions({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
      });
    const DENIED = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: BLOCKED_MESSAGE,
      },
    };

    it.each([
      ['git push'],
      ['git push --force origin main'],
      ['git -c credential.helper= push origin HEAD:refs/heads/x'],
      ['cd repo && git push'],
      ['gh pr create --fill'],
      ['echo hi; gh issue comment 1 -b x'],
      ['ssh git@github.com'],
      ['scp file host:/tmp'],
      ['sftp host'],
    ])('denies `%s` with a reason the agent can read', async (command) => {
      await expect(bash(command)).resolves.toEqual(DENIED);
    });

    it.each([
      ['git commit -m "work"'],
      ['git status'],
      ['npm install left-pad'],
      ['git log --oneline'],
      ['cat sshd_config.md'],
      ['echo high'],
    ])('lets `%s` through', async (command) => {
      await expect(bash(command)).resolves.toEqual({});
    });

    it('denies any MCP tool, since no MCP server is part of a session', async () => {
      await expect(
        denyOutwardActions({
          hook_event_name: 'PreToolUse',
          tool_name: 'mcp__claude_ai_Github__push_files',
          tool_input: {},
        }),
      ).resolves.toEqual(DENIED);
    });

    it('leaves other tools and other hook events alone', async () => {
      await expect(
        denyOutwardActions({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} }),
      ).resolves.toEqual({});
      await expect(
        denyOutwardActions({
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'git push' },
        }),
      ).resolves.toEqual({});
      await expect(denyOutwardActions(null)).resolves.toEqual({});
    });
  });

  describe('terminateLeftovers', () => {
    const spawned: number[] = [];
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const start = (command: string, args: string[], cwd: string) => {
      const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore' });
      child.unref();
      spawned.push(child.pid!);
      return child.pid!;
    };
    /** A process that looks like the SDK's Claude Code binary, with a tool command under it. */
    const startAgent = async (cwd: string) => {
      const dir = tempDir('slop-sdk-');
      const binDir = join(dir, 'claude-agent-sdk-test');
      mkdirSync(binDir);
      const toolPidFile = join(dir, 'tool.pid');
      const script = join(binDir, 'claude');
      writeFileSync(script, `#!/bin/sh\nsleep 300 &\necho $! > ${toolPidFile}\nwait\n`);
      chmodSync(script, 0o755);
      const pid = start(script, [], cwd);
      const deadline = Date.now() + 5000;
      while (!existsSync(toolPidFile) || readFileSync(toolPidFile, 'utf8').trim() === '') {
        if (Date.now() > deadline) throw new Error('The stand-in agent never started.');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const toolPid = Number(readFileSync(toolPidFile, 'utf8').trim());
      spawned.push(toolPid);
      return { pid, toolPid };
    };
    const waitUntilGone = async (pid: number) => {
      const deadline = Date.now() + 5000;
      while (alive(pid) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return !alive(pid);
    };

    afterEach(() => {
      for (const pid of spawned.splice(0)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
    });

    it('ends an agent left in the worktree, and the tool command under it', async () => {
      const cwd = tempDir('slop-worktree-');
      const { pid, toolPid } = await startAgent(cwd);
      await makeRuntime(new ScriptedSdk()).terminateLeftovers(cwd);
      expect(await waitUntilGone(pid)).toBe(true);
      expect(await waitUntilGone(toolPid)).toBe(true);
    });

    it('leaves an agent in another worktree alone', async () => {
      const { pid } = await startAgent(tempDir('slop-other-'));
      await makeRuntime(new ScriptedSdk()).terminateLeftovers(tempDir('slop-worktree-'));
      expect(alive(pid)).toBe(true);
    });

    it("leaves the developer's own processes in that worktree alone", async () => {
      const cwd = tempDir('slop-worktree-');
      const shell = start('sleep', ['301'], cwd);
      await startAgent(cwd);
      await makeRuntime(new ScriptedSdk()).terminateLeftovers(cwd);
      expect(alive(shell)).toBe(true);
    });

    it('does nothing when the worktree is gone', async () => {
      await expect(
        makeRuntime(new ScriptedSdk()).terminateLeftovers(join(tempDir(), 'gone')),
      ).resolves.toBeUndefined();
    });
  });

  describe('child environment (NFR-4)', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    const envOfChild = async (kind: 'start' | 'resume' = 'start') =>
      (await optionsOf(kind, READ_ONLY)).env as Record<string, string>;

    /** What the runtime lets through from the host, apart from the `ANTHROPIC_` prefix. */
    const FROM_HOST = new Set([
      'HOME',
      'PATH',
      'USER',
      'LOGNAME',
      'SHELL',
      'TMPDIR',
      'TMP',
      'TEMP',
      'LANG',
      'LC_ALL',
      'LC_CTYPE',
      'TERM',
      'NODE_EXTRA_CA_CERTS',
      'SSL_CERT_FILE',
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'NO_PROXY',
      'http_proxy',
      'https_proxy',
      'no_proxy',
      'CLAUDE_CONFIG_DIR',
      'CLAUDE_CODE_OAUTH_TOKEN',
    ]);

    it.each([['start'], ['resume']] as const)(
      'gives a %s nothing but the allowlist and the baseline scope variables',
      async (kind) => {
        process.env.GITHUB_TOKEN = CANARY_GITHUB_TOKEN;
        process.env.GH_TOKEN = CANARY_GITHUB_TOKEN;
        process.env.SSH_AUTH_SOCK = '/tmp/agent.sock';
        process.env.SOME_RANDOM_API_KEY = 'nope';
        const env = await envOfChild(kind);
        expect(JSON.stringify(env)).not.toContain(CANARY_GITHUB_TOKEN);
        expect(env).not.toHaveProperty('SSH_AUTH_SOCK');
        const unexpected = Object.keys(env).filter(
          (name) =>
            !FROM_HOST.has(name) && !name.startsWith('ANTHROPIC_') && !(name in BASELINE_ENV),
        );
        expect(unexpected).toEqual([]);
        expect(env).toMatchObject(BASELINE_ENV);
      },
    );

    it("points git and gh away from the host's logins, even if the host set them", async () => {
      process.env.GIT_SSH_COMMAND = 'ssh -i ~/.ssh/id_real';
      process.env.GH_CONFIG_DIR = '/home/dev/.config/gh';
      const env = await envOfChild();
      expect(env.GIT_SSH_COMMAND).toBe(BASELINE_ENV.GIT_SSH_COMMAND);
      expect(env.GH_CONFIG_DIR).toBe(BASELINE_ENV.GH_CONFIG_DIR);
      expect(env.GIT_TERMINAL_PROMPT).toBe('0');
      expect(env.GIT_CONFIG_KEY_0).toBe('credential.helper');
      expect(env.GIT_CONFIG_VALUE_0).toBe('');
    });

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
      process.env.ANTHROPIC_SOMETHING = `prefix-${CANARY_GITHUB_TOKEN}`;
      expect(await envOfChild()).not.toHaveProperty('ANTHROPIC_SOMETHING');
    });

    it("leaves out the server's secret key and anything holding a stored secret", async () => {
      process.env.SLOP_SECRET_KEY = 'the-key-that-seals-credentials';
      // A secret known only since the server started, as one saved through the dashboard is.
      const redactor = new Redactor({ jwt: { kind: 'jwks', url: '' }, secretKey: null });
      const sdk = new ScriptedSdk();
      const runtime = new ClaudeCodeRuntime(redactor, {
        claudeCommand: fakeClaude(LOGGED_IN),
        loadQuery: async () => sdk.query,
        checkScopeEnforcement: async () => null,
      });
      redactor.add('ghp_saved_after_startup');
      process.env.ANTHROPIC_BASE_URL = 'https://ghp_saved_after_startup@proxy.invalid';
      process.env.HTTPS_PROXY = 'http://proxy.invalid';
      try {
        const handle = runtime.start({
          brief: 'x',
          cwd: makeClone(),
          setup: {
            permissionMode: 'auto',
            scope: { mayChangeCode: false },
            userLevelSource: false,
          },
        });
        sdk.push(INIT, SUCCESS);
        for await (const _event of handle.events) void _event;
        const env = sdk.options!.env as Record<string, string>;
        expect(env).not.toHaveProperty('SLOP_SECRET_KEY');
        expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL');
        expect(JSON.stringify(env)).not.toContain('ghp_saved_after_startup');
        expect(env.HTTPS_PROXY).toBe('http://proxy.invalid');
      } finally {
        delete process.env.SLOP_SECRET_KEY;
        delete process.env.ANTHROPIC_BASE_URL;
        delete process.env.HTTPS_PROXY;
      }
    });

    it("leaves out a parent Claude Code session's own variables", async () => {
      process.env.CLAUDECODE = '1';
      process.env.CLAUDE_CODE_MESSAGING_TOKEN = 'parent-token';
      process.env.CLAUDE_CODE_SESSION_ID = 'parent-session';
      process.env.CLAUDE_PID = '123';
      const env = await envOfChild();
      expect(env).not.toHaveProperty('CLAUDECODE');
      expect(env).not.toHaveProperty('CLAUDE_CODE_MESSAGING_TOKEN');
      expect(env).not.toHaveProperty('CLAUDE_CODE_SESSION_ID');
      expect(env).not.toHaveProperty('CLAUDE_PID');
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
