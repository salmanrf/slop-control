import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  RuntimeEvent,
  RuntimeHandle,
  RuntimeReadiness,
  RuntimeResumeInput,
  RuntimeSetup,
  RuntimeStartInput,
} from '@slop-control/shared';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { Redactor } from '../common/redactor';
import {
  BASELINE_ENV,
  baselineScopeOptions,
  checkScopeEnforcement,
  gitCommonDir,
} from './baseline-scope';
import { SessionRuntime } from './runtime';

type SdkMessage = Record<string, unknown>;

/** The part of the Agent SDK's `query` this runtime uses. */
export type SdkQuery = (params: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export interface ClaudeCodeDeps {
  claudeCommand: string;
  loadQuery: () => Promise<SdkQuery>;
  /** Null if this host can enforce the baseline scope, or what's missing. Defaults to checking the host. */
  checkScopeEnforcement?: () => Promise<string | null>;
  /**
   * Leaves the baseline scope off. It exists only for the smoke test's control run, which has to
   * show that an unprotected push is detected at all. Only a test that builds the runtime itself
   * can set it: no setting, environment variable, request, or phase setup reaches these options,
   * and the runtime Nest wires is given none of them.
   */
  baselineScope?: 'off';
}

export const CLAUDE_CODE_DEPS = Symbol('CLAUDE_CODE_DEPS');

const AUTH_STATUS_TIMEOUT_MS = 15_000;
const ALLOWED_ENV = new Set([
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
]);
/** Only the host's setup. Other `CLAUDE_*` names belong to a Claude Code session the server may run under. */
const ALLOWED_CLAUDE_ENV = new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN']);
const ALLOWED_ENV_PREFIXES = ['ANTHROPIC_'];
/** The SDK's own binary. A developer's `claude --resume` in the worktree doesn't run from here. */
const SDK_BINARY_MARKER = 'claude-agent-sdk';
const TERMINATE_GRACE_MS = 2000;

const defaultDeps: ClaudeCodeDeps = {
  claudeCommand: 'claude',
  // The SDK is ESM-only, and this dynamic import stays a real `import()` in the compiled output.
  loadQuery: async () =>
    (await import('@anthropic-ai/claude-agent-sdk')).query as unknown as SdkQuery,
};

interface AuthStatus {
  loggedIn: boolean;
  projectsDirectory: string | null;
}

type AuthResult =
  { ok: true; status: AuthStatus } | { ok: false; reason: 'missing' | 'unreadable' };

/** The only code that knows about the Agent SDK (FR-8). Uses the host's Claude Code setup (A-1). */
@Injectable()
export class ClaudeCodeRuntime extends SessionRuntime {
  private readonly deps: ClaudeCodeDeps;

  constructor(
    @Inject(Redactor) private readonly secrets: Pick<Redactor, 'holdsSecret'>,
    @Optional() @Inject(CLAUDE_CODE_DEPS) deps?: ClaudeCodeDeps,
  ) {
    super();
    this.deps = deps ?? defaultDeps;
  }

  async checkReady(): Promise<RuntimeReadiness> {
    const result = await this.readAuthStatus();
    if (!result.ok) {
      return result.reason === 'missing'
        ? {
            ready: false,
            message: "Claude Code isn't installed on the host. Install it and sign in.",
          }
        : { ready: false, message: "Claude Code's sign-in status couldn't be read on the host." };
    }
    if (!result.status.loggedIn) {
      return {
        ready: false,
        message: "Claude Code isn't signed in. Run `claude auth login` on the host.",
      };
    }
    const unenforceable = await this.scopeUnenforceable();
    return unenforceable ? { ready: false, message: unenforceable } : { ready: true };
  }

  start(input: RuntimeStartInput): RuntimeHandle {
    return this.open(input.brief, input.cwd, input.setup, {});
  }

  resume(input: RuntimeResumeInput): RuntimeHandle {
    return this.open(input.message, input.cwd, input.setup, { resume: input.runtimeSessionId });
  }

  async terminateLeftovers(cwd: string): Promise<void> {
    let realCwd: string;
    try {
      realCwd = realpathSync(cwd);
    } catch {
      return;
    }

    const processes = await listProcesses();
    const agents: number[] = [];
    for (const { pid, command } of processes) {
      if (command.includes(SDK_BINARY_MARKER) && (await processCwd(pid)) === realCwd) {
        agents.push(pid);
      }
    }
    await terminate(agents.flatMap((pid) => [pid, ...descendants(pid, processes)]));
  }

  /** Says why a session can't run here under the baseline scope, or null if it can. */
  private async scopeUnenforceable(): Promise<string | null> {
    const missing = await (this.deps.checkScopeEnforcement ?? checkScopeEnforcement)();
    return missing
      ? `This host can't enforce a session's scope (${missing}), so sessions don't run here.`
      : null;
  }

  private open(
    prompt: string,
    cwd: string,
    setup: RuntimeSetup,
    extra: Record<string, unknown>,
  ): RuntimeHandle {
    const abortController = new AbortController();
    const state = { stopRequested: false };

    return {
      events: this.events(prompt, cwd, setup, extra, abortController, state),
      stop: async () => {
        state.stopRequested = true;
        abortController.abort();
      },
    };
  }

  /** The same for a start and a resume, apart from `extra`. No field of `setup` can drop the baseline scope. */
  private async options(
    cwd: string,
    setup: RuntimeSetup,
    extra: Record<string, unknown>,
    abortController: AbortController,
  ): Promise<Record<string, unknown>> {
    // Always on, except in the smoke test's control run. See `ClaudeCodeDeps.baselineScope`.
    const scopeOn = this.deps.baselineScope !== 'off';
    return {
      ...extra,
      cwd,
      env: scopeOn ? { ...this.childEnv(), ...BASELINE_ENV } : this.childEnv(),
      abortController,
      permissionMode: 'auto',
      // Nobody is watching: anything that would prompt is denied, and the agent carries on.
      permissionPrompts: 'none',
      disallowedTools: ['AskUserQuestion'],
      // The project source carries the repo's `.claude/` and `CLAUDE.md`, and is always on.
      settingSources: setup.userLevelSource ? ['user', 'project', 'local'] : ['project', 'local'],
      ...(scopeOn ? baselineScopeOptions(await gitCommonDir(cwd)) : {}),
    };
  }

  private async *events(
    prompt: string,
    cwd: string,
    setup: RuntimeSetup,
    extra: Record<string, unknown>,
    abortController: AbortController,
    state: { stopRequested: boolean },
  ): AsyncGenerator<RuntimeEvent> {
    const stopped: RuntimeEvent = { type: 'session_ended', outcome: 'stopped', message: null };
    let started = false;

    try {
      const unenforceable = await this.scopeUnenforceable();
      if (unenforceable) {
        yield { type: 'session_ended', outcome: 'error', message: unenforceable };
        return;
      }
      const auth = await this.readAuthStatus();
      const projectsDirectory = auth.ok ? auth.status.projectsDirectory : null;
      const options = await this.options(cwd, setup, extra, abortController);
      const query = await this.deps.loadQuery();

      for await (const raw of query({ prompt, options })) {
        const message = raw as SdkMessage;

        if (!started && message.type === 'system' && message.subtype === 'init') {
          started = true;
          const runtimeSessionId = String(message.session_id);
          yield {
            type: 'session_started',
            runtimeSessionId,
            transcriptPath: transcriptPath(projectsDirectory, cwd, runtimeSessionId),
          };
        }

        // S1-04: `init` can say auto while a later status message reports the real mode.
        const mode = message.permissionMode;
        if (typeof mode === 'string' && mode !== 'auto') {
          abortController.abort();
          yield {
            type: 'session_ended',
            outcome: 'error',
            message: `Claude Code couldn't run in auto permission mode (it reported "${mode}"), so the session was ended.`,
          };
          return;
        }

        if (message.type === 'result') {
          yield state.stopRequested ? stopped : endedFromResult(message);
          return;
        }
      }
      if (state.stopRequested) yield stopped;
    } catch (error) {
      yield state.stopRequested
        ? stopped
        : {
            type: 'session_ended',
            outcome: 'error',
            message: error instanceof Error ? error.message : String(error),
          };
    }
  }

  /** Reads `loggedIn` and `projectsDirectory` only. The output also names the account, so it's never kept. */
  private readAuthStatus(): Promise<AuthResult> {
    return new Promise((resolve) => {
      execFile(
        this.deps.claudeCommand,
        ['auth', 'status', '--json'],
        { env: this.childEnv(), timeout: AUTH_STATUS_TIMEOUT_MS },
        (error, stdout) => {
          if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
            resolve({ ok: false, reason: 'missing' });
            return;
          }
          // Signed out exits 1 and still prints its JSON, so the output decides.
          try {
            const parsed = JSON.parse(stdout) as {
              loggedIn?: unknown;
              projectsDirectory?: unknown;
            };
            if (typeof parsed.loggedIn !== 'boolean') throw new Error('No loggedIn field.');
            resolve({
              ok: true,
              status: {
                loggedIn: parsed.loggedIn,
                projectsDirectory:
                  typeof parsed.projectsDirectory === 'string' ? parsed.projectsDirectory : null,
              },
            });
          } catch {
            resolve({ ok: false, reason: 'unreadable' });
          }
        },
      );
    });
  }

  /**
   * Enough to run with the host's setup, and nothing holding the workspace's credentials (NFR-4).
   * The server's secret key is never on the allow list, and a value holding a stored secret is dropped.
   */
  private childEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      const allowed =
        ALLOWED_ENV.has(name) ||
        ALLOWED_CLAUDE_ENV.has(name) ||
        ALLOWED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
      if (allowed && !this.secrets.holdsSecret(value)) env[name] = value;
    }
    return env;
  }
}

interface HostProcess {
  pid: number;
  ppid: number;
  command: string;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });
}

async function listProcesses(): Promise<HostProcess[]> {
  const output = await run('ps', ['-axo', 'pid=,ppid=,command=']);
  return output.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match
      ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? '' }]
      : [];
  });
}

async function processCwd(pid: number): Promise<string | null> {
  try {
    const output = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
    const line = output.split('\n').find((candidate) => candidate.startsWith('n'));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

function descendants(pid: number, processes: HostProcess[]): number[] {
  const children = processes.filter((item) => item.ppid === pid).map((item) => item.pid);
  return children.flatMap((child) => [child, ...descendants(child, processes)]);
}

function signal(pid: number, name: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, name);
    return true;
  } catch {
    return false;
  }
}

async function terminate(pids: number[]): Promise<void> {
  const targets = pids.filter((pid) => pid !== process.pid);
  targets.forEach((pid) => signal(pid, 'SIGTERM'));
  const deadline = Date.now() + TERMINATE_GRACE_MS;
  while (Date.now() < deadline && targets.some((pid) => signal(pid, 0))) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  targets.forEach((pid) => signal(pid, 'SIGKILL'));
}

function endedFromResult(message: SdkMessage): RuntimeEvent {
  if (message.subtype === 'success' && message.is_error !== true) {
    return { type: 'session_ended', outcome: 'success', message: null };
  }
  const errors = Array.isArray(message.errors) ? message.errors.join('; ') : '';
  const text = typeof message.result === 'string' ? message.result : '';
  return {
    type: 'session_ended',
    outcome: 'error',
    message: errors || text || `Claude Code ended with ${String(message.subtype)}.`,
  };
}

/** See the S1-05 note for this undocumented layout. */
function transcriptPath(
  projectsDirectory: string | null,
  cwd: string,
  sessionId: string,
): string | null {
  if (!projectsDirectory) return null;
  let realCwd = cwd;
  try {
    realCwd = realpathSync(cwd);
  } catch {
    return null;
  }
  return join(projectsDirectory, realCwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
}
