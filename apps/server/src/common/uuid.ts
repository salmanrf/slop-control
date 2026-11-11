const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres rejects a malformed UUID with an error, so IDs from a URL are checked first. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
