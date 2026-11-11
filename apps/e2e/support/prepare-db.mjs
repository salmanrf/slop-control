// Rebuilds the browser run's own database from the checked-in migrations, before the server starts.
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';
import pg from 'pg';

const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
const name = databaseUrl.pathname.slice(1);
if (!/^slop_control_e2e$/.test(name)) {
  throw new Error(`Refusing to rebuild "${name}": the browser run only owns slop_control_e2e.`);
}
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = '/postgres';

const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`drop database if exists ${name} with (force)`);
await admin.query(`create database ${name}`);
await admin.end();

const migrationsDir = join(import.meta.dirname, '../../../supabase/migrations');
const client = new pg.Client({ connectionString: databaseUrl.toString() });
await client.connect();
for (const file of readdirSync(migrationsDir).sort()) {
  await client.query(readFileSync(join(migrationsDir, file), 'utf8'));
}
await client.end();

// Worktrees from an earlier run belong to clones that no longer exist.
if (process.env.SLOP_DATA_DIR) rmSync(process.env.SLOP_DATA_DIR, { recursive: true, force: true });
