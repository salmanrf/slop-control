import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { git, tempDir } from './git';

/**
 * A recording remote over HTTP for SM-16: git's own `http-backend` behind a small server that
 * demands a token, and that can hold a push open so a session has time to look for that token.
 */

export interface GitServerRequest {
  method: string;
  /** The path and query asked for. */
  target: string;
  /** True if the request carried the token this server demands. */
  authenticated: boolean;
  /** True if it carried some other credential. */
  otherCredential: boolean;
  /** True for the request that carries a push's commits. */
  push: boolean;
}

export interface HeldGitServer {
  /** The base address; a repo is at `<url>/<owner>/<repo>.git`. */
  url: string;
  /** The bare repo behind `<url>/<owner>/<repo>.git`. */
  repoPath: string;
  requests: GitServerRequest[];
  /** The repo's refs, to compare before and after. */
  refs(): string;
  /** Resolves once a push has arrived and is being held. */
  held: Promise<void>;
  /** Lets the held push through. Until then, and for at most `holdMs`, a push gets no answer. */
  release(): void;
  close(): Promise<void>;
}

/**
 * @params options.token: the only credential accepted; options.owner, options.repo: the one repo served; options.seedFrom: a clone whose `main` the repo starts with; options.holdMs: how long a push is held if nobody releases it
 * @return the server, listening on this machine only
 * Records every request. Needs no network.
 */
export async function startHeldGitServer(options: {
  token: string;
  owner: string;
  repo: string;
  seedFrom: string;
  holdMs: number;
}): Promise<HeldGitServer> {
  const root = tempDir('slop-smoke-git-server-');
  const repoPath = join(root, options.owner, `${options.repo}.git`);
  mkdirSync(join(root, options.owner));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', repoPath]);
  git(options.seedFrom, 'push', '-q', repoPath, 'HEAD:refs/heads/main');

  const requests: GitServerRequest[] = [];
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => (release = resolve));
  let markHeld: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (markHeld = resolve));

  const carriesToken = (authorization: string | undefined): boolean => {
    if (!authorization) return false;
    if (authorization.includes(options.token)) return true;
    const encoded = /^Basic\s+(\S+)/i.exec(authorization)?.[1];
    return encoded
      ? Buffer.from(encoded, 'base64').toString('utf8').includes(options.token)
      : false;
  };

  const backend = (req: IncomingMessage, res: ServerResponse, url: URL): void => {
    const child = spawn('git', ['http-backend'], {
      env: {
        PATH: process.env.PATH ?? '',
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        // A named user is what lets `http-backend` accept a push.
        REMOTE_USER: 'workspace',
        REMOTE_ADDR: '127.0.0.1',
        REQUEST_METHOD: req.method ?? 'GET',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        ...(req.headers['content-length'] ? { CONTENT_LENGTH: req.headers['content-length'] } : {}),
        ...(req.headers['content-encoding']
          ? { HTTP_CONTENT_ENCODING: String(req.headers['content-encoding']) }
          : {}),
      },
    });
    req.pipe(child.stdin);
    child.stdin.on('error', () => undefined);

    // The backend answers as a CGI program: headers, a blank line, then the body.
    let head = Buffer.alloc(0);
    let headersSent = false;
    child.stdout.on('data', (chunk: Buffer) => {
      if (headersSent) {
        res.write(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) return;
      let status = 200;
      for (const line of head.subarray(0, end).toString('utf8').split('\r\n')) {
        const separator = line.indexOf(':');
        const name = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10);
        else if (name) res.setHeader(name, value);
      }
      res.statusCode = status;
      headersSent = true;
      res.write(head.subarray(end + 4));
    });
    child.on('error', () => res.writeHead(500).end());
    child.on('close', () => {
      if (!headersSent) res.statusCode = 500;
      res.end();
    });
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const authenticated = carriesToken(req.headers.authorization);
    // Git first asks with a four-byte body when it isn't sure it's allowed; that isn't the push.
    const push =
      req.method === 'POST' &&
      url.pathname.endsWith('/git-receive-pack') &&
      req.headers['content-length'] !== '4';
    requests.push({
      method: req.method ?? '',
      target: req.url ?? '',
      authenticated,
      otherCredential: !authenticated && req.headers.authorization !== undefined,
      push,
    });
    if (!authenticated) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="workspace"' }).end();
      return;
    }
    if (!push) {
      backend(req, res, url);
      return;
    }
    markHeld();
    const timer = setTimeout(release, options.holdMs);
    void released.then(() => {
      clearTimeout(timer);
      backend(req, res, url);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    repoPath,
    requests,
    refs: () => git(repoPath, 'for-each-ref', '--format=%(refname) %(objectname)'),
    held,
    release: () => release(),
    close: async () => {
      release();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
