import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { AppConfig } from '../config';

const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === UNIQUE_VIOLATION;
}

/** The server's only route to Postgres; the browser never talks to it directly. */
@Injectable()
export class Database implements OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(config: AppConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl });
  }

  query<Row extends QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(text, values);
  }

  /** Runs after every `onModuleDestroy`, so sessions can still save while shutting down. */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
