import { Injectable, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfig } from '../config';
import { Database } from '../db/database';
import { Redactor } from './redactor';

export type SecretOwner =
  { kind: 'workspace_github'; workspaceId: string } | { kind: 'ticket_source'; sourceId: string };

/** The server has nowhere to keep secrets, e.g. no secret key is set. */
export class SecretsNotConfiguredError extends Error {}

/** Only this module knows where secrets live (ADR-0004). */
export abstract class SecretStore {
  /** Whether this server can keep secrets at all. */
  abstract isConfigured(): boolean;

  /**
   * @params owner: what the secret belongs to; value: the secret
   * @return nothing, or throws SecretsNotConfiguredError if the store can't keep secrets on this server
   * Saves a secret, replacing any earlier one for the same owner.
   */
  abstract put(owner: SecretOwner, value: string): Promise<void>;

  /**
   * @params owner: what the secret belongs to
   * @return the secret, or null if none is stored
   * Reads a secret for use inside the server. The value must never be returned by the API or logged.
   */
  abstract get(owner: SecretOwner): Promise<string | null>;

  /**
   * @params owner: what the secret belongs to
   * @return nothing
   * Erases a secret. Does nothing if none is stored.
   */
  abstract erase(owner: SecretOwner): Promise<void>;

  /**
   * @return every stored secret's value
   * Lists the values to hide, for the Redactor at startup.
   */
  abstract values(): Promise<string[]>;
}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Secrets sealed with AES-256-GCM in Postgres. The key comes from `SLOP_SECRET_KEY`, so a copy of
 * the database alone opens nothing. Each value is bound to its owner, so a row moved to another
 * owner doesn't open either.
 */
@Injectable()
export class PgSecretStore extends SecretStore implements OnModuleInit {
  private readonly key: Buffer | null;

  constructor(
    private readonly db: Database,
    private readonly redactor: Redactor,
    config: AppConfig,
  ) {
    super();
    this.key = config.secretKey === null ? null : parseKey(config.secretKey);
  }

  /** Every stored secret is hidden from logs and records from the first request on. */
  async onModuleInit(): Promise<void> {
    for (const value of await this.values()) this.redactor.add(value);
  }

  isConfigured(): boolean {
    return this.key !== null;
  }

  async put(owner: SecretOwner, value: string): Promise<void> {
    const key = this.requireKey();
    this.redactor.add(value);
    const [kind, id] = address(owner);
    await this.db.query(
      `insert into secret (owner_kind, owner_id, sealed) values ($1, $2, $3)
       on conflict (owner_kind, owner_id) do update set sealed = excluded.sealed, updated_at = now()`,
      [kind, id, seal(key, `${kind}:${id}`, value)],
    );
  }

  async get(owner: SecretOwner): Promise<string | null> {
    const [kind, id] = address(owner);
    const { rows } = await this.db.query<{ sealed: string }>(
      'select sealed from secret where owner_kind = $1 and owner_id = $2',
      [kind, id],
    );
    if (!rows[0]) return null;
    const value = open(this.requireKey(), `${kind}:${id}`, rows[0].sealed);
    if (value === null) {
      throw new SecretsNotConfiguredError(
        "A stored credential can't be opened with the server's current secret key. Save the credential again.",
      );
    }
    return value;
  }

  async erase(owner: SecretOwner): Promise<void> {
    const [kind, id] = address(owner);
    await this.db.query('delete from secret where owner_kind = $1 and owner_id = $2', [kind, id]);
  }

  /** A value sealed with another key can't be opened, so it can't be listed or leaked either. */
  async values(): Promise<string[]> {
    const key = this.key;
    if (!key) return [];
    const { rows } = await this.db.query<{ owner_kind: string; owner_id: string; sealed: string }>(
      'select owner_kind, owner_id, sealed from secret',
    );
    return rows.flatMap((row) => {
      const value = open(key, `${row.owner_kind}:${row.owner_id}`, row.sealed);
      return value === null ? [] : [value];
    });
  }

  private requireKey(): Buffer {
    if (!this.key) throw new SecretsNotConfiguredError('The server has no secret key.');
    return this.key;
  }
}

function address(owner: SecretOwner): [string, string] {
  return owner.kind === 'workspace_github'
    ? [owner.kind, owner.workspaceId]
    : [owner.kind, owner.sourceId];
}

/** Accepts 32 bytes as base64 or as 64 hex characters. A key of another size stops the server. */
function parseKey(raw: string): Buffer {
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      'SLOP_SECRET_KEY must be 32 bytes, as base64 or hex. Generate one with `openssl rand -base64 32`.',
    );
  }
  return key;
}

function seal(key: Buffer, owner: string, value: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(owner));
  const sealed = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64');
}

function open(key: Buffer, owner: string, stored: string): string | null {
  try {
    const raw = Buffer.from(stored, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(owner));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
