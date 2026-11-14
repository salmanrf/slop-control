import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type {
  CredentialState,
  LinkedRepo,
  RepoPushAccess,
  WorkspaceCredentialStatus,
} from '@slop-control/shared';
import { ApiException, secretsNotConfigured, validationFailed } from '../common/api-exception';
import { Redactor } from '../common/redactor';
import { SecretStore, SecretsNotConfiguredError, type SecretOwner } from '../common/secret-store';
import { AppConfig } from '../config';
import { Database } from '../db/database';
import {
  RepoHost,
  RepoHostAccess,
  RepoHostAuthError,
  RepoHostUnavailableError,
} from '../repo-host/repo-host';
import { WorkspacesService } from '../workspaces/workspaces.service';

interface CredentialRow {
  github_credential_state: CredentialState | null;
  github_credential_login: string | null;
  github_credential_message: string | null;
  github_credential_checked_at: Date | null;
  github_push_access: RepoPushAccess[];
}

/** The workspace's GitHub credential, used for pushing and opening PRs in its linked repos. */
@Injectable()
export class CredentialsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Credentials');

  constructor(
    private readonly db: Database,
    private readonly secrets: SecretStore,
    private readonly host: RepoHost,
    private readonly workspaces: WorkspacesService,
    private readonly redactor: Redactor,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.githubTokenIgnored) {
      this.logger.warn(
        'GITHUB_TOKEN is set but no longer used. Add a credential to each GitHub Issues source on its Sources page, and to the workspace for pull requests.',
      );
    }
  }

  /**
   * @params workspaceId: the workspace
   * @return its GitHub credential's status as last checked, or throws NOT_FOUND
   * Reads the status without asking GitHub.
   */
  async status(workspaceId: string): Promise<WorkspaceCredentialStatus> {
    const repos = await this.workspaces.listRepos(workspaceId);
    const { rows } = await this.db.query<CredentialRow>(
      `select github_credential_state, github_credential_login, github_credential_message,
              github_credential_checked_at, github_push_access
       from workspace where id = $1`,
      [workspaceId],
    );
    const row = rows[0]!;
    const isSet = row.github_credential_state !== null;
    return {
      isSet,
      state: row.github_credential_state,
      login: row.github_credential_login,
      message: row.github_credential_message,
      checkedAt: row.github_credential_checked_at?.toISOString() ?? null,
      // A repo linked since the last check hasn't been asked about, so it isn't claimed.
      repos: isSet
        ? repos.map((repo) => ({
            linkedRepoId: repo.id,
            canPush:
              row.github_push_access.find((entry) => entry.linkedRepoId === repo.id)?.canPush ??
              false,
          }))
        : [],
    };
  }

  /**
   * @params workspaceId: the workspace; body: the token
   * @return the new status, or throws an ApiException listed under the PUT endpoint
   * Checks the token against GitHub and the workspace's linked repos, then stores it and adds it to the Redactor.
   */
  async set(workspaceId: string, body: unknown): Promise<WorkspaceCredentialStatus> {
    const repos = await this.workspaces.listRepos(workspaceId);
    const token = (body as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw validationFailed('A credential needs a token.');
    }
    const trimmed = token.trim();
    if (!this.secrets.isConfigured()) throw secretsNotConfigured();

    let access: RepoHostAccess;
    try {
      access = await this.host.verify(trimmed, repos.map(toRef));
    } catch (error) {
      // A token that isn't stored isn't known to the Redactor, so it's taken out here.
      const message =
        error instanceof Error ? without(trimmed, this.redactor.redact(error.message)) : '';
      if (error instanceof RepoHostAuthError) {
        throw new ApiException(502, 'CREDENTIAL_REJECTED', message);
      }
      if (error instanceof RepoHostUnavailableError) {
        throw new ApiException(502, 'REPO_HOST_UNAVAILABLE', message);
      }
      throw error;
    }

    try {
      await this.secrets.put(this.owner(workspaceId), trimmed);
    } catch (error) {
      if (error instanceof SecretsNotConfiguredError) throw secretsNotConfigured();
      throw error;
    }
    await this.save(workspaceId, 'ok', null, access.login, pushAccess(repos, access));
    return this.status(workspaceId);
  }

  /**
   * @params workspaceId: the workspace
   * @return the status with nothing set, or throws NOT_FOUND
   * Erases the workspace's GitHub credential. Safe to repeat.
   */
  async remove(workspaceId: string): Promise<WorkspaceCredentialStatus> {
    await this.workspaces.get(workspaceId);
    await this.secrets.erase(this.owner(workspaceId));
    await this.db.query(
      `update workspace
       set github_credential_state = null, github_credential_login = null,
           github_credential_message = null, github_credential_checked_at = null,
           github_push_access = '[]'
       where id = $1`,
      [workspaceId],
    );
    return this.status(workspaceId);
  }

  /**
   * @params workspaceId: the workspace
   * @return the status after asking GitHub, or throws NOT_FOUND or CREDENTIAL_NOT_SET
   * Checks the stored credential again and saves the result.
   */
  async check(workspaceId: string): Promise<WorkspaceCredentialStatus> {
    const repos = await this.workspaces.listRepos(workspaceId);
    const token = await this.token(workspaceId);
    if (token === null) throw credentialNotSet();

    try {
      const access = await this.host.verify(token, repos.map(toRef));
      await this.save(workspaceId, 'ok', null, access.login, pushAccess(repos, access));
    } catch (error) {
      if (error instanceof RepoHostAuthError) {
        await this.recordUse(workspaceId, 'auth_failed', error.message);
      } else if (error instanceof RepoHostUnavailableError) {
        await this.recordUse(workspaceId, 'unavailable', error.message);
      } else {
        throw error;
      }
    }
    return this.status(workspaceId);
  }

  /**
   * @params workspaceId: the workspace; state: what a dispatch just learned; message: why, if it failed
   * @return nothing
   * Records a credential's state after it was used, so the dashboard shows a failure where it's fixed.
   */
  async recordUse(
    workspaceId: string,
    state: CredentialState,
    message: string | null,
  ): Promise<void> {
    await this.db.query(
      `update workspace
       set github_credential_state = $2, github_credential_message = $3,
           github_credential_checked_at = now()
       where id = $1 and github_credential_state is not null`,
      [workspaceId, state, message === null ? null : this.redactor.redact(message)],
    );
  }

  /**
   * @params workspaceId: the workspace
   * @return its stored token, or null if none is stored; throws SECRETS_NOT_CONFIGURED if it can't be opened
   * Reads the credential for a dispatch. The value must never be returned by the API or logged.
   */
  async token(workspaceId: string): Promise<string | null> {
    try {
      return await this.secrets.get(this.owner(workspaceId));
    } catch (error) {
      if (error instanceof SecretsNotConfiguredError) throw secretsNotConfigured(error.message);
      throw error;
    }
  }

  private owner(workspaceId: string): SecretOwner {
    return { kind: 'workspace_github', workspaceId };
  }

  private async save(
    workspaceId: string,
    state: CredentialState,
    message: string | null,
    login: string,
    access: RepoPushAccess[],
  ): Promise<void> {
    await this.db.query(
      `update workspace
       set github_credential_state = $2, github_credential_message = $3,
           github_credential_login = $4, github_push_access = $5,
           github_credential_checked_at = now()
       where id = $1`,
      [workspaceId, state, message, login, JSON.stringify(access)],
    );
  }
}

export function credentialNotSet(
  message = 'No GitHub credential is stored. Add one first.',
): ApiException {
  return new ApiException(409, 'CREDENTIAL_NOT_SET', message);
}

/** Takes a value that was never stored, so the Redactor doesn't know it, out of a message. */
export const without = (value: string, text: string) => text.split(value).join('[REDACTED]');

const toRef = (repo: LinkedRepo) => ({ owner: repo.githubOwner, repo: repo.githubRepo });

function pushAccess(repos: LinkedRepo[], access: RepoHostAccess): RepoPushAccess[] {
  return repos.map((repo) => ({
    linkedRepoId: repo.id,
    canPush:
      access.repos.find(
        (entry) =>
          entry.owner.toLowerCase() === repo.githubOwner.toLowerCase() &&
          entry.repo.toLowerCase() === repo.githubRepo.toLowerCase(),
      )?.canPush ?? false,
  }));
}
