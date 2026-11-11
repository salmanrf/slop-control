import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { ADMIN_DATABASE_URL } from './test-env';

const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');

/** The first migration is the Sprint 1 schema; the rest are what an upgrade applies. */
export const INITIAL_MIGRATION = '20261102000000_initial_schema.sql';

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

export function databaseUrl(name: string): string {
  const url = new URL(ADMIN_DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function asAdmin(run: (admin: Client) => Promise<void>): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await run(admin);
  } finally {
    await admin.end();
  }
}

/** Creates an empty database of its own, so a suite can migrate it step by step. */
export async function createEmptyDatabase(name: string): Promise<string> {
  await asAdmin(async (admin) => {
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
  });
  return databaseUrl(name);
}

export function dropDatabase(name: string): Promise<void> {
  return asAdmin(async (admin) => {
    await admin.query(`drop database if exists ${name} with (force)`);
  });
}

/** Applies the committed migration files, in the order given, as `supabase db reset` would. */
export async function applyMigrations(url: string, files: string[]): Promise<void> {
  await withClient(url, async (client) => {
    for (const file of files) await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  });
}

export async function withClient<T>(url: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}
