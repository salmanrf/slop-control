// Stands in for the GitHub API, through the server's GITHUB_API_URL setting: issues, and the
// writes an approved drafted action makes. It records what it received, and the run can tell it
// to start rejecting tokens. Pushes never come here: they go to local bare repos.
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { URL } from 'node:url';

const port = Number(process.env.GITHUB_STUB_PORT ?? 4010);
const OWNER = 'e2e-owner';
/** The repo that has issues. */
const REPO = 'e2e-repo';
/** Every repo that exists here; a token can push to each of them. */
const REPOS = [REPO, 'pr-repo'];
/** Whose token every token is. */
const LOGIN = 'e2e-user';

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
/** What the writes left behind, for the run to check through `/__stub/state`. */
const pulls = [];
const comments = [];
/** The body of every write, in order, whether or not it was accepted. */
const writes = [];
/** When true, every request carrying a token gets a 401, as a revoked token would. */
let rejectTokens = false;

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  const method = request.method ?? 'GET';
  const json = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  // The run's own questions and switches. They aren't requests the server made, so they aren't recorded.
  if (url.pathname === '/__requests') return json(200, requests);
  if (url.pathname === '/__stub/state') {
    return json(200, { pulls, comments, writes, rejectTokens });
  }
  if (url.pathname === '/__stub/reject-token' && method === 'POST') {
    rejectTokens = (await readJson(request))?.reject === true;
    return json(200, { rejectTokens });
  }

  const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? null;
  requests.push({ method, path: url.pathname, authorized: token !== null });
  if (rejectTokens && token !== null) return json(401, { message: 'Bad credentials' });

  const inRepo = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
  const known = inRepo !== null && inRepo[1] === OWNER && REPOS.includes(inRepo[2]);
  const repo = known ? inRepo[2] : null;
  const rest = known ? (inRepo[3] ?? '') : null;

  if (method !== 'GET') {
    const body = await readJson(request);
    writes.push({ method, path: url.pathname, body });
    // GitHub answers an anonymous write as if the repo weren't there.
    if (token === null || repo === null) return json(404, { message: 'Not Found' });
    return write(method, repo, rest, body ?? {}, json);
  }

  if (url.pathname === '/user') {
    return token === null
      ? json(401, { message: 'Requires authentication' })
      : json(200, { login: LOGIN });
  }
  if (url.pathname === '/search/issues') {
    const words = (url.searchParams.get('q') ?? '').split(' ');
    const text = words.filter((word) => !word.includes(':'));
    // Only one repo has issues, so a search scoped to another finds none.
    const scope = words.find((word) => word.startsWith('repo:'));
    const searched = !scope || scope.toLowerCase() === `repo:${OWNER}/${REPO}` ? issues : [];
    return json(200, {
      items: searched.filter((issue) => text.every((word) => issue.title.includes(word))),
    });
  }
  if (repo === null) return json(404, { message: 'Not Found' });

  if (rest === '') {
    return json(200, {
      full_name: `${OWNER}/${repo}`,
      permissions: { pull: true, push: true },
    });
  }
  if (rest === '/pulls') {
    // Asked as `owner:branch`, and only ever for the open ones, which every pull here is.
    const head = (url.searchParams.get('head') ?? '').split(':')[1];
    return json(
      200,
      pulls.filter((pull) => pull.repo === repo && pull.head === head),
    );
  }
  const repoIssues = repo === REPO ? issues : [];
  if (rest === '/issues') {
    const state = url.searchParams.get('state') ?? 'open';
    return json(
      200,
      repoIssues.filter((issue) => state === 'all' || issue.state === state),
    );
  }
  const single = /^\/issues\/(\d+)$/.exec(rest);
  if (single) {
    const issue = repoIssues.find((item) => item.number === Number(single[1]));
    return issue ? json(200, issue) : json(404, { message: 'Not Found' });
  }
  return json(404, { message: 'Not Found' });
});

/** The writes an approved drafted action makes: a pull request, an issue comment, an issue's state. */
function write(method, repo, rest, body, json) {
  if (method === 'POST' && rest === '/pulls') {
    const number = pulls.length + 1;
    const pull = {
      number,
      repo,
      title: body.title,
      body: body.body,
      head: body.head,
      base: body.base,
      html_url: `http://127.0.0.1:${port}/${OWNER}/${repo}/pull/${number}`,
    };
    pulls.push(pull);
    return json(201, pull);
  }
  const comment = /^\/issues\/(\d+)\/comments$/.exec(rest);
  const single = /^\/issues\/(\d+)$/.exec(rest);
  const number = Number((comment ?? single)?.[1]);
  const issue = repo === REPO ? issues.find((item) => item.number === number) : undefined;
  if (!issue) return json(404, { message: 'Not Found' });
  if (method === 'POST' && comment) {
    comments.push({ repo, issue: issue.number, body: body.body });
    return json(201, { html_url: `${issue.html_url}#issuecomment-${comments.length}` });
  }
  if (method === 'PATCH' && single) {
    issue.state = body.state === 'closed' ? 'closed' : 'open';
    issue.updated_at = new Date().toISOString();
    return json(200, issue);
  }
  return json(404, { message: 'Not Found' });
}

server.listen(port, '127.0.0.1');
