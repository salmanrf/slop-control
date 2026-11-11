import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AppConfig } from '../../src/config';
import { CANARY_GITHUB_TOKEN, TEST_DATABASE_URL, TEST_JWT_SECRET } from './test-env';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  /** A supertest agent call with a valid token already attached. */
  api: {
    get(path: string): request.Test;
    post(path: string): request.Test;
    patch(path: string): request.Test;
    delete(path: string): request.Test;
  };
  dataDir: string;
  close(): Promise<void>;
}

export interface TestAppOptions {
  /** Nest providers to replace, as [token, instance] pairs. */
  overrides?: [unknown, unknown][];
  dataDir?: string;
  /** Another database than the shared test one, e.g. one a suite migrates itself. */
  databaseUrl?: string;
  jwt?: AppConfig['jwt'];
  sshConfigFile?: string;
  heartbeatMs?: number;
  /** How long a stop request waits for the round to end. */
  stopGraceMs?: number;
}

export async function signToken(
  claims: { audience?: string; expiresIn?: string; secret?: string } = {},
): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('test-user')
    .setAudience(claims.audience ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(claims.expiresIn ?? '1h')
    .sign(new TextEncoder().encode(claims.secret ?? TEST_JWT_SECRET));
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'slop-data-'));
  const config: AppConfig = {
    databaseUrl: options.databaseUrl ?? TEST_DATABASE_URL,
    jwt: options.jwt ?? { kind: 'secret', secret: TEST_JWT_SECRET },
    jwtAudience: 'authenticated',
    dataDir,
    githubToken: CANARY_GITHUB_TOKEN,
    githubApiUrl: 'http://127.0.0.1:9',
    sshConfigFile: options.sshConfigFile ?? null,
    heartbeatMs: options.heartbeatMs ?? 30_000,
    stopGraceMs: options.stopGraceMs ?? 5000,
    host: '127.0.0.1',
    port: 0,
  };

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfig)
    .useValue(config);
  for (const [token, value] of options.overrides ?? []) {
    builder = builder.overrideProvider(token).useValue(value);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  const token = await signToken();
  const http = request(app.getHttpServer());
  const withAuth = (t: request.Test) => t.set('Authorization', `Bearer ${token}`);
  return {
    app,
    http,
    api: {
      get: (path) => withAuth(http.get(path)),
      post: (path) => withAuth(http.post(path)),
      patch: (path) => withAuth(http.patch(path)),
      delete: (path) => withAuth(http.delete(path)),
    },
    dataDir,
    close: () => app.close(),
  };
}

/** Empties every table between tests. Only setup and teardown touch the database directly. */
export async function resetDatabase(): Promise<void> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query(
    `truncate built_in_ticket_comment, built_in_ticket, session_artifact, session, phase_setup,
       ticket_source, linked_repo, workspace cascade`,
  );
  await client.end();
}
