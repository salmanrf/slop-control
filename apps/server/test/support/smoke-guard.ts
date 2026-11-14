import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { PlantedLogins } from './planted-logins';

/**
 * The smoke test's SSH guard (S3-01). A session whose sandbox fails, or the control run that has
 * none, could otherwise authenticate as the developer: OpenSSH takes its keys and configuration
 * from the home folder in the user record, whatever `HOME` says. So the scope cases don't start
 * while a real key or agent is in reach. There is no override, and nothing here writes anywhere.
 */

/** Only for the guard's own unit test, which can't use the real user record. Nothing here makes the guard pass. */
export interface SmokeGuardOptions {
  /** Stands in for the user record's home folder. */
  home?: string;
  /** Stands in for this process's environment. */
  env?: NodeJS.ProcessEnv;
  /** Stands in for the system-wide SSH configuration; null for none. */
  systemSshConfig?: string | null;
}

const SYSTEM_SSH_CONFIG = '/etc/ssh/ssh_config';
/** OpenSSH's own limit on nested `Include` lines. */
const MAX_INCLUDE_DEPTH = 16;
/** No private key is anywhere near this size. */
const MAX_KEY_BYTES = 1024 * 1024;
const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|^PuTTY-User-Key-File-/m;
const AGENT_PROBE_TIMEOUT_MS = 5000;

/**
 * Asks an agent for its identities, as `ssh-add -l` does. Run as its own process, because this
 * guard is synchronous and a socket in Node is not. Prints one of the three answers below.
 */
const AGENT_PROBE = `
const net = require('node:net');
let connected = false;
let reply = Buffer.alloc(0);
const done = (answer) => { process.stdout.write(answer); process.exit(0); };
const socket = net.connect(process.argv[1]);
socket.on('connect', () => { connected = true; socket.write(Buffer.from([0, 0, 0, 1, 11])); });
socket.on('data', (chunk) => {
  reply = Buffer.concat([reply, chunk]);
  if (reply.length >= 5 && reply[4] !== 12) done('reachable');
  if (reply.length >= 9) done(reply.readUInt32BE(5) === 0 ? 'empty' : 'reachable');
});
socket.on('error', () => done(connected ? 'reachable' : 'unreachable'));
socket.on('close', () => done(connected ? 'reachable' : 'unreachable'));
setTimeout(() => done(connected ? 'reachable' : 'unreachable'), 1500);
`;

type AgentState =
  /** Nothing is listening there. */
  | 'unreachable'
  /** An agent answered that it holds no identity, so it can't sign in as anyone. */
  | 'empty'
  /** Something accepted the connection and didn't say it was empty. */
  | 'reachable';

interface ConfigLine {
  keyword: string;
  value: string;
  file: string;
}

/**
 * @params planted: the planted logins, after `activate`
 * @return nothing, or throws naming the key or agent found and how to run safely
 * Refuses the scope cases while a real SSH key or agent is in reach. Reads the home folder from the user record, and changes nothing there.
 */
export function assertNoRealSshInReach(
  planted: Pick<PlantedLogins, 'home' | 'sshAuthSockBefore'>,
  options: SmokeGuardOptions = {},
): void {
  // The user record, not `HOME` or `os.homedir()`: those follow the environment, and OpenSSH doesn't.
  const home = options.home ?? userInfo().homedir;
  const env = options.env ?? process.env;
  const systemConfig =
    options.systemSshConfig === undefined ? SYSTEM_SSH_CONFIG : options.systemSshConfig;

  const config = [
    ...readSshConfig(join(home, '.ssh/config'), join(home, '.ssh'), home),
    ...(systemConfig ? readSshConfig(systemConfig, dirname(systemConfig), home) : []),
  ];
  const found: string[] = [];

  // Any private key under `.ssh`, and any the configuration names elsewhere (test plan Q1).
  // A planted home is a throwaway folder. Naming the real one as planted makes nothing in it planted.
  const plantedKeys = new Set(
    (resolve(planted.home) === resolve(home) ? [] : filesUnder(join(planted.home, '.ssh'))).flatMap(
      (path) => {
        const key = readablePrivateKey(path);
        return key ? [key] : [];
      },
    ),
  );
  const candidates = new Set(filesUnder(join(home, '.ssh')));
  for (const line of config) {
    if (line.keyword !== 'identityfile' || line.value.toLowerCase() === 'none') continue;
    const path = expandPath(line.value, home);
    if (path) candidates.add(path);
  }
  for (const path of candidates) {
    const key = readablePrivateKey(path);
    if (key && !plantedKeys.has(key)) found.push(`a readable private key at ${path}`);
  }

  const sockets = new Map<string, string>();
  const addSocket = (path: string | null | undefined, from: string) => {
    if (path && !sockets.has(path)) sockets.set(path, from);
  };
  addSocket(env.SSH_AUTH_SOCK, 'SSH_AUTH_SOCK');
  // `activate` takes the variable out of this process, but the agent behind it is still running.
  addSocket(planted.sshAuthSockBefore, 'SSH_AUTH_SOCK before the planted logins were activated');
  for (const line of config) {
    if (line.keyword !== 'identityagent') continue;
    addSocket(identityAgentSocket(line.value, home, env), `IdentityAgent in ${line.file}`);
  }
  for (const [path, from] of sockets) {
    if (agentState(path) === 'reachable') found.push(`an SSH agent at ${path} (${from})`);
  }

  if (found.length === 0) return;
  throw new Error(
    [
      'Refusing to run the scope cases: a real SSH login is in reach, and a session whose sandbox fails could use it.',
      `Found: ${found.join('; ')}.`,
      'There are two supported ways to run, and no override:',
      '  1. As a macOS user with no SSH keys, with Claude Code signed in through CLAUDE_CODE_OAUTH_TOKEN.',
      '  2. With your own keys made unreadable for the run, and no agent holding them. That step is yours: the smoke test never moves, locks, or changes anything under your home folder.',
    ].join('\n'),
  );
}

/** Every `IdentityFile`, `IdentityAgent`, and other line of a configuration file and the files it includes, whichever host they're for. */
function readSshConfig(file: string, includeBase: string, home: string, depth = 0): ConfigLine[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const lines: ConfigLine[] = [];
  for (const raw of text.split('\n')) {
    const match = /^\s*([A-Za-z]+)(?:\s*=\s*|\s+)(.*?)\s*$/.exec(raw);
    if (!match) continue;
    const keyword = match[1]!.toLowerCase();
    const value = match[2]!;
    if (keyword !== 'include') {
      lines.push({ keyword, value: unquote(value), file });
      continue;
    }
    if (depth >= MAX_INCLUDE_DEPTH) continue;
    for (const pattern of value.split(/\s+/).filter(Boolean)) {
      const expanded = expandPath(unquote(pattern), home, includeBase);
      for (const included of expanded ? matchingFiles(expanded) : []) {
        lines.push(...readSshConfig(included, includeBase, home, depth + 1));
      }
    }
  }
  return lines;
}

function unquote(value: string): string {
  return /^".*"$/.test(value) ? value.slice(1, -1) : value;
}

/** `~`, `%d`, and `%u` as OpenSSH reads them. A path that still isn't absolute is resolved against `base`, or dropped. */
function expandPath(value: string, home: string, base?: string): string | null {
  let path = value.replace(/%%|%d|%u/g, (token) =>
    token === '%%' ? '%' : token === '%d' ? home : userInfo().username,
  );
  if (path === '~') path = home;
  else if (path.startsWith('~/')) path = join(home, path.slice(2));
  if (isAbsolute(path)) return path;
  return base ? join(base, path) : null;
}

/** The files a path names, where its last part may hold `*` and `?`. */
function matchingFiles(path: string): string[] {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (!/[*?]/.test(name)) return [path];
  const pattern = new RegExp(
    `^${name
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
  );
  try {
    return readdirSync(dirname(path))
      .filter((entry) => pattern.test(entry))
      .sort()
      .map((entry) => join(dirname(path), entry));
  } catch {
    return [];
  }
}

/** Every file under a folder. A folder that can't be listed holds nothing this user can read. */
function filesUnder(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

/** The file's text if this user can read it and it's a private key, else null. */
function readablePrivateKey(path: string): string | null {
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > MAX_KEY_BYTES) return null;
    const text = readFileSync(path, 'latin1');
    return PRIVATE_KEY.test(text) ? text : null;
  } catch {
    return null;
  }
}

/** The socket an `IdentityAgent` line names, or null for `none`, for `SSH_AUTH_SOCK` (checked on its own), and for an unset variable. */
function identityAgentSocket(value: string, home: string, env: NodeJS.ProcessEnv): string | null {
  if (value.toLowerCase() === 'none' || value === 'SSH_AUTH_SOCK') return null;
  const variable = /^\$(?:\{(\w+)\}|(\w+))$/.exec(value);
  if (variable) return env[variable[1] ?? variable[2]!] || null;
  return expandPath(value, home);
}

function agentState(socketPath: string): AgentState {
  try {
    if (!statSync(socketPath).isSocket()) return 'unreachable';
  } catch {
    return 'unreachable';
  }
  const probe = spawnSync(process.execPath, ['-e', AGENT_PROBE, socketPath], {
    encoding: 'utf8',
    timeout: AGENT_PROBE_TIMEOUT_MS,
  });
  const answer = probe.stdout;
  // A probe that couldn't say counts as an agent in reach: the guard fails closed.
  return answer === 'unreachable' || answer === 'empty' ? answer : 'reachable';
}
