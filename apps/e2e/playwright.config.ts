import { defineConfig } from '@playwright/test';
import {
  API_URL,
  DATA_DIR,
  GITHUB_STUB_URL,
  PORTS,
  REMOTES_DIR,
  REPO_ROOT,
  SECRET_KEY,
  WEB_URL,
  supabaseEnv,
} from './support/env';

const supabase = supabaseEnv();

/**
 * The opt-in browser run (S2-12): the real web app, Nest server, Supabase Auth, Postgres, and git,
 * with Claude Code replaced by a scripted runtime, the GitHub API by a local stub, and GitHub's
 * git remotes by local bare repos (S3-11). It costs no quota and isn't part of `npm test`. Run it
 * with `npm run test:e2e`.
 */
export default defineConfig({
  testDir: './tests',
  // The steps follow the demo script in order and share one workspace. Files run in name order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './support/global-setup.ts',
  globalTeardown: './support/global-teardown.ts',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node apps/e2e/support/github-stub.mjs',
      cwd: REPO_ROOT,
      url: `${GITHUB_STUB_URL}/__requests`,
      reuseExistingServer: false,
      env: { GITHUB_STUB_PORT: String(PORTS.github) },
    },
    {
      command:
        'node apps/e2e/support/prepare-db.mjs && npm run build:e2e -w @slop-control/server && npm run start:e2e -w @slop-control/server',
      cwd: REPO_ROOT,
      // Any answer means it's up; without a token this one is a 401.
      url: `${API_URL}/workspaces`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        HOST: '127.0.0.1',
        PORT: String(PORTS.api),
        DATABASE_URL: supabase.databaseUrl,
        SUPABASE_URL: supabase.url,
        GITHUB_API_URL: GITHUB_STUB_URL,
        // Pushes go to local bare repos under this folder, which need no credential.
        GITHUB_GIT_URL: REMOTES_DIR,
        SLOP_SECRET_KEY: SECRET_KEY,
        // The clones name github.com as their origin, and the server fetches a session's base
        // from it. Neither setting lets git leave this machine: the fetch fails at once, and the
        // session starts from the clone's own ref with a warning.
        GIT_ALLOW_PROTOCOL: 'file',
        GIT_SSH_COMMAND: '/usr/bin/false',
        SLOP_DATA_DIR: DATA_DIR,
        E2E_STEP_MS: '400',
      },
    },
    {
      command: 'npm run dev -w @slop-control/web',
      cwd: REPO_ROOT,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        SLOP_WEB_PORT: String(PORTS.web),
        SLOP_API_URL: API_URL,
        VITE_SUPABASE_URL: supabase.url,
        VITE_SUPABASE_ANON_KEY: supabase.anonKey,
      },
    },
  ],
});
