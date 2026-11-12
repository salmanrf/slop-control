import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** Apart from a developer's own `npm run dev`, so both can run at once. */
export const PORTS = { api: 3100, web: 5273, github: 4010 };

export const WEB_URL = `http://127.0.0.1:${PORTS.web}`;
export const API_URL = `http://127.0.0.1:${PORTS.api}`;
export const GITHUB_STUB_URL = `http://127.0.0.1:${PORTS.github}`;

/** Rebuilt for every run, so dev data is never touched. */
export const DATABASE_NAME = 'slop_control_e2e';
export const DATA_DIR = join(tmpdir(), 'slop-control-e2e-data');
export const USER_FILE = join(import.meta.dirname, '../.auth/user.json');

/** The repo the GitHub stub serves issues for. */
export const STUB_REPO = { owner: 'e2e-owner', repo: 'e2e-repo' };
/** The repo the open PR cases push to. The stub knows it, and it has no issues. */
export const PR_REPO = { owner: 'e2e-owner', repo: 'pr-repo' };
/** Whose token the stub says every token is. */
export const STUB_LOGIN = 'e2e-user';

/**
 * Holds the bare repos pushes go to, through the server's GITHUB_GIT_URL setting: a repo is at
 * `<owner>/<repo>.git`, so a push is a real git push that never leaves this machine.
 */
export const REMOTES_DIR = join(tmpdir(), 'slop-control-e2e-remotes');
/** Seals the run's stored credentials. Fixed and worthless: 32 bytes, as hex. */
export const SECRET_KEY = '0123456789abcdef'.repeat(4);

export interface SupabaseEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  databaseUrl: string;
}

let cached: SupabaseEnv | undefined;

/** Reads the local Supabase stack's settings, which the real sign-in and the admin API need. */
export function supabaseEnv(): SupabaseEnv {
  if (cached) return cached;
  let status = '';
  try {
    status = execFileSync('supabase', ['status', '-o', 'env'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error(
      'Local Supabase must be running for the browser run. Start it with `npm run db:start`.',
    );
  }
  const read = (name: string): string => {
    const value = new RegExp(`^${name}="?([^"\\n]*)"?$`, 'm').exec(status)?.[1];
    if (!value) throw new Error(`\`supabase status\` didn't report ${name}.`);
    return value;
  };
  const adminDatabaseUrl = new URL(read('DB_URL'));
  adminDatabaseUrl.pathname = `/${DATABASE_NAME}`;
  cached = {
    url: read('API_URL'),
    anonKey: read('ANON_KEY'),
    serviceRoleKey: read('SERVICE_ROLE_KEY'),
    databaseUrl: adminDatabaseUrl.toString(),
  };
  return cached;
}
