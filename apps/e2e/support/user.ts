import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { USER_FILE, supabaseEnv } from './env';

export interface RunUser {
  id: string;
  email: string;
  password: string;
}

function adminHeaders(): Record<string, string> {
  const { serviceRoleKey } = supabaseEnv();
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  };
}

/** Sign-up is disabled, so the run's user is made through Supabase's admin API, as the README does. */
export async function createRunUser(): Promise<RunUser> {
  const email = `e2e-${Date.now()}@example.invalid`;
  const password = randomBytes(18).toString('base64url');
  const response = await fetch(`${supabaseEnv().url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!response.ok)
    throw new Error(`Supabase couldn't create the run's user (${response.status}).`);
  const { id } = (await response.json()) as { id: string };
  const user = { id, email, password };
  mkdirSync(dirname(USER_FILE), { recursive: true });
  writeFileSync(USER_FILE, JSON.stringify(user));
  return user;
}

export function readRunUser(): RunUser {
  return JSON.parse(readFileSync(USER_FILE, 'utf8')) as RunUser;
}

export async function deleteRunUser(): Promise<void> {
  let user: RunUser;
  try {
    user = readRunUser();
  } catch {
    return;
  }
  await fetch(`${supabaseEnv().url}/auth/v1/admin/users/${user.id}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
  rmSync(USER_FILE, { force: true });
}
