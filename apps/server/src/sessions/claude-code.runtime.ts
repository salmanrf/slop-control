import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  RuntimeEvent,
  RuntimeHandle,
  RuntimeReadiness,
  RuntimeResumeInput,
  RuntimeStartInput,
} from '@slop-control/shared';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { AppConfig } from '../config';
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
const ALLOWED_ENV_PREFIXES = ['CLAUDE_', 'ANTHROPIC_'];

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
    @Inject(AppConfig) private readonly config: Pick<AppConfig, 'githubToken'>,
    @Optional() @Inject(CLAUDE_CODE_DEPS) deps?: ClaudeCodeDeps,
  ) {
    super();
    this.deps = deps ?? defaultDeps;
  }

  async checkReady(): Promise<RuntimeReadiness> {
    const result = await this.readAuthStatus();
    if (result.ok) {
      if (result.status.loggedIn) return { ready: true };
      return {
        ready: false,
        message: "Claude Code isn't signed in. Run `claude auth login` on the host.",
      };
    }
    return result.reason === 'missing'
      ? {
          ready: false,
          message: "Claude Code isn't installed on the host. Install it and sign in.",
        }
      : { ready: false, message: "Claude Code's sign-in status couldn't be read on the host." };
  }

  start(input: RuntimeStartInput): RuntimeHandle {
    return this.open(input.brief, input.cwd, {});
  }

  resume(input: RuntimeResumeInput): RuntimeHandle {
    return this.open(input.message, input.cwd, { resume: input.runtimeSessionId });
  }

  private open(prompt: string, cwd: string, extra: Record<string, unknown>): RuntimeHandle {
    const abortController = new AbortController();
    const state = { stopRequested: false };
    const options = {
      ...extra,
      cwd,
      env: this.childEnv(),
      abortController,
      permissionMode: 'auto',
      // Nobody is watching: anything that would prompt is denied, and the agent carries on.
      permissionPrompts: 'none',
      disallowedTools: ['AskUserQuestion'],
    };

    return {
      events: this.events(prompt, cwd, options, abortController, state),
      stop: async () => {
        state.stopRequested = true;
        abortController.abort();
      },
    };
  }

  private async *events(
    prompt: string,
    cwd: string,
    options: Record<string, unknown>,
    abortController: AbortController,
    state: { stopRequested: boolean },
  ): AsyncGenerator<RuntimeEvent> {
    const stopped: RuntimeEvent = { type: 'session_ended', outcome: 'stopped', message: null };
    let started = false;

    try {
      const auth = await this.readAuthStatus();
      const projectsDirectory = auth.ok ? auth.status.projectsDirectory : null;
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

  /** Enough to run with the host's setup, and nothing holding the workspace's credentials (NFR-4). */
  private childEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      const allowed =
        ALLOWED_ENV.has(name) || ALLOWED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
      const holdsSecret = this.config.githubToken !== '' && value.includes(this.config.githubToken);
      if (allowed && !holdsSecret) env[name] = value;
    }
    return env;
  }
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
