import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  body: string;
  updated_at: string;
  pull_request?: unknown;
}

export interface StubPull {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  html_url: string;
}

/**
 * A GitHub REST stand-in for one repo: its issues with real paging, and the writes an approved
 * drafted action makes. It records what it received, and can be told to start rejecting a token.
 */
export class GitHubStub {
  issues: StubIssue[] = [];
  readonly requests: IncomingMessage[] = [];
  /** When set, only this token is accepted; requests with another, or none, get a 401. */
  requiredToken: string | null = null;
  /** When set, every request carrying a token gets a 401, as a revoked token would. */
  rejectTokens = false;
  /** What the repo's `permissions.push` says. */
  canPush = true;
  /** Repos, as `owner/repo`, that exist beside the main one and can't be pushed to. */
  readonly readOnlyRepos = new Set<string>();
  /** Answers the next pull request creation with a 422 carrying this message, once. */
  rejectNextPull: string | null = null;
  readonly pulls: StubPull[] = [];
  readonly comments: { issue: number; body: string }[] = [];
  /** The body of every write, in order. */
  readonly writes: { method: string; path: string; body: unknown }[] = [];
  private server: Server | null = null;
  url = '';

  constructor(
    private readonly owner = 'acme',
    private readonly repo = 'widgets',
  ) {}

  async start(): Promise<string> {
    this.server = createServer(async (req, res) => {
      this.requests.push(req);
      const url = new URL(req.url!, this.url);
      const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
      };
      const base = `/repos/${this.owner}/${this.repo}`;

      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
      const rejected =
        (this.rejectTokens && token !== null) ||
        (this.requiredToken !== null && token !== this.requiredToken);
      if (rejected) return send(401, { message: 'Bad credentials' });

      const method = req.method ?? 'GET';
      if (method !== 'GET') {
        const body = await readJson(req);
        this.writes.push({ method, path: url.pathname, body });
        // GitHub answers an anonymous write as if the repo weren't there.
        if (token === null) return send(404, { message: 'Not Found' });
        return this.write(method, url.pathname.slice(base.length), body, send);
      }

      if (url.pathname === '/user') {
        return token === null
          ? send(401, { message: 'Requires authentication' })
          : send(200, { login: 'octo' });
      }
      if (url.pathname === base) {
        return send(200, {
          full_name: `${this.owner}/${this.repo}`,
          permissions: { pull: true, push: this.canPush },
        });
      }
      const other = /^\/repos\/([^/]+\/[^/]+)$/.exec(url.pathname)?.[1];
      if (other && this.readOnlyRepos.has(other)) {
        return send(200, { full_name: other, permissions: { pull: true, push: false } });
      }
      if (url.pathname === `${base}/pulls`) {
        const head = url.searchParams.get('head')?.split(':')[1];
        return send(
          200,
          this.pulls.filter((pull) => pull.head === head),
        );
      }
      if (url.pathname === `${base}/issues`) {
        const state = url.searchParams.get('state') ?? 'open';
        const { items, headers } = this.page(url, this.sorted(state));
        return send(200, items, headers);
      }
      if (url.pathname === '/search/issues') {
        const words = (url.searchParams.get('q') ?? '').split(/\s+/).filter(Boolean);
        const state = words.find((word) => word.startsWith('state:'))?.slice('state:'.length);
        const text = words.filter((word) => !/^[a-z]+:/.test(word));
        const matching = this.sorted(state ?? 'all').filter((issue) =>
          text.every((word) => `${issue.title} ${issue.body}`.includes(word)),
        );
        const { items, headers } = this.page(url, matching);
        return send(200, { items }, headers);
      }
      const read = new RegExp(`^${base}/issues/(\\d+)$`).exec(url.pathname);
      const found = read && this.issues.find((issue) => issue.number === Number(read[1]));
      return found ? send(200, this.shaped(found)) : send(404, { message: 'Not Found' });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  private write(
    method: string,
    path: string,
    body: unknown,
    send: (status: number, body: unknown) => void,
  ): void {
    const fields = (body ?? {}) as Record<string, string>;
    if (method === 'POST' && path === '/pulls') {
      if (this.rejectNextPull) {
        const message = this.rejectNextPull;
        this.rejectNextPull = null;
        return send(422, { message: 'Validation Failed', errors: [{ message }] });
      }
      const number = this.pulls.length + 1;
      const pull: StubPull = {
        number,
        title: fields.title!,
        body: fields.body!,
        head: fields.head!,
        base: fields.base!,
        html_url: `https://github.com/${this.owner}/${this.repo}/pull/${number}`,
      };
      this.pulls.push(pull);
      return send(201, pull);
    }
    const comment = /^\/issues\/(\d+)\/comments$/.exec(path);
    const issue = /^\/issues\/(\d+)$/.exec(path);
    const found = this.issues.find((item) => item.number === Number((comment ?? issue)?.[1]));
    if (!found) return send(404, { message: 'Not Found' });
    if (method === 'POST' && comment) {
      this.comments.push({ issue: found.number, body: fields.body! });
      return send(201, {
        html_url: `${this.shaped(found).html_url}#issuecomment-${this.comments.length}`,
      });
    }
    if (method === 'PATCH' && issue) {
      found.state = fields.state === 'closed' ? 'closed' : 'open';
      found.updated_at = new Date().toISOString();
      return send(200, this.shaped(found));
    }
    return send(404, { message: 'Not Found' });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** An issue as GitHub returns it from a list, a search, or a single read. */
  private shaped(issue: StubIssue) {
    return {
      ...issue,
      html_url: `https://github.com/${this.owner}/${this.repo}/issues/${issue.number}`,
    };
  }

  private sorted(state: string): StubIssue[] {
    return this.issues
      .filter((issue) => state === 'all' || issue.state === state)
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  }

  private page(url: URL, all: StubIssue[]) {
    const perPage = Number(url.searchParams.get('per_page') ?? 30);
    const page = Number(url.searchParams.get('page') ?? 1);
    const items = all
      .slice((page - 1) * perPage, page * perPage)
      .map((issue) => this.shaped(issue));
    const headers: Record<string, string> =
      page * perPage < all.length
        ? { link: `<${this.url}/next?page=${page + 1}>; rel="next"` }
        : {};
    return { items, headers };
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}
