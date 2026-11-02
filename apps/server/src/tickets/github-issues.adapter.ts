import { Injectable } from '@nestjs/common';
import type {
  LinkedRepo,
  Ticket,
  TicketPage,
  TicketQuery,
  TicketSummary,
} from '@slop-control/shared';
import { AppConfig } from '../config';
import {
  TicketNotFoundError,
  TrackerAdapter,
  TrackerAdapterFactory,
  TrackerAuthError,
  TrackerUnavailableError,
} from './tracker';

const PAGE_SIZE = 30;
const REQUEST_TIMEOUT_MS = 10_000;
/** Search qualifiers that could widen a search beyond this repo's issues. */
const SCOPE_QUALIFIER = /^-?(repo|org|user|is|type|state):/i;

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  updated_at: string;
  body: string | null;
  pull_request?: unknown;
}

export interface GitHubOptions {
  token: string;
  apiUrl: string;
}

/** Read-only GitHub Issues. Error messages never include response bodies, so a token can't echo into them. */
export class GitHubIssuesAdapter implements TrackerAdapter {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly options: GitHubOptions,
  ) {}

  async list(query: TicketQuery): Promise<TicketPage> {
    const page = decodeCursor(query.cursor);
    const state = query.state ?? 'open';
    const search = query.search?.trim();

    const response = search
      ? await this.request('/search/issues', {
          q: this.searchQuery(search, state),
          per_page: String(PAGE_SIZE),
          page: String(page),
        })
      : await this.request(`/repos/${this.owner}/${this.repo}/issues`, {
          state,
          per_page: String(PAGE_SIZE),
          page: String(page),
        });

    if (response.status === 404) {
      throw new TrackerAuthError(`GitHub can't show ${this.owner}/${this.repo} to this token.`);
    }
    this.throwOnFailure(response);

    const json = (await response.json()) as GitHubIssue[] | { items: GitHubIssue[] };
    const issues = Array.isArray(json) ? json : json.items;
    return {
      items: issues.filter((issue) => !issue.pull_request).map((issue) => this.toSummary(issue)),
      nextCursor: hasNextPage(response) ? encodeCursor(page + 1) : null,
    };
  }

  async get(key: string): Promise<Ticket> {
    const number = this.parseKey(key);
    const response = await this.request(`/repos/${this.owner}/${this.repo}/issues/${number}`);
    if (response.status === 404 || response.status === 410) {
      throw new TicketNotFoundError(`Ticket ${key} doesn't exist.`);
    }
    this.throwOnFailure(response);

    const issue = (await response.json()) as GitHubIssue;
    if (issue.pull_request) throw new TicketNotFoundError(`${key} is a pull request.`);
    return { ...this.toSummary(issue), body: issue.body ?? '' };
  }

  private searchQuery(search: string, state: 'open' | 'closed' | 'all'): string {
    const text = search
      .split(/\s+/)
      .filter((word) => !SCOPE_QUALIFIER.test(word))
      .join(' ');
    const stateQualifier = state === 'all' ? [] : [`state:${state}`];
    return [text, `repo:${this.owner}/${this.repo}`, 'is:issue', ...stateQualifier]
      .filter(Boolean)
      .join(' ');
  }

  private parseKey(key: string): number {
    const prefix = `${this.owner}/${this.repo}#`;
    const number = key.startsWith(prefix) ? key.slice(prefix.length) : '';
    if (!/^[1-9]\d*$/.test(number)) throw new TicketNotFoundError(`Ticket ${key} doesn't exist.`);
    return Number(number);
  }

  private toSummary(issue: GitHubIssue): TicketSummary {
    return {
      key: `${this.owner}/${this.repo}#${issue.number}`,
      title: issue.title,
      status: issue.state,
      url: issue.html_url,
      updatedAt: issue.updated_at,
    };
  }

  private async request(path: string, params: Record<string, string> = {}): Promise<Response> {
    const url = new URL(path, this.options.apiUrl);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'slop-control',
    };
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;

    try {
      return await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new TrackerUnavailableError("GitHub can't be reached.");
    }
  }

  private throwOnFailure(response: Response): void {
    if (response.ok) return;
    const rateLimited =
      response.status === 429 ||
      (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
    if (rateLimited) throw new TrackerUnavailableError('GitHub is rate limiting this token.');
    if (response.status === 401 || response.status === 403) {
      throw new TrackerAuthError('GitHub rejected the configured token.');
    }
    throw new TrackerUnavailableError(`GitHub returned an error (${response.status}).`);
  }
}

@Injectable()
export class GitHubTrackerFactory extends TrackerAdapterFactory {
  constructor(private readonly config: AppConfig) {
    super();
  }

  forRepo(repo: LinkedRepo): TrackerAdapter {
    return new GitHubIssuesAdapter(repo.githubOwner, repo.githubRepo, {
      token: this.config.githubToken,
      apiUrl: this.config.githubApiUrl,
    });
  }
}

function hasNextPage(response: Response): boolean {
  return response.headers.get('link')?.includes('rel="next"') ?? false;
}

function encodeCursor(page: number): string {
  return Buffer.from(JSON.stringify({ page })).toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 1;
  try {
    const { page } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      page: unknown;
    };
    return typeof page === 'number' && Number.isInteger(page) && page > 0 ? page : 1;
  } catch {
    return 1;
  }
}
