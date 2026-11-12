import type { RuntimeEvent, RuntimeHandle, RuntimeSetup } from '@slop-control/shared';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BASELINE_ENV } from '../src/sessions/baseline-scope';
import {
  CLAUDE_CODE_DEPS,
  ClaudeCodeRuntime,
  type ClaudeCodeDeps,
  type SdkQuery,
} from '../src/sessions/claude-code.runtime';
import { SessionRuntime } from '../src/sessions/runtime';
import { createTestApp, type TestApp } from './support/test-app';

/**
 * The control run's switch (S3-01): the smoke test can leave the baseline scope off, and nothing
 * else can. These cases never start Claude Code; the SDK is replaced at the system boundary.
 */

const INIT = { type: 'system', subtype: 'init', session_id: 'sdk-1', permissionMode: 'auto' };
const SUCCESS = { type: 'result', subtype: 'success', is_error: false, session_id: 'sdk-1' };

const READ_ONLY: RuntimeSetup = {
  permissionMode: 'auto',
  scope: { mayChangeCode: false },
  userLevelSource: false,
};
/** Every combination a phase setup can produce. */
const SETUPS: [string, RuntimeSetup][] = [
  ['a read-only phase', READ_ONLY],
  ['a phase that may change code', { ...READ_ONLY, scope: { mayChangeCode: true } }],
  ['the user-level source on', { ...READ_ONLY, userLevelSource: true }],
  ['both', { permissionMode: 'auto', scope: { mayChangeCode: true }, userLevelSource: true }],
];
const SRC = join(__dirname, '../src');

/** Stands in for the Agent SDK's `query`: keeps the options it was given, and ends the session at once. */
class RecordingSdk {
  options: Record<string, unknown> | null = null;

  query: SdkQuery = ({ options }) => {
    this.options = options;
    return (async function* () {
      yield INIT;
      yield SUCCESS;
    })();
  };
}

async function finish(handle: RuntimeHandle): Promise<RuntimeEvent | undefined> {
  let last: RuntimeEvent | undefined;
  for await (const event of handle.events) last = event;
  return last;
}

/** What `options` holds of the baseline scope: the sandbox, the deny rules, and the environment. */
function expectScopeOn(options: Record<string, unknown> | null): void {
  expect(options).toMatchObject({
    strictMcpConfig: true,
    mcpServers: {},
    sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false },
    settings: {
      disableClaudeAiConnectors: true,
      permissions: { deny: expect.arrayContaining(['Bash(git push:*)', 'Bash(gh:*)']) },
    },
    hooks: { PreToolUse: expect.any(Array) },
    env: BASELINE_ENV,
  });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** The server's source files that mention a name, as paths under `src`. */
function filesNaming(name: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((path) => name.test(readFileSync(path, 'utf8')))
    .map((path) => relative(SRC, path));
}

describe('the baseline scope switch', () => {
  describe('on the runtime Nest wires', () => {
    /** Names a setting might take if one reached the switch. None does. */
    const SWITCH_ENV = [
      'BASELINE_SCOPE',
      'SLOP_BASELINE_SCOPE',
      'SLOP_SCOPE',
      'CLAUDE_BASELINE_SCOPE',
      'CLAUDE_SMOKE',
      'CLAUDE_SMOKE_CONTROL',
      'SMOKE_CONTROL',
      'baselineScope',
    ];
    const savedEnv = { ...process.env };
    let testApp: TestApp;
    let runtime: ClaudeCodeRuntime;
    let sdk: RecordingSdk;

    beforeAll(async () => {
      // RT-12: set before the app is built, so a setting that read one of these would show.
      for (const name of SWITCH_ENV) process.env[name] = 'off';
      testApp = await createTestApp();
      runtime = testApp.app.get(SessionRuntime);
    });

    beforeEach(() => {
      sdk = new RecordingSdk();
      // TEST SEAM: the wired runtime keeps whatever options Nest gave it. Only the SDK, the
      // `claude` command, and the host check are replaced, so no real session starts here.
      const wired = runtime as unknown as { deps: ClaudeCodeDeps };
      wired.deps = {
        ...wired.deps,
        claudeCommand: '/nonexistent/claude',
        loadQuery: async () => sdk.query,
        checkScopeEnforcement: async () => null,
      };
    });

    afterAll(async () => {
      process.env = savedEnv;
      await testApp?.close();
    });

    it('is the Claude Code runtime, built with no test options', () => {
      expect(runtime).toBeInstanceOf(ClaudeCodeRuntime);
      expect(() => testApp.app.get(CLAUDE_CODE_DEPS, { strict: false })).toThrow();
      expect((runtime as unknown as { deps: ClaudeCodeDeps }).deps.baselineScope).toBeUndefined();
    });

    it.each(SETUPS)('passes the baseline scope on start, for %s (RT-11)', async (_name, setup) => {
      const ended = await finish(runtime.start({ brief: 'Do it.', cwd: process.cwd(), setup }));
      expect(ended).toMatchObject({ type: 'session_ended', outcome: 'success' });
      expectScopeOn(sdk.options);
    });

    it.each(SETUPS)('passes the baseline scope on resume, for %s (RT-11)', async (_name, setup) => {
      await finish(
        runtime.resume({ runtimeSessionId: 'sdk-1', message: 'Again.', cwd: process.cwd(), setup }),
      );
      expectScopeOn(sdk.options);
    });

    it('ignores a phase setup that carries a field named after the switch (RT-13)', async () => {
      const setup = { ...READ_ONLY, baselineScope: 'off' } as RuntimeSetup;
      await finish(runtime.start({ brief: 'Do it.', cwd: process.cwd(), setup }));
      expectScopeOn(sdk.options);
    });
  });

  describe('in the source', () => {
    it('is read by the runtime only, and nothing provides the runtime its test options', () => {
      // `baselineScope` the field, not `baselineScopeOptions` or the `baseline-scope` module.
      expect(filesNaming(/\bbaselineScope\b/)).toEqual(['sessions/claude-code.runtime.ts']);
      expect(filesNaming(/\bCLAUDE_CODE_DEPS\b/)).toEqual(['sessions/claude-code.runtime.ts']);
      expect(filesNaming(/\bClaudeCodeDeps\b/)).toEqual(['sessions/claude-code.runtime.ts']);
    });
  });

  describe('on a runtime a test builds', () => {
    const build = (sdk: RecordingSdk, baselineScope?: 'off') =>
      new ClaudeCodeRuntime(
        { holdsSecret: () => false },
        {
          claudeCommand: '/nonexistent/claude',
          loadQuery: async () => sdk.query,
          checkScopeEnforcement: async () => null,
          ...(baselineScope ? { baselineScope } : {}),
        },
      );

    it('leaves the baseline scope out when the switch is set (RT-14)', async () => {
      const sdk = new RecordingSdk();
      const input = { brief: 'Do it.', cwd: process.cwd(), setup: READ_ONLY };
      const ended = await finish(build(sdk, 'off').start(input));
      expect(ended).toMatchObject({ type: 'session_ended', outcome: 'success' });

      for (const option of ['sandbox', 'settings', 'managedSettings', 'hooks', 'strictMcpConfig']) {
        expect(sdk.options).not.toHaveProperty(option);
      }
      const env = sdk.options!.env as Record<string, string>;
      for (const name of Object.keys(BASELINE_ENV)) expect(env).not.toHaveProperty(name);
      // The rest of a session's options stay as they are.
      expect(sdk.options).toMatchObject({ permissionMode: 'auto', permissionPrompts: 'none' });
    });

    it('leaves it out on resume too, so the control run is the same session either way', async () => {
      const sdk = new RecordingSdk();
      await finish(
        build(sdk, 'off').resume({
          runtimeSessionId: 'sdk-1',
          message: 'Again.',
          cwd: process.cwd(),
          setup: READ_ONLY,
        }),
      );
      expect(sdk.options).not.toHaveProperty('sandbox');
    });

    it('has the scope on without the switch', async () => {
      const sdk = new RecordingSdk();
      await finish(build(sdk).start({ brief: 'Do it.', cwd: process.cwd(), setup: READ_ONLY }));
      expectScopeOn(sdk.options);
    });
  });
});
