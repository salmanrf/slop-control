import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GitHubIssuesAdapter } from '../src/tickets/github-issues.adapter';
import {
  TicketNotFoundError,
  TrackerAuthError,
  TrackerUnavailableError,
} from '../src/tickets/tracker';

const TOKEN = 'ghp_stub_token_value';

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
    adapter = new GitHubIssuesAdapter('acme', 'widgets', { token: TOKEN, apiUrl: baseUrl });
  });

  describe('list', () => {
    it('returns tickets with their keys, leaving out pull requests', async () => {
      reply(200, [issue(1), issue(2, { pull_request: { url: 'x' } }), issue(3)]);
      const page = await adapter.list({});
      expect(page.items).toEqual([
        {
          key: 'acme/widgets#1',
          title: 'Issue 1',
          status: 'open',
          url: 'https://github.com/acme/widgets/issues/1',
          updatedAt: '2026-11-01T10:00:00Z',
        },
        expect.objectContaining({ key: 'acme/widgets#3' }),
      ]);
      expect(lastUrl().pathname).toBe('/repos/acme/widgets/issues');
    });

    it.each([
      [undefined, 'open'],
      ['open', 'open'],
      ['closed', 'closed'],
      ['all', 'all'],
    ] as const)('asks for state %s as %s', async (state, expected) => {
      reply(200, []);
      await adapter.list({ state });
      expect(lastUrl().searchParams.get('state')).toBe(expected);
    });

    it('pages with an opaque cursor', async () => {
      reply(200, [issue(1)], { link: `<${baseUrl}/repos/acme/widgets/issues?page=2>; rel="next"` });
      const first = await adapter.list({});
      expect(first.nextCursor).not.toBeNull();

      reply(200, [issue(2)]);
      const second = await adapter.list({ cursor: first.nextCursor! });
      expect(lastUrl().searchParams.get('page')).toBe('2');
      expect(second.nextCursor).toBeNull();
    });

    it('keeps paging available when a full page held only pull requests', async () => {
      reply(200, [issue(1, { pull_request: {} })], {
        link: `<${baseUrl}/x?page=2>; rel="next"`,
      });
      const page = await adapter.list({});
      expect(page.items).toEqual([]);
      expect(page.nextCursor).not.toBeNull();
    });

    it('starts from the first page when given a cursor it did not issue', async () => {
      reply(200, []);
      await adapter.list({ cursor: 'garbage!' });
      expect(lastUrl().searchParams.get('page')).toBe('1');
    });
  });

  describe('search', () => {
    it('uses the search API, scoped to the repo and to issues', async () => {
      reply(200, { items: [issue(5), issue(6, { pull_request: {} })] });
      const page = await adapter.list({ search: 'broken login', state: 'closed' });

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
      await adapter.list({ search: 'secret repo:other/private org:other' });
      const q = lastUrl().searchParams.get('q')!;
      expect(q).not.toContain('other');
      expect(q).toContain('secret');
    });

    it('pages search results', async () => {
      reply(200, { items: [issue(5)] }, { link: `<${baseUrl}/x?page=2>; rel="next"` });
      const first = await adapter.list({ search: 'x' });
      reply(200, { items: [] });
      await adapter.list({ search: 'x', cursor: first.nextCursor! });
      expect(lastUrl().searchParams.get('page')).toBe('2');
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
      await expect(adapter.list({})).rejects.toBeInstanceOf(TrackerAuthError);
      await expect(adapter.get('acme/widgets#1')).rejects.toBeInstanceOf(TrackerAuthError);
    });

    it('maps a 404 on the list to TrackerAuthError, since GitHub hides private repos that way', async () => {
      reply(404, { message: 'Not Found' });
      await expect(adapter.list({})).rejects.toBeInstanceOf(TrackerAuthError);
    });

    it.each([
      ['a rate limit 403', 403, { 'x-ratelimit-remaining': '0' }],
      ['a 429', 429, {}],
      ['a 500', 500, {}],
      ['a 503', 503, {}],
    ])('maps %s to TrackerUnavailableError', async (_name, status, headers) => {
      reply(status, { message: 'nope' }, headers);
      await expect(adapter.list({})).rejects.toBeInstanceOf(TrackerUnavailableError);
    });

    it('maps a connection failure to TrackerUnavailableError', async () => {
      const unreachable = new GitHubIssuesAdapter('acme', 'widgets', {
        token: TOKEN,
        apiUrl: 'http://127.0.0.1:9',
      });
      await expect(unreachable.list({})).rejects.toBeInstanceOf(TrackerUnavailableError);
    });

    it('keeps the token out of error messages', async () => {
      respond = (_req, res) => {
        res.writeHead(500);
        res.end(`upstream echoed ${TOKEN}`);
      };
      const error = await adapter.list({}).catch((e: Error) => e);
      expect(String((error as Error).message)).not.toContain(TOKEN);
    });
  });

  describe('token', () => {
    it('sends the token only as a request header', async () => {
      reply(200, [issue(1)]);
      await adapter.list({ search: undefined });
      expect(requests.at(-1)!.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(requests.at(-1)!.url).not.toContain(TOKEN);
    });

    it('sends no authorization header when no token is configured', async () => {
      const anonymous = new GitHubIssuesAdapter('acme', 'widgets', { token: '', apiUrl: baseUrl });
      reply(200, []);
      await anonymous.list({});
      expect(requests.at(-1)!.headers.authorization).toBeUndefined();
    });
  });
});
