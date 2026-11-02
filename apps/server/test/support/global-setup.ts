import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { ADMIN_DATABASE_URL, TEST_DATABASE_NAME, TEST_DATABASE_URL } from './test-env';

/** Rebuilds a dedicated test database from the checked-in migrations, so dev data is never touched. */
export default async function globalSetup(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DATABASE_NAME} with (force)`);
  await admin.query(`create database ${TEST_DATABASE_NAME}`);
  await admin.end();

  const migrationsDir = join(__dirname, '../../../../supabase/migrations');
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  for (const file of readdirSync(migrationsDir).sort()) {
    await client.query(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  await client.end();
}
