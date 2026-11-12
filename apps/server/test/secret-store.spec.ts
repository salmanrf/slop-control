import { Client } from 'pg';
import { PgSecretStore, SecretsNotConfiguredError } from '../src/common/secret-store';
import { SecretStore, type SecretOwner } from '../src/common/secret-store';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app';
import { TEST_DATABASE_URL } from './support/test-env';

const WORKSPACE: SecretOwner = {
  kind: 'workspace_github',
  workspaceId: '11111111-0000-4000-8000-000000000000',
};
/** The same ID under another kind of owner, which must still be a different owner. */
const SOURCE: SecretOwner = {
  kind: 'ticket_source',
  sourceId: '11111111-0000-4000-8000-000000000000',
};
const OTHER: SecretOwner = {
  kind: 'workspace_github',
  workspaceId: '22222222-0000-4000-8000-000000000000',
};
const SECRET = 'ghp_a_secret_only_the_store_may_hold';

async function storedRows(): Promise<{ owner_id: string; sealed: string }[]> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  const { rows } = await client.query('select owner_id, sealed from secret');
  await client.end();
  return rows;
}

describe('SecretStore', () => {
  let t: TestApp;
  let store: SecretStore;

  beforeAll(async () => {
    t = await createTestApp();
    store = t.app.get(SecretStore);
  });
  beforeEach(resetDatabase);
  afterAll(() => t.close());

  it('gives back what it was given, and null for an owner with nothing stored', async () => {
    await store.put(WORKSPACE, SECRET);
    expect(await store.get(WORKSPACE)).toBe(SECRET);
    expect(await store.get(OTHER)).toBeNull();
    expect(await store.get(SOURCE)).toBeNull();
  });

  it('replaces an earlier secret for the same owner', async () => {
    await store.put(WORKSPACE, 'first');
    await store.put(WORKSPACE, SECRET);
    expect(await store.get(WORKSPACE)).toBe(SECRET);
    expect(await storedRows()).toHaveLength(1);
  });

  it('erases a secret, and does nothing when there is none', async () => {
    await store.put(WORKSPACE, SECRET);
    await store.erase(WORKSPACE);
    await store.erase(WORKSPACE);
    expect(await store.get(WORKSPACE)).toBeNull();
    expect(await storedRows()).toHaveLength(0);
  });

  it('keeps owners apart, and lists every value for the Redactor', async () => {
    await store.put(WORKSPACE, 'for-the-workspace');
    await store.put(SOURCE, 'for-the-source');
    await store.put(OTHER, 'for-the-other');
    expect(await store.get(WORKSPACE)).toBe('for-the-workspace');
    expect(await store.get(SOURCE)).toBe('for-the-source');
    expect((await store.values()).sort()).toEqual(
      ['for-the-other', 'for-the-source', 'for-the-workspace'].sort(),
    );
  });

  it("doesn't store the value itself, and seals the same value differently each time", async () => {
    await store.put(WORKSPACE, SECRET);
    await store.put(OTHER, SECRET);
    const rows = await storedRows();
    expect(JSON.stringify(rows)).not.toContain(SECRET);
    expect(JSON.stringify(rows)).not.toContain(Buffer.from(SECRET).toString('base64'));
    expect(rows[0]!.sealed).not.toBe(rows[1]!.sealed);
  });

  it("can't open a sealed value moved to another owner", async () => {
    await store.put(WORKSPACE, SECRET);
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    await client.query('update secret set owner_id = $1', [
      (OTHER as { workspaceId: string }).workspaceId,
    ]);
    await client.end();
    await expect(store.get(OTHER)).rejects.toBeInstanceOf(SecretsNotConfiguredError);
    expect(await store.values()).toEqual([]);
  });

  it('refuses to save on a server with no secret key, and lists nothing', async () => {
    await store.put(WORKSPACE, SECRET);
    const keyless = await createTestApp({ secretKey: null });
    try {
      const empty = keyless.app.get(SecretStore);
      expect(empty.isConfigured()).toBe(false);
      await expect(empty.put(OTHER, SECRET)).rejects.toBeInstanceOf(SecretsNotConfiguredError);
      await expect(empty.get(WORKSPACE)).rejects.toBeInstanceOf(SecretsNotConfiguredError);
      expect(await empty.values()).toEqual([]);
      expect(await empty.get(OTHER)).toBeNull();
    } finally {
      await keyless.close();
    }
  });

  it("can't open a value sealed with another key", async () => {
    await store.put(WORKSPACE, SECRET);
    const rekeyed = await createTestApp({ secretKey: Buffer.alloc(32, 9).toString('hex') });
    try {
      const other = rekeyed.app.get(SecretStore);
      await expect(other.get(WORKSPACE)).rejects.toBeInstanceOf(SecretsNotConfiguredError);
      expect(await other.values()).toEqual([]);
    } finally {
      await rekeyed.close();
    }
  });

  it('stops the server for a key of the wrong size', async () => {
    await expect(createTestApp({ secretKey: 'too-short' })).rejects.toThrow('SLOP_SECRET_KEY');
    expect(PgSecretStore).toBeDefined();
  });
});
