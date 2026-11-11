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

/** A GitHub REST stand-in for one repo's issues: list, search, and read, with real paging. */
export class GitHubStub {
  issues: StubIssue[] = [];
  readonly requests: IncomingMessage[] = [];
  private server: Server | null = null;
  url = '';

  constructor(
    private readonly owner = 'acme',
    private readonly repo = 'widgets',
  ) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      this.requests.push(req);
      const url = new URL(req.url!, this.url);
      const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
      };
      const base = `/repos/${this.owner}/${this.repo}`;

      if (url.pathname === '/user') return send(200, { login: 'octo' });
      if (url.pathname === base) return send(200, { full_name: `${this.owner}/${this.repo}` });
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
