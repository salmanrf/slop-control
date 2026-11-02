const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322';

export const TEST_DATABASE_NAME = 'slop_control_test';
export const ADMIN_DATABASE_URL = process.env.TEST_DATABASE_ADMIN_URL ?? `${LOCAL_DB}/postgres`;
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `${LOCAL_DB}/${TEST_DATABASE_NAME}`;
export const TEST_JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-hs256';
export const CANARY_GITHUB_TOKEN = 'ghp_CANARY_never_leak_this_token';
