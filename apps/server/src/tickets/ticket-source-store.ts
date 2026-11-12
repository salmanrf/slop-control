import { Injectable, Module } from '@nestjs/common';
import type { CredentialState, TicketSource, TicketSourceType } from '@slop-control/shared';
import { isUuid } from '../common/uuid';
import { Database, type Queryable } from '../db/database';

interface TicketSourceRow {
  id: string;
  workspace_id: string;
  type: TicketSourceType;
  github_owner: string | null;
  github_repo: string | null;
  default_linked_repo_id: string | null;
  credential_state: CredentialState | null;
  credential_login: string | null;
  credential_message: string | null;
  credential_checked_at: Date | null;
  can_create_tickets: boolean;
  disconnected_at: Date | null;
  created_at: Date;
}

export const BUILT_IN_SCOPE_KEY = 'built_in';

export const githubScopeKey = (owner: string, repo: string) =>
  `github:${owner.toLowerCase()}/${repo.toLowerCase()}`;

/** The built-in tracker takes new tickets only while no other source is connected (FR-6g). */
const SELECT_SOURCE = `
  select s.*,
         (s.type = 'built_in' and not exists (
            select 1 from ticket_source o
            where o.workspace_id = s.workspace_id and o.type <> 'built_in'
              and o.disconnected_at is null)) as can_create_tickets
  from ticket_source s`;

/** Depends on nothing but the database, so the workspaces module can create a built-in source through it. */
@Injectable()
export class TicketSourceStore {
  constructor(private readonly db: Database) {}

  /** Includes disconnected sources. The built-in tracker comes first, then the oldest. */
  async list(workspaceId: string): Promise<TicketSource[]> {
    const { rows } = await this.db.query<TicketSourceRow>(
      `${SELECT_SOURCE} where s.workspace_id = $1
       order by (s.type = 'built_in') desc, s.created_at, s.id`,
      [workspaceId],
    );
    return rows.map(toTicketSource);
  }

  async find(workspaceId: string, sourceId: string): Promise<TicketSource | null> {
    if (!isUuid(workspaceId) || !isUuid(sourceId)) return null;
    const { rows } = await this.db.query<TicketSourceRow>(
      `${SELECT_SOURCE} where s.workspace_id = $1 and s.id = $2`,
      [workspaceId, sourceId],
    );
    return rows[0] ? toTicketSource(rows[0]) : null;
  }

  async findByScope(workspaceId: string, scopeKey: string): Promise<TicketSource | null> {
    const { rows } = await this.db.query<TicketSourceRow>(
      `${SELECT_SOURCE} where s.workspace_id = $1 and s.scope_key = $2`,
      [workspaceId, scopeKey],
    );
    return rows[0] ? toTicketSource(rows[0]) : null;
  }

  async createBuiltIn(workspaceId: string, db: Queryable = this.db): Promise<void> {
    await db.query(
      `insert into ticket_source (workspace_id, type, scope_key) values ($1, 'built_in', $2)`,
      [workspaceId, BUILT_IN_SCOPE_KEY],
    );
  }

  /** Throws a unique violation if the scope is already there. */
  async insertGithub(
    workspaceId: string,
    owner: string,
    repo: string,
    defaultLinkedRepoId: string | null,
  ): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `insert into ticket_source
         (workspace_id, type, scope_key, github_owner, github_repo, default_linked_repo_id)
       values ($1, 'github_issues', $2, $3, $4, $5) returning id`,
      [workspaceId, githubScopeKey(owner, repo), owner, repo, defaultLinkedRepoId],
    );
    return rows[0]!.id;
  }

  /** Connects a disconnected source again. False if it was connected in the meantime. */
  async reconnect(sourceId: string, defaultLinkedRepoId: string | undefined): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `update ticket_source
       set disconnected_at = null,
           default_linked_repo_id = coalesce($2, default_linked_repo_id)
       where id = $1 and disconnected_at is not null`,
      [sourceId, defaultLinkedRepoId ?? null],
    );
    return rowCount === 1;
  }

  async setDefaultRepo(sourceId: string, linkedRepoId: string | null): Promise<void> {
    await this.db.query('update ticket_source set default_linked_repo_id = $2 where id = $1', [
      sourceId,
      linkedRepoId,
    ]);
  }

  /**
   * Keeps the first disconnect time, so repeating the call changes nothing. The credential's
   * record goes with it, since the caller erases the credential itself.
   */
  async disconnect(sourceId: string): Promise<void> {
    await this.db.query(
      `update ticket_source
       set disconnected_at = coalesce(disconnected_at, now()), credential_state = null,
           credential_login = null, credential_message = null, credential_checked_at = null
       where id = $1`,
      [sourceId],
    );
  }

  /** Records how a credential's last check or use went. A null state means none is stored. */
  async setCredentialState(
    sourceId: string,
    state: CredentialState | null,
    message: string | null,
  ): Promise<void> {
    await this.db.query(
      `update ticket_source
       set credential_state = $2, credential_message = $3,
           credential_checked_at = case when $2::text is null then null else now() end
       where id = $1`,
      [sourceId, state, message],
    );
  }

  /** Like `setCredentialState`, but leaves a source with no credential as it is. */
  async recordCredentialUse(
    sourceId: string,
    state: CredentialState,
    message: string | null,
  ): Promise<void> {
    await this.db.query(
      `update ticket_source
       set credential_state = $2, credential_message = $3, credential_checked_at = now()
       where id = $1 and credential_state is not null`,
      [sourceId, state, message],
    );
  }
}

@Module({ providers: [TicketSourceStore], exports: [TicketSourceStore] })
export class TicketSourceStoreModule {}

function toTicketSource(row: TicketSourceRow): TicketSource {
  const github =
    row.type === 'github_issues' && row.github_owner !== null && row.github_repo !== null
      ? { githubOwner: row.github_owner, githubRepo: row.github_repo }
      : null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    label: github ? `${github.githubOwner}/${github.githubRepo}` : 'Built-in',
    scope: github,
    hasCredential: row.credential_state !== null,
    credential: {
      isSet: row.credential_state !== null,
      state: row.credential_state,
      login: row.credential_login,
      message: row.credential_message,
      checkedAt: row.credential_checked_at?.toISOString() ?? null,
    },
    defaultLinkedRepoId: row.default_linked_repo_id,
    canCreateTickets: row.can_create_tickets,
    disconnectedAt: row.disconnected_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}
