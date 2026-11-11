import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { AppConfig } from '../config';

const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === UNIQUE_VIOLATION;
}

/** What a query needs: the pool, or one transaction's connection. */
export interface Queryable {
  query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
}

/** The server's only route to Postgres; the browser never talks to it directly. */
@Injectable()
export class Database implements Queryable, OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(config: AppConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl });
  }

  query<Row extends QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(text, values);
  }

  /**
   * @params work: queries to run on one connection
   * @return what `work` returns, once committed; rolls back and rethrows if it throws
   * Runs several statements as one change.
   */
  async transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work({
        query: <Row extends QueryResultRow>(text: string, values: unknown[] = []) =>
          client.query<Row>(text, values),
      });
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Runs after every `onModuleDestroy`, so sessions can still save while shutting down. */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
