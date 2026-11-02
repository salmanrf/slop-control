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
  githubToken!: string;
  githubApiUrl!: string;
  /** Overrides the host's ssh config when resolving aliases; null uses the host's. */
  sshConfigFile!: string | null;
  /** How often the status stream sends a heartbeat comment. */
  heartbeatMs!: number;
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
    githubToken: env.GITHUB_TOKEN ?? '',
    githubApiUrl: env.GITHUB_API_URL ?? 'https://api.github.com',
    sshConfigFile: null,
    heartbeatMs: 30_000,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3000),
  };
}
