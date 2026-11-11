// Stands in for the GitHub API, through the server's GITHUB_API_URL setting. Issues list and read only.
import { createServer } from 'node:http';
import { URL } from 'node:url';

const port = Number(process.env.GITHUB_STUB_PORT ?? 4010);
const OWNER = 'e2e-owner';
const REPO = 'e2e-repo';

const issues = [
  {
    number: 2,
    title: 'Stub issue: export fails on empty lists',
    state: 'open',
    html_url: `http://127.0.0.1:${port}/${OWNER}/${REPO}/issues/2`,
    updated_at: '2026-11-10T09:00:00Z',
    body: 'Served by the GitHub stub.',
  },
  {
    number: 1,
    title: 'Stub issue: add a dark theme',
    state: 'open',
    html_url: `http://127.0.0.1:${port}/${OWNER}/${REPO}/issues/1`,
    updated_at: '2026-11-09T09:00:00Z',
    body: 'Served by the GitHub stub.',
  },
];

/** Every request the server made, so the run can show it used the stub and nothing else. */
const requests = [];

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  const json = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  if (url.pathname === '/__requests') return json(200, requests);
  requests.push({
    method: request.method,
    path: url.pathname,
    authorized: Boolean(request.headers.authorization),
  });

  const repoPath = `/repos/${OWNER}/${REPO}`;
  if (url.pathname === repoPath) return json(200, { full_name: `${OWNER}/${REPO}` });
  if (url.pathname === `${repoPath}/issues`) {
    const state = url.searchParams.get('state') ?? 'open';
    return json(
      200,
      issues.filter((issue) => state === 'all' || issue.state === state),
    );
  }
  const single = new RegExp(`^${repoPath}/issues/(\\d+)$`).exec(url.pathname);
  if (single) {
    const issue = issues.find((item) => item.number === Number(single[1]));
    return issue ? json(200, issue) : json(404, { message: 'Not Found' });
  }
  if (url.pathname === '/search/issues') {
    const text = (url.searchParams.get('q') ?? '').split(' ').filter((word) => !word.includes(':'));
    return json(200, {
      items: issues.filter((issue) => text.every((word) => issue.title.includes(word))),
    });
  }
  return json(404, { message: 'Not Found' });
});

server.listen(port, '127.0.0.1');
