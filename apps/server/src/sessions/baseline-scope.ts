import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

/**
 * The baseline scope (FR-27): no pushing, no `gh`, no outbound SSH, and no connectors from the
 * developer's Claude account, in every phase. It isn't a setting, so nothing here reads one.
 *
 * Provisional until the S2-01 spike reports. The layers, strongest first:
 * 1. Claude Code's sandbox, which restricts the processes the agent's commands start.
 * 2. Settings that keep account connectors and other MCP servers out, and deny the plain commands.
 * 3. An environment that points git and `gh` away from the host's logins.
 * 4. A pre-tool hook, which gives the agent a readable denial for the obvious attempts.
 * Layers 3 and 4 can be worked around from a shell, so they only add to layers 1 and 2.
 */

const GITHUB_DOMAINS = ['github.com', '*.github.com'];

/** Registries a dependency install may reach. Everything else is refused, since nobody can be asked. */
const REGISTRY_DOMAINS = [
  'registry.npmjs.org',
  'registry.yarnpkg.com',
  'pypi.org',
  'files.pythonhosted.org',
  'crates.io',
  'static.crates.io',
  'index.crates.io',
  'proxy.golang.org',
  'sum.golang.org',
  'rubygems.org',
];

/** Where the host keeps logins a command could push or sign in with. */
const CREDENTIAL_PATHS = [
  '~/.ssh',
  '~/.config/gh',
  '~/.config/git/credentials',
  '~/.git-credentials',
  '~/.netrc',
  '~/Library/Keychains',
];

const DENY_RULES = [
  'Bash(git push:*)',
  'Bash(gh:*)',
  'Bash(ssh:*)',
  'Bash(scp:*)',
  'Bash(sftp:*)',
  // A folder needs `/**`; a file is named as it is.
  ...CREDENTIAL_PATHS.map((path) => `Read(${path})`),
  ...CREDENTIAL_PATHS.map((path) => `Read(${path}/**)`),
  ...GITHUB_DOMAINS.map((domain) => `WebFetch(domain:${domain})`),
];

const BLOCKED_COMMANDS: RegExp[] = [
  // `push` as git's subcommand, after any global options; not `git stash push` or a commit message.
  /\bgit(\s+-[cC]\s+\S+|\s+--?[\w-]+(=\S+)?)*\s+push\b/,
  /(^|[\s;&|(`/])gh(\s|$)/,
  /(^|[\s;&|(`/])(ssh|scp|sftp)(\s|$)/,
];

export const BLOCKED_MESSAGE =
  "This session can't push, use `gh`, open SSH connections, or use connectors. Carry on without it, and say what you couldn't do in your report.";

/** A folder that never exists, so `gh` finds no login there. */
const NO_GH_CONFIG = '/var/empty/slop-control-no-gh-config';

/** Added to every session's environment. An agent can unset these, so the sandbox is what holds. */
export const BASELINE_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '/usr/bin/false',
  SSH_ASKPASS: '/usr/bin/false',
  GIT_SSH_COMMAND: '/usr/bin/false',
  GH_CONFIG_DIR: NO_GH_CONFIG,
  GH_PROMPT_DISABLED: '1',
  // An empty helper clears the ones the host configured, such as the macOS keychain.
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'credential.helper',
  GIT_CONFIG_VALUE_0: '',
};

interface PreToolUseInput {
  hook_event_name?: unknown;
  tool_name?: unknown;
  tool_input?: unknown;
}

/** Denies the obvious attempts with a reason the agent can read. A denial doesn't end the session. */
export async function denyOutwardActions(input: unknown): Promise<Record<string, unknown>> {
  const { hook_event_name, tool_name, tool_input } = (input ?? {}) as PreToolUseInput;
  if (hook_event_name !== 'PreToolUse' || typeof tool_name !== 'string') return {};

  const command = (tool_input as { command?: unknown } | null)?.command;
  const blocked =
    // No MCP server is part of a session yet, so any such tool came from somewhere it shouldn't.
    tool_name.startsWith('mcp__') ||
    (tool_name === 'Bash' &&
      typeof command === 'string' &&
      BLOCKED_COMMANDS.some((pattern) => pattern.test(command)));
  if (!blocked) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: BLOCKED_MESSAGE,
    },
  };
}

/**
 * @params gitCommonDir: the linked clone's git folder, which a worktree's commits write into; null outside a repo
 * @return the Agent SDK options that apply the baseline scope
 * The same for `start` and `resume`, and for every phase.
 */
export function baselineScopeOptions(gitCommonDir: string | null): Record<string, unknown> {
  const restrictions = {
    disableClaudeAiConnectors: true,
    permissions: { deny: DENY_RULES },
  };
  return {
    // Ignores the repo's `.mcp.json` and the user's MCP servers: those run outside the sandbox.
    strictMcpConfig: true,
    mcpServers: {},
    sandbox: {
      enabled: true,
      // Fails closed: without a sandbox the session ends with an error and never runs open.
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        allowWrite: gitCommonDir ? [gitCommonDir] : [],
        denyRead: CREDENTIAL_PATHS,
      },
      network: { allowedDomains: REGISTRY_DOMAINS, deniedDomains: GITHUB_DOMAINS },
    },
    // Flag settings outrank the repo's own `.claude/settings.json`, so it can't loosen these.
    settings: restrictions,
    managedSettings: {
      ...restrictions,
      sandbox: { enabled: true, allowUnsandboxedCommands: false },
    },
    hooks: { PreToolUse: [{ hooks: [denyOutwardActions] }] },
  };
}

/**
 * @return null if this host can sandbox a session's commands, or what's missing
 * Lets a launch be refused before a worktree exists, where the host can't enforce the scope at all.
 */
export async function checkScopeEnforcement(): Promise<string | null> {
  if (process.platform === 'darwin') {
    return (await isExecutable('/usr/bin/sandbox-exec')) ? null : "macOS's sandbox-exec is missing";
  }
  if (process.platform === 'linux') {
    const missing = [];
    for (const tool of ['bwrap', 'socat']) if (!(await onPath(tool))) missing.push(tool);
    return missing.length === 0 ? null : `${missing.join(' and ')} must be installed`;
  }
  return `sandboxing isn't supported on ${process.platform}`;
}

/** The folder a worktree's commits are written to, which is outside the worktree itself. */
export function gitCommonDir(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd },
      (error, stdout) => resolve(error ? null : stdout.trim() || null),
    );
  });
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function onPath(tool: string): Promise<boolean> {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && (await isExecutable(join(dir, tool)))) return true;
  }
  return false;
}
