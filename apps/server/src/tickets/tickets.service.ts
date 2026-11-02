import { Injectable } from '@nestjs/common';
import type { LinkedRepo, Ticket, TicketPage, TicketQuery } from '@slop-control/shared';
import { ApiException, notFound } from '../common/api-exception';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  TicketNotFoundError,
  TrackerAdapterFactory,
  TrackerAuthError,
  TrackerUnavailableError,
} from './tracker';

/** Tickets are read live from the tracker and never stored (FR-4). */
@Injectable()
export class TicketsService {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly trackers: TrackerAdapterFactory,
  ) {}

  async list(workspaceId: string, linkedRepoId: string | undefined, query: TicketQuery): Promise<TicketPage> {
    await this.workspaces.get(workspaceId);
    if (!linkedRepoId) throw notFound('Linked repo not found.');
    const repo = await this.workspaces.getRepo(workspaceId, linkedRepoId);
    return withTrackerErrors(() => this.trackers.forRepo(repo).list(query));
  }

  async get(workspaceId: string, key: string): Promise<Ticket> {
    await this.workspaces.get(workspaceId);
    const repos = await this.workspaces.listRepos(workspaceId);
    const repo = repoForKey(repos, key);
    if (!repo) throw notFound(`No linked repo holds ticket ${key}.`);
    return this.read(repo, key);
  }

  read(repo: LinkedRepo, key: string): Promise<Ticket> {
    return withTrackerErrors(() => this.trackers.forRepo(repo).get(key));
  }
}

/** A Sprint 1 ticket key is `owner/repo#number`, so it names its own repo. */
export function repoForKey(repos: LinkedRepo[], key: string): LinkedRepo | null {
  return repos.find((repo) => key.startsWith(`${repo.githubOwner}/${repo.githubRepo}#`)) ?? null;
}

async function withTrackerErrors<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof TicketNotFoundError) throw notFound(error.message);
    if (error instanceof TrackerAuthError) {
      throw new ApiException(502, 'TRACKER_AUTH_FAILED', error.message);
    }
    if (error instanceof TrackerUnavailableError) {
      throw new ApiException(502, 'TRACKER_UNAVAILABLE', error.message);
    }
    throw error;
  }
}
