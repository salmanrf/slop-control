import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tempDir } from './git';

/**
 * A git server over HTTP on this machine, standing in for github.com's git transport. It serves
 * bare repos through git's own `http-backend`, and demands the token as the password, as GitHub does.
 */
export class GitHttpServer {
  readonly root = tempDir('slop-git-http-');
  /** The only password accepted. */
  token = '';
  /** Holds every answer back this long, so a test can look at the push while it runs. */
  delayMs = 0;
  /** The `authorization` header of every request, as received. */
  readonly authorizations: (string | undefined)[] = [];
  url = '';
  private server: Server | null = null;

  /** A bare repo that accepts pushes, at `<url>/<owner>/<repo>.git`. */
  createRepo(owner: string, repo: string): string {
    const path = join(this.root, owner, `${repo}.git`);
    mkdirSync(path, { recursive: true });
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', path]);
    execFileSync('git', ['config', 'http.receivepack', 'true'], { cwd: path });
    return path;
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      this.authorizations.push(req.headers.authorization);
      const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const password = basic ? Buffer.from(basic, 'base64').toString('utf8').split(':')[1] : null;
      const respond = (run: () => void) => setTimeout(run, this.delayMs);
      if (password !== this.token) {
        req.resume();
        respond(() => {
          res.writeHead(401, { 'www-authenticate': 'Basic realm="git"' });
          res.end();
        });
        return;
      }

      const url = new URL(req.url!, this.url);
      const backend = spawn('git', ['http-backend'], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: this.root,
          GIT_HTTP_EXPORT_ALL: '1',
          REQUEST_METHOD: req.method!,
          PATH_INFO: url.pathname,
          QUERY_STRING: url.search.slice(1),
          CONTENT_TYPE: req.headers['content-type'] ?? '',
          HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
          REMOTE_USER: 'pusher',
          REMOTE_ADDR: '127.0.0.1',
        },
      });
      req.pipe(backend.stdin);
      const chunks: Buffer[] = [];
      backend.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      backend.on('close', () => {
        const output = Buffer.concat(chunks);
        const split = output.indexOf('\r\n\r\n');
        const head = output.subarray(0, split).toString('utf8');
        let status = 200;
        const headers: Record<string, string> = {};
        for (const line of head.split('\r\n')) {
          const colon = line.indexOf(':');
          const name = line.slice(0, colon).toLowerCase();
          const value = line.slice(colon + 1).trim();
          if (name === 'status') status = Number(value.split(' ')[0]);
          else if (name) headers[name] = value;
        }
        respond(() => {
          res.writeHead(status, headers);
          res.end(output.subarray(split + 4));
        });
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.closeAllConnections();
      this.server.close(() => resolve());
    });
  }
}
