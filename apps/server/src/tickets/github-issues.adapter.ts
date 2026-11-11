import { Injectable } from '@nestjs/common';
import type {
  Ticket,
  TicketPage,
  TicketQuery,
  TicketSource,
  TicketSummary,
} from '@slop-control/shared';
import { AppConfig } from '../config';
import {
  TICKET_PAGE_SIZE as PAGE_SIZE,
  TicketNotFoundError,
  TrackerAdapter,
  TrackerAdapterFactory,
  TrackerAuthError,
  TrackerUnavailableError,
} from './tracker';

const REQUEST_TIMEOUT_MS = 10_000;
/** Search qualifiers that could widen a search beyond this repo's issues, or undo its filters. */
const SCOPE_QUALIFIER = /^-?(repo|org|user|is|type|state|assignee|sort):/i;

type GitHubState = 'open' | 'closed' | 'all';

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
  /** The source its tickets are reported under. */
  sourceId: string;
  /** Remembers the token's login between requests, since it's needed for every `mine` list. */
  loginCache?: Map<string, string>;
}

/** Read-only GitHub Issues. Error messages never include response bodies, so a token can't echo into them. */
export class GitHubIssuesAdapter implements TrackerAdapter {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly options: GitHubOptions,
  ) {}

  async verify(): Promise<void> {
    const response = await this.request(`/repos/${this.owner}/${this.repo}`);
    if (response.status === 404) throw this.hidden();
    this.throwOnFailure(response);
  }

  async list(query: TicketQuery): Promise<TicketPage & { mineApplied: boolean }> {
    const wantMine = query.mine ?? true;
    // With no token there is no user to filter by, so everything is returned and the caller is told.
    const mineApplied = !wantMine || this.options.token !== '';
    const state = githubState(query.category ?? 'not_done');
    // GitHub Issues has no in-progress status, so there is nothing to ask for.
    if (state === null) return { items: [], nextCursor: null, mineApplied };

    const assignee = wantMine && this.options.token ? await this.login() : null;
    const page = decodeCursor(query.cursor);
    const search = query.search?.trim();

    const response = search
      ? await this.request('/search/issues', {
          q: this.searchQuery(search, state, assignee),
          sort: 'updated',
          order: 'desc',
          per_page: String(PAGE_SIZE),
          page: String(page),
        })
      : await this.request(`/repos/${this.owner}/${this.repo}/issues`, {
          state,
          sort: 'updated',
          direction: 'desc',
          ...(assignee ? { assignee } : {}),
          per_page: String(PAGE_SIZE),
          page: String(page),
        });

    if (response.status === 404) throw this.hidden();
    this.throwOnFailure(response);

    const json = (await response.json()) as GitHubIssue[] | { items: GitHubIssue[] };
    const issues = Array.isArray(json) ? json : json.items;
    return {
      items: issues.filter((issue) => !issue.pull_request).map((issue) => this.toSummary(issue)),
      nextCursor: hasNextPage(response) ? encodeCursor(page + 1) : null,
      mineApplied,
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

  /** The login of the token's user, for the assigned-to-me filter. */
  private async login(): Promise<string> {
    const cached = this.options.loginCache?.get(this.options.token);
    if (cached) return cached;
    const response = await this.request('/user');
    this.throwOnFailure(response);
    const { login } = (await response.json()) as { login?: unknown };
    if (typeof login !== 'string' || login === '') {
      throw new TrackerUnavailableError("GitHub didn't say whose token this is.");
    }
    this.options.loginCache?.set(this.options.token, login);
    return login;
  }

  private hidden(): TrackerAuthError {
    return new TrackerAuthError(`GitHub can't show ${this.owner}/${this.repo} to this token.`);
  }

  private searchQuery(search: string, state: GitHubState, assignee: string | null): string {
    const text = search
      .split(/\s+/)
      .filter((word) => !SCOPE_QUALIFIER.test(word))
      .join(' ');
    const stateQualifier = state === 'all' ? [] : [`state:${state}`];
    const assigneeQualifier = assignee ? [`assignee:${assignee}`] : [];
    return [
      text,
      `repo:${this.owner}/${this.repo}`,
      'is:issue',
      ...stateQualifier,
      ...assigneeQualifier,
    ]
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
      sourceId: this.options.sourceId,
      key: `${this.owner}/${this.repo}#${issue.number}`,
      title: issue.title,
      status: issue.state,
      statusCategory: issue.state === 'closed' ? 'done' : 'open',
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

/** A source has no stored token yet, so every GitHub Issues source uses the server's `GITHUB_TOKEN`. */
@Injectable()
export class GitHubTrackerFactory extends TrackerAdapterFactory {
  private readonly loginCache = new Map<string, string>();

  constructor(private readonly config: AppConfig) {
    super();
  }

  forConnected(source: TicketSource, token: string | null): TrackerAdapter {
    if (source.type !== 'github_issues' || !source.scope || !('githubOwner' in source.scope)) {
      throw new Error(`No adapter for a ${source.type} ticket source.`);
    }
    return new GitHubIssuesAdapter(source.scope.githubOwner, source.scope.githubRepo, {
      token: token ?? this.config.githubToken,
      apiUrl: this.config.githubApiUrl,
      sourceId: source.id,
      loginCache: this.loginCache,
    });
  }
}

function githubState(category: NonNullable<TicketQuery['category']>): GitHubState | null {
  if (category === 'in_progress') return null;
  if (category === 'done') return 'closed';
  return category === 'all' ? 'all' : 'open';
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
