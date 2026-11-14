import { homedir } from 'node:os';
import { join } from 'node:path';

export type JwtVerification = { kind: 'jwks'; url: string } | { kind: 'secret'; secret: string };

/** Server configuration. This class is also the Nest injection token. */
export class AppConfig {
  databaseUrl!: string;
  jwt!: JwtVerification;
  jwtAudience!: string;
  /** Holds worktrees; kept outside any linked clone. */
  dataDir!: string;
  githubApiUrl!: string;
  /** The base address git pushes to; a repo is at `<base>/<owner>/<repo>.git`. */
  githubGitUrl!: string;
  /** Seals stored credentials (ADR-0004). Null means none can be saved. */
  secretKey!: string | null;
  /** True when the retired `GITHUB_TOKEN` setting is still set, so startup can say it's ignored. */
  githubTokenIgnored!: boolean;
  /** How long fetching a session's base may take before the session starts without it. */
  fetchTimeoutMs!: number;
  /** Overrides the host's ssh config when resolving aliases; null uses the host's. */
  sshConfigFile!: string | null;
  /** How often the status stream sends a heartbeat comment. */
  heartbeatMs!: number;
  /** How long a stop request waits for the round to end before answering with the session as it is. */
  stopGraceMs!: number;
  host!: string;
  port!: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const supabaseUrl = env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    jwt: env.SUPABASE_JWT_SECRET
      ? { kind: 'secret', secret: env.SUPABASE_JWT_SECRET }
      : { kind: 'jwks', url: `${supabaseUrl}/auth/v1/.well-known/jwks.json` },
    jwtAudience: env.SUPABASE_JWT_AUDIENCE ?? 'authenticated',
    dataDir: env.SLOP_DATA_DIR ?? join(homedir(), '.slop-control'),
    githubApiUrl: env.GITHUB_API_URL ?? 'https://api.github.com',
    githubGitUrl: env.GITHUB_GIT_URL ?? 'https://github.com',
    secretKey: env.SLOP_SECRET_KEY?.trim() || null,
    githubTokenIgnored: Boolean(env.GITHUB_TOKEN),
    fetchTimeoutMs: 15_000,
    sshConfigFile: null,
    heartbeatMs: 30_000,
    stopGraceMs: 5000,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3000),
  };
}
