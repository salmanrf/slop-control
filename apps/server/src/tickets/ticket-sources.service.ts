import { Injectable } from '@nestjs/common';
import type { TicketSource } from '@slop-control/shared';
import { ApiException, notFound, validationFailed } from '../common/api-exception';
import { isUniqueViolation } from '../db/database';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { BuiltInTracker } from './built-in-tracker';
import { TicketSourceStore, githubScopeKey } from './ticket-source-store';
import { TrackerAdapter, TrackerAdapterFactory, withTrackerErrors } from './tracker';

/** GitHub's own limits on owner and repo names, which also keeps them safe in a URL path. */
const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;

const NO_STORED_CREDENTIALS =
  "Stored source tokens aren't supported yet. GitHub Issues sources use the server's GITHUB_TOKEN.";

interface GithubConnect {
  owner: string;
  repo: string;
  defaultLinkedRepoId: string | undefined;
}

/** Connects, updates, and disconnects ticket sources, and resolves a source to its adapter. */
@Injectable()
export class TicketSourcesService {
  constructor(
    private readonly store: TicketSourceStore,
    private readonly workspaces: WorkspacesService,
    private readonly trackers: TrackerAdapterFactory,
    private readonly builtIn: BuiltInTracker,
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
   * Verifies and saves a source, restoring the existing row if the scope was disconnected.
   */
  async connect(workspaceId: string, body: unknown): Promise<TicketSource> {
    await this.workspaces.get(workspaceId);
    const input = parseConnect(body);
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
      defaultLinkedRepoId: null,
      canCreateTickets: false,
      disconnectedAt: null,
      createdAt: '',
    };
    await withTrackerErrors(() => this.trackers.forConnected(candidate, null).verify());

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
    return this.get(workspaceId, sourceId);
  }

  /**
   * @params workspaceId: the workspace; sourceId: the source; body: the new default repo
   * @return the updated source, or throws an ApiException listed under the update endpoint
   * Changes the default repo.
   */
  async update(workspaceId: string, sourceId: string, body: unknown): Promise<TicketSource> {
    const source = await this.get(workspaceId, sourceId);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw validationFailed('Send the fields to change.');
    }
    const { token, defaultLinkedRepoId } = body as Record<string, unknown>;
    if (token !== undefined) throw validationFailed(NO_STORED_CREDENTIALS);
    if (
      defaultLinkedRepoId !== undefined &&
      defaultLinkedRepoId !== null &&
      typeof defaultLinkedRepoId !== 'string'
    ) {
      throw validationFailed('The default repo must be a linked repo ID or null.');
    }
    if (source.type === 'built_in') throw builtInFixed();
    if (source.disconnectedAt !== null) throw sourceDisconnected(source);

    if (defaultLinkedRepoId !== undefined) {
      if (defaultLinkedRepoId !== null) {
        await this.workspaces.getRepo(workspaceId, defaultLinkedRepoId);
      }
      await this.store.setDefaultRepo(sourceId, defaultLinkedRepoId);
    }
    return this.get(workspaceId, sourceId);
  }

  /**
   * @params workspaceId: the workspace; sourceId: the source
   * @return the disconnected source, or throws BUILT_IN_SOURCE_FIXED for the built-in tracker
   * Marks the source disconnected; safe to repeat.
   */
  async disconnect(workspaceId: string, sourceId: string): Promise<TicketSource> {
    const source = await this.get(workspaceId, sourceId);
    if (source.type === 'built_in') throw builtInFixed();
    await this.store.disconnect(sourceId);
    return this.get(workspaceId, sourceId);
  }

  /**
   * @params source: any source of the workspace
   * @return its adapter, or throws SOURCE_DISCONNECTED if it is disconnected
   * Resolves a source to the built-in tracker or a connected adapter.
   */
  adapterFor(source: TicketSource): TrackerAdapter {
    if (source.disconnectedAt !== null) throw sourceDisconnected(source);
    return source.type === 'built_in'
      ? this.builtIn.adapterFor(source)
      : this.trackers.forConnected(source, null);
  }
}

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
  if (token !== undefined) throw validationFailed(NO_STORED_CREDENTIALS);
  if (typeof githubOwner !== 'string' || !GITHUB_NAME.test(githubOwner.trim())) {
    throw validationFailed('A GitHub Issues source needs the repo owner.');
  }
  if (typeof githubRepo !== 'string' || !GITHUB_NAME.test(githubRepo.trim())) {
    throw validationFailed('A GitHub Issues source needs the repo name.');
  }
  if (defaultLinkedRepoId !== undefined && typeof defaultLinkedRepoId !== 'string') {
    throw validationFailed('The default repo must be a linked repo ID.');
  }
  return { owner: githubOwner.trim(), repo: githubRepo.trim(), defaultLinkedRepoId };
}
