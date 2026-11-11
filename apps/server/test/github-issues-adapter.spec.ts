import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GitHubIssuesAdapter } from '../src/tickets/github-issues.adapter';
import {
  TicketNotFoundError,
  TrackerAuthError,
  TrackerUnavailableError,
} from '../src/tickets/tracker';

const TOKEN = 'ghp_stub_token_value';
const SOURCE_ID = '11111111-0000-4000-8000-000000000000';

const issue = (number: number, extra: object = {}) => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  html_url: `https://github.com/acme/widgets/issues/${number}`,
  updated_at: '2026-11-01T10:00:00Z',
  body: `Body of ${number}`,
  ...extra,
});

describe('GitHubIssuesAdapter', () => {
  let server: Server;
  let baseUrl: string;
  let requests: IncomingMessage[];
  let respond: (req: IncomingMessage, res: ServerResponse) => void;
  let adapter: GitHubIssuesAdapter;

  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    respond = (_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
  };
  const lastUrl = () => new URL(requests.at(-1)!.url!, baseUrl);
  const paths = () => requests.map((request) => new URL(request.url!, baseUrl).pathname);
  /** Answers `GET /user` as the token's user, and everything else with `body`. */
  const replyAs = (login: string, body: unknown) => {
    respond = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.url === '/user' ? { login } : body));
    };
  };
  const make = (token: string, loginCache?: Map<string, string>) =>
    new GitHubIssuesAdapter('acme', 'widgets', {
      token,
      apiUrl: baseUrl,
      sourceId: SOURCE_ID,
      loginCache,
    });

  beforeAll(async () => {
    server = createServer((req, res) => {
      requests.push(req);
      respond(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  beforeEach(() => {
    requests = [];
    adapter = make(TOKEN);
  });

  describe('list', () => {
    it('returns tickets with their keys, leaving out pull requests', async () => {
      reply(200, [issue(1), issue(2, { pull_request: { url: 'x' } }), issue(3)]);
      const page = await adapter.list({ mine: false });
      expect(page.items).toEqual([
        {
          sourceId: SOURCE_ID,
          key: 'acme/widgets#1',
          title: 'Issue 1',
          status: 'open',
          statusCategory: 'open',
          url: 'https://github.com/acme/widgets/issues/1',
          updatedAt: '2026-11-01T10:00:00Z',
        },
        expect.objectContaining({ key: 'acme/widgets#3' }),
      ]);
      expect(lastUrl().pathname).toBe('/repos/acme/widgets/issues');
    });

    it.each([
      [undefined, 'open'],
      ['not_done', 'open'],
      ['open', 'open'],
      ['done', 'closed'],
      ['all', 'all'],
    ] as const)('asks for the category %s as state %s', async (category, expected) => {
      reply(200, []);
      await adapter.list({ category, mine: false });
      expect(lastUrl().searchParams.get('state')).toBe(expected);
    });

    it('returns nothing for in progress without calling GitHub, which has no such status', async () => {
      const page = await adapter.list({ category: 'in_progress' });
      expect(page).toEqual({ items: [], nextCursor: null, mineApplied: true });
      expect(requests).toHaveLength(0);
    });

    it('reports a closed issue as done, under its own status name', async () => {
      reply(200, [issue(1, { state: 'closed' })]);
      const page = await adapter.list({ category: 'done', mine: false });
      expect(page.items[0]).toMatchObject({ status: 'closed', statusCategory: 'done' });
    });

    it('asks for the most recently updated first', async () => {
      reply(200, []);
      await adapter.list({ mine: false });
      expect(lastUrl().searchParams.get('sort')).toBe('updated');
      expect(lastUrl().searchParams.get('direction')).toBe('desc');
    });

    it('pages with an opaque cursor', async () => {
      reply(200, [issue(1)], { link: `<${baseUrl}/repos/acme/widgets/issues?page=2>; rel="next"` });
      const first = await adapter.list({ mine: false });
      expect(first.nextCursor).not.toBeNull();

      reply(200, [issue(2)]);
      const second = await adapter.list({ mine: false, cursor: first.nextCursor! });
      expect(lastUrl().searchParams.get('page')).toBe('2');
      expect(second.nextCursor).toBeNull();
    });

    it('keeps paging available when a full page held only pull requests', async () => {
      reply(200, [issue(1, { pull_request: {} })], {
        link: `<${baseUrl}/x?page=2>; rel="next"`,
      });
      const page = await adapter.list({ mine: false });
      expect(page.items).toEqual([]);
      expect(page.nextCursor).not.toBeNull();
    });

    it('starts from the first page when given a cursor it did not issue', async () => {
      reply(200, []);
      await adapter.list({ mine: false, cursor: 'garbage!' });
      expect(lastUrl().searchParams.get('page')).toBe('1');
    });
  });

  describe('search', () => {
    it('uses the search API, scoped to the repo and to issues', async () => {
      reply(200, { items: [issue(5), issue(6, { pull_request: {} })] });
      const page = await adapter.list({ search: 'broken login', category: 'done', mine: false });

      expect(lastUrl().pathname).toBe('/search/issues');
      const q = lastUrl().searchParams.get('q')!;
      expect(q).toContain('broken login');
      expect(q).toContain('repo:acme/widgets');
      expect(q).toContain('is:issue');
      expect(q).toContain('state:closed');
      expect(page.items.map((item) => item.key)).toEqual(['acme/widgets#5']);
    });

    it('does not let search text widen the scope to another repo', async () => {
      reply(200, { items: [] });
      await adapter.list({ search: 'secret repo:other/private org:other', mine: false });
      const q = lastUrl().searchParams.get('q')!;
      expect(q).not.toContain('other');
      expect(q).toContain('secret');
    });

    it('does not let search text undo the assignee filter or the sort', async () => {
      replyAs('octo', { items: [] });
      await adapter.list({ search: 'bug assignee:someone -assignee:octo sort:created' });
      const q = lastUrl().searchParams.get('q')!;
      expect(q).not.toContain('someone');
      expect(q).not.toContain('sort:');
      expect(q.match(/assignee:/g)).toHaveLength(1);
      expect(q).toContain('assignee:octo');
    });

    it('sorts search results by most recently updated', async () => {
      reply(200, { items: [] });
      await adapter.list({ search: 'x', mine: false });
      expect(lastUrl().searchParams.get('sort')).toBe('updated');
      expect(lastUrl().searchParams.get('order')).toBe('desc');
    });

    it('pages search results', async () => {
      reply(200, { items: [issue(5)] }, { link: `<${baseUrl}/x?page=2>; rel="next"` });
      const first = await adapter.list({ search: 'x', mine: false });
      reply(200, { items: [] });
      await adapter.list({ search: 'x', mine: false, cursor: first.nextCursor! });
      expect(lastUrl().searchParams.get('page')).toBe('2');
    });
  });

  describe('assigned to me', () => {
    it("filters the list by the login of the token's user, by default", async () => {
      replyAs('octo', [issue(1)]);
      const page = await adapter.list({});
      expect(paths()).toEqual(['/user', '/repos/acme/widgets/issues']);
      expect(lastUrl().searchParams.get('assignee')).toBe('octo');
      expect(page.mineApplied).toBe(true);
    });

    it('filters a search with an assignee qualifier', async () => {
      replyAs('octo', { items: [issue(1)] });
      const page = await adapter.list({ search: 'bug' });
      expect(lastUrl().searchParams.get('q')).toContain('assignee:octo');
      expect(page.mineApplied).toBe(true);
    });

    it('asks who the token belongs to once, when given a cache', async () => {
      const cache = new Map<string, string>();
      replyAs('octo', []);
      await make(TOKEN, cache).list({});
      await make(TOKEN, cache).list({});
      expect(paths().filter((path) => path === '/user')).toHaveLength(1);
      expect(lastUrl().searchParams.get('assignee')).toBe('octo');
    });

    it('does not filter when all tickets are asked for', async () => {
      reply(200, [issue(1)]);
      const page = await adapter.list({ mine: false });
      expect(paths()).toEqual(['/repos/acme/widgets/issues']);
      expect(lastUrl().searchParams.get('assignee')).toBeNull();
      expect(page.mineApplied).toBe(true);
    });

    it('returns everything with no token, and says the filter was not applied', async () => {
      reply(200, [issue(1), issue(2)]);
      const page = await make('').list({});
      expect(paths()).toEqual(['/repos/acme/widgets/issues']);
      expect(lastUrl().searchParams.get('assignee')).toBeNull();
      expect(page.items).toHaveLength(2);
      expect(page.mineApplied).toBe(false);
    });

    it('maps a rejected token on the user lookup to TrackerAuthError', async () => {
      reply(401, { message: 'Bad credentials' });
      await expect(adapter.list({})).rejects.toBeInstanceOf(TrackerAuthError);
    });
  });

  describe('verify', () => {
    it('resolves when the repo can be read', async () => {
      reply(200, { full_name: 'acme/widgets' });
      await expect(adapter.verify()).resolves.toBeUndefined();
      expect(lastUrl().pathname).toBe('/repos/acme/widgets');
    });

    it.each([[401], [403], [404]])('maps a %i to TrackerAuthError', async (status) => {
      reply(status, { message: 'nope' });
      await expect(adapter.verify()).rejects.toBeInstanceOf(TrackerAuthError);
    });

    it('maps a server error to TrackerUnavailableError', async () => {
      reply(502, { message: 'nope' });
      await expect(adapter.verify()).rejects.toBeInstanceOf(TrackerUnavailableError);
    });
  });

  describe('get', () => {
    it('reads a ticket with its body', async () => {
      reply(200, issue(9));
      await expect(adapter.get('acme/widgets#9')).resolves.toMatchObject({
        key: 'acme/widgets#9',
        title: 'Issue 9',
        body: 'Body of 9',
        status: 'open',
        statusCategory: 'open',
        sourceId: SOURCE_ID,
      });
      expect(lastUrl().pathname).toBe('/repos/acme/widgets/issues/9');
    });

    it('treats a missing body as empty', async () => {
      reply(200, issue(9, { body: null }));
      expect((await adapter.get('acme/widgets#9')).body).toBe('');
    });

    it.each([[404], [410]])('maps a %i to TicketNotFoundError', async (status) => {
      reply(status, { message: 'gone' });
      await expect(adapter.get('acme/widgets#9')).rejects.toBeInstanceOf(TicketNotFoundError);
    });

    it('treats a pull request as not found', async () => {
      reply(200, issue(9, { pull_request: {} }));
      await expect(adapter.get('acme/widgets#9')).rejects.toBeInstanceOf(TicketNotFoundError);
    });

    it.each([['other/repo#1'], ['acme/widgets#abc'], ['acme/widgets'], ['acme/widgets#1/../2']])(
      'rejects the key %s without calling GitHub',
      async (key) => {
        await expect(adapter.get(key)).rejects.toBeInstanceOf(TicketNotFoundError);
        expect(requests).toHaveLength(0);
      },
    );
  });

  describe('errors', () => {
    it.each([[401], [403]])('maps a %i to TrackerAuthError', async (status) => {
      reply(status, { message: 'Bad credentials' });
      await expect(adapter.list({ mine: false })).rejects.toBeInstanceOf(TrackerAuthError);
      await expect(adapter.get('acme/widgets#1')).rejects.toBeInstanceOf(TrackerAuthError);
    });

    it('maps a 404 on the list to TrackerAuthError, since GitHub hides private repos that way', async () => {
      reply(404, { message: 'Not Found' });
      await expect(adapter.list({ mine: false })).rejects.toBeInstanceOf(TrackerAuthError);
    });

    it.each([
      ['a rate limit 403', 403, { 'x-ratelimit-remaining': '0' }],
      ['a 429', 429, {}],
      ['a 500', 500, {}],
      ['a 503', 503, {}],
    ])('maps %s to TrackerUnavailableError', async (_name, status, headers) => {
      reply(status, { message: 'nope' }, headers);
      await expect(adapter.list({ mine: false })).rejects.toBeInstanceOf(TrackerUnavailableError);
    });

    it('maps a connection failure to TrackerUnavailableError', async () => {
      const unreachable = new GitHubIssuesAdapter('acme', 'widgets', {
        token: TOKEN,
        apiUrl: 'http://127.0.0.1:9',
        sourceId: SOURCE_ID,
      });
      await expect(unreachable.list({ mine: false })).rejects.toBeInstanceOf(
        TrackerUnavailableError,
      );
    });

    it('keeps the token out of error messages', async () => {
      respond = (_req, res) => {
        res.writeHead(500);
        res.end(`upstream echoed ${TOKEN}`);
      };
      const error = await adapter.list({ mine: false }).catch((e: Error) => e);
      expect(String((error as Error).message)).not.toContain(TOKEN);
    });
  });

  describe('token', () => {
    it('sends the token only as a request header', async () => {
      reply(200, [issue(1)]);
      await adapter.list({ search: undefined, mine: false });
      expect(requests.at(-1)!.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(requests.at(-1)!.url).not.toContain(TOKEN);
    });

    it('sends no authorization header when no token is configured', async () => {
      const anonymous = make('');
      reply(200, []);
      await anonymous.list({ mine: false });
      expect(requests.at(-1)!.headers.authorization).toBeUndefined();
    });
  });
});
