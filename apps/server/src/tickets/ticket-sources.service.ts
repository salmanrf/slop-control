import { Injectable } from '@nestjs/common';
import type { CredentialState, TicketSource } from '@slop-control/shared';
import {
  ApiException,
  notFound,
  secretsNotConfigured,
  validationFailed,
} from '../common/api-exception';
import { Redactor } from '../common/redactor';
import { SecretStore, SecretsNotConfiguredError, type SecretOwner } from '../common/secret-store';
import { isUniqueViolation } from '../db/database';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { BuiltInTracker } from './built-in-tracker';
import { TicketSourceStore, githubScopeKey } from './ticket-source-store';
import {
  TrackerAdapter,
  TrackerAdapterFactory,
  TrackerAuthError,
  TrackerUnavailableError,
  withTrackerErrors,
} from './tracker';

/** GitHub's own limits on owner and repo names, which also keeps them safe in a URL path. */
const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;

interface GithubConnect {
  owner: string;
  repo: string;
  defaultLinkedRepoId: string | undefined;
  token: string | undefined;
}

/** Connects, updates, and disconnects ticket sources, and resolves a source to its adapter. */
@Injectable()
export class TicketSourcesService {
  constructor(
    private readonly store: TicketSourceStore,
    private readonly workspaces: WorkspacesService,
    private readonly trackers: TrackerAdapterFactory,
    private readonly builtIn: BuiltInTracker,
    private readonly secrets: SecretStore,
    private readonly redactor: Redactor,
  ) {}

  /**
   * @params workspaceId: the workspace
   * @return its sources, including the built-in tracker and disconnected sources
   * Lists a workspace's ticket sources.
   */
  async list(workspaceId: string): Promise<TicketSource[]> {
    await this.workspaces.get(workspaceId);
    return this.store.list(workspaceId);
  }

  /** @return the source, or throws NOT_FOUND, which also covers another workspace's source */
  async get(workspaceId: string, sourceId: string): Promise<TicketSource> {
    await this.workspaces.get(workspaceId);
    const source = await this.store.find(workspaceId, sourceId);
    if (!source) throw notFound('Ticket source not found.');
    return source;
  }

  /**
   * @params workspaceId: the workspace; body: the source's scope
   * @return the connected source, or throws an ApiException listed under the connect endpoint
   * Verifies and saves a source, restoring the existing row if the scope was disconnected. A token is checked before it's stored.
   */
  async connect(workspaceId: string, body: unknown): Promise<TicketSource> {
    await this.workspaces.get(workspaceId);
    const input = parseConnect(body);
    if (input.token !== undefined) this.requireSecrets();
    if (input.defaultLinkedRepoId !== undefined) {
      await this.workspaces.getRepo(workspaceId, input.defaultLinkedRepoId);
    }

    const alreadyConnected = new ApiException(
      409,
      'SOURCE_ALREADY_CONNECTED',
      `${input.owner}/${input.repo} is already connected to this workspace.`,
    );
    const existing = await this.store.findByScope(
      workspaceId,
      githubScopeKey(input.owner, input.repo),
    );
    if (existing && existing.disconnectedAt === null) throw alreadyConnected;

    const candidate: TicketSource = existing ?? {
      id: '',
      workspaceId,
      type: 'github_issues',
      label: `${input.owner}/${input.repo}`,
      scope: { githubOwner: input.owner, githubRepo: input.repo },
      hasCredential: false,
      credential: NO_CREDENTIAL,
      defaultLinkedRepoId: null,
      canCreateTickets: false,
      disconnectedAt: null,
      createdAt: '',
    };
    await withTrackerErrors(() =>
      this.trackers.forConnected(candidate, input.token ?? null).verify(),
    );

    let sourceId: string;
    if (existing) {
      if (!(await this.store.reconnect(existing.id, input.defaultLinkedRepoId))) {
        throw alreadyConnected;
      }
      sourceId = existing.id;
    } else {
      try {
        sourceId = await this.store.insertGithub(
          workspaceId,
          input.owner,
          input.repo,
          input.defaultLinkedRepoId ?? null,
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw alreadyConnected;
        throw error;
      }
    }
    if (input.token !== undefined) await this.storeToken(sourceId, input.token);
    return this.get(workspaceId, sourceId);
  }

  /**
   * @params workspaceId: the workspace; sourceId: the source; body: the new token or default repo
   * @return the updated source, or throws an ApiException listed under the update endpoint
   * Replaces or removes the stored credential, and changes the default repo. A new token is checked first, and a rejected one leaves the earlier credential in place.
   */
  async update(workspaceId: string, sourceId: string, body: unknown): Promise<TicketSource> {
    const source = await this.get(workspaceId, sourceId);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw validationFailed('Send the fields to change.');
    }
    const { token, defaultLinkedRepoId } = body as Record<string, unknown>;
    if (token !== undefined && token !== null && (typeof token !== 'string' || !token.trim())) {
      throw validationFailed('The token must be text, or null to remove it.');
    }
    if (
      defaultLinkedRepoId !== undefined &&
      defaultLinkedRepoId !== null &&
      typeof defaultLinkedRepoId !== 'string'
    ) {
      throw validationFailed('The default repo must be a linked repo ID or null.');
    }
    if (source.type === 'built_in') throw builtInFixed();
    if (source.disconnectedAt !== null) throw sourceDisconnected(source);

    // Everything that can refuse comes first, so a refused update changes nothing.
    if (defaultLinkedRepoId !== undefined && defaultLinkedRepoId !== null) {
      await this.workspaces.getRepo(workspaceId, defaultLinkedRepoId);
    }
    const newToken = typeof token === 'string' ? token.trim() : null;
    if (newToken !== null) {
      this.requireSecrets();
      await withTrackerErrors(() => this.trackers.forConnected(source, newToken).verify());
    }

    if (defaultLinkedRepoId !== undefined) {
      await this.store.setDefaultRepo(sourceId, defaultLinkedRepoId);
    }
    if (token === null) {
      await this.secrets.erase(owner(sourceId));
      await this.store.setCredentialState(sourceId, null, null);
    } else if (newToken !== null) {
      await this.storeToken(sourceId, newToken);
    }
    return this.get(workspaceId, sourceId);
  }

  /**
   * @params workspaceId: the workspace; sourceId: a connected source with a stored credential
   * @return the source with its credential's state after asking the tracker, or throws an ApiException listed under the credential-check endpoint
   * Checks a source's stored credential again and saves the result.
   */
  async checkCredential(workspaceId: string, sourceId: string): Promise<TicketSource> {
    const source = await this.get(workspaceId, sourceId);
    if (source.disconnectedAt !== null) throw sourceDisconnected(source);
    const token = source.credential.isSet ? await this.readToken(sourceId) : null;
    if (token === null) {
      throw new ApiException(
        409,
        'CREDENTIAL_NOT_SET',
        `${source.label} has no stored credential. Add one first.`,
      );
    }
    try {
      await this.trackers.forConnected(source, token).verify();
      await this.store.setCredentialState(sourceId, 'ok', null);
    } catch (error) {
      if (error instanceof TrackerAuthError) {
        await this.recordCredentialUse(sourceId, 'auth_failed', error.message);
      } else if (error instanceof TrackerUnavailableError) {
        await this.recordCredentialUse(sourceId, 'unavailable', error.message);
      } else {
        throw error;
      }
    }
    return this.get(workspaceId, sourceId);
  }

  /**
   * @params sourceId: the source; state: what a read or a dispatch just learned; message: why, if it failed
   * @return nothing
   * Records a source credential's state after it was used. Does nothing for a source with no credential.
   */
  async recordCredentialUse(
    sourceId: string,
    state: CredentialState,
    message: string | null,
  ): Promise<void> {
    await this.store.recordCredentialUse(
      sourceId,
      state,
      message === null ? null : this.redactor.redact(message),
    );
  }

  /**
   * @params workspaceId: the workspace; sourceId: the source
   * @return the disconnected source, or throws BUILT_IN_SOURCE_FIXED for the built-in tracker
   * Marks the source disconnected and erases its credential, so reconnecting needs the token again. Safe to repeat.
   */
  async disconnect(workspaceId: string, sourceId: string): Promise<TicketSource> {
    const source = await this.get(workspaceId, sourceId);
    if (source.type === 'built_in') throw builtInFixed();
    await this.secrets.erase(owner(sourceId));
    await this.store.disconnect(sourceId);
    return this.get(workspaceId, sourceId);
  }

  /**
   * @params source: any source of the workspace
   * @return its adapter, built with the source's stored credential if it has one; or throws SOURCE_DISCONNECTED if it is disconnected
   * Resolves a source to the built-in tracker or a connected adapter.
   */
  async adapterFor(source: TicketSource): Promise<TrackerAdapter> {
    if (source.disconnectedAt !== null) throw sourceDisconnected(source);
    if (source.type === 'built_in') return this.builtIn.adapterFor(source);
    // A credential that can't be opened reads like none: public repos still list.
    const token = source.credential.isSet
      ? await this.readToken(source.id).catch(() => null)
      : null;
    return this.trackers.forConnected(source, token);
  }

  private requireSecrets(): void {
    if (!this.secrets.isConfigured()) throw secretsNotConfigured();
  }

  private async readToken(sourceId: string): Promise<string | null> {
    try {
      return await this.secrets.get(owner(sourceId));
    } catch (error) {
      if (error instanceof SecretsNotConfiguredError) throw secretsNotConfigured(error.message);
      throw error;
    }
  }

  private async storeToken(sourceId: string, token: string): Promise<void> {
    await this.secrets.put(owner(sourceId), token);
    await this.store.setCredentialState(sourceId, 'ok', null);
  }
}

const NO_CREDENTIAL: TicketSource['credential'] = {
  isSet: false,
  state: null,
  login: null,
  message: null,
  checkedAt: null,
};

const owner = (sourceId: string): SecretOwner => ({ kind: 'ticket_source', sourceId });

export function sourceDisconnected(source: TicketSource): ApiException {
  return new ApiException(
    409,
    'SOURCE_DISCONNECTED',
    `${source.label} is disconnected. Reconnect it to read its tickets or start a session.`,
  );
}

function builtInFixed(): ApiException {
  return new ApiException(
    409,
    'BUILT_IN_SOURCE_FIXED',
    "The built-in tracker can't be changed or disconnected.",
  );
}

function parseConnect(body: unknown): GithubConnect {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw validationFailed('Send the source to connect.');
  }
  const { type, githubOwner, githubRepo, token, defaultLinkedRepoId } = body as Record<
    string,
    unknown
  >;
  if (type === 'jira') throw validationFailed("Jira sources aren't supported yet.");
  if (type !== 'github_issues') throw validationFailed('Choose a source type: github_issues.');
  if (token !== undefined && (typeof token !== 'string' || token.trim().length === 0)) {
    throw validationFailed('The token must be text.');
  }
  if (typeof githubOwner !== 'string' || !GITHUB_NAME.test(githubOwner.trim())) {
    throw validationFailed('A GitHub Issues source needs the repo owner.');
  }
  if (typeof githubRepo !== 'string' || !GITHUB_NAME.test(githubRepo.trim())) {
    throw validationFailed('A GitHub Issues source needs the repo name.');
  }
  if (defaultLinkedRepoId !== undefined && typeof defaultLinkedRepoId !== 'string') {
    throw validationFailed('The default repo must be a linked repo ID.');
  }
  return {
    owner: githubOwner.trim(),
    repo: githubRepo.trim(),
    defaultLinkedRepoId,
    token: typeof token === 'string' ? token.trim() : undefined,
  };
}
