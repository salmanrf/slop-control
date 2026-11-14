import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { tempDir } from './support/git';
import { assertNoRealSshInReach, type SmokeGuardOptions } from './support/smoke-guard';

/** Looks like a private key to the guard, and to nothing else. Built here so no scanner takes the file for a leak. */
function fakePrivateKey(label: string): string {
  const kind = ['OPENSSH', 'PRIVATE', 'KEY'].join(' ');
  return `-----BEGIN ${kind}-----\n${Buffer.from(label).toString('base64')}\n-----END ${kind}-----\n`;
}

const PLANTED_KEY = fakePrivateKey('planted');
const REAL_KEY = fakePrivateKey('real');

/** A home folder as the planted logins make it: one planted key and a configuration that names it. */
function plantedHome(): string {
  const home = tempDir('slop-guard-planted-');
  mkdirSync(join(home, '.ssh'), { mode: 0o700 });
  writeFileSync(join(home, '.ssh/id_planted'), PLANTED_KEY, { mode: 0o600 });
  writeFileSync(join(home, '.ssh/id_planted.pub'), 'ssh-ed25519 AAAA planted\n');
  return home;
}

/** Stands in for the home folder in the user record. */
function userRecordHome(files: Record<string, string> = {}): string {
  const home = tempDir('slop-guard-home-');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(home, path, '..'), { recursive: true });
    writeFileSync(join(home, path), content, { mode: 0o600 });
  }
  return home;
}

/** Every entry under a folder with its mode, modification time, and content. */
function snapshot(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      const stats = statSync(path);
      const content = stats.isFile() ? readFileSync(path, 'base64') : '';
      return `${path} ${stats.mode} ${stats.mtimeMs} ${content}`;
    })
    .sort();
}

describe('assertNoRealSshInReach', () => {
  const planted = { home: plantedHome(), sshAuthSockBefore: null as string | null };
  const servers: Server[] = [];
  const children: ChildProcess[] = [];

  /** The guard as the smoke test calls it, with the user record and the environment replaced. */
  const guard = (home: string, options: SmokeGuardOptions = {}, logins = planted) =>
    assertNoRealSshInReach(logins, { home, env: {}, systemSshConfig: null, ...options });

  /** Something that accepts connections on a socket, as an agent holding keys would. */
  const listeningSocket = async (): Promise<string> => {
    const path = join(tempDir('slop-agent-'), 'agent.sock');
    const server = createServer((socket) => socket.destroy());
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(path, resolve));
    return path;
  };

  afterAll(async () => {
    children.forEach((child) => child.kill());
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  });

  describe('private keys', () => {
    it('throws naming a readable private key that is not a planted one (SG-01)', () => {
      const home = userRecordHome({ '.ssh/id_ed25519': REAL_KEY });
      expect(() => guard(home)).toThrow(join(home, '.ssh/id_ed25519'));
    });

    it('passes when the folder holds only the planted keys (SG-02)', () => {
      const home = userRecordHome({
        '.ssh/id_planted': PLANTED_KEY,
        '.ssh/id_planted.pub': 'ssh-ed25519 AAAA planted\n',
        '.ssh/config': 'Host *\n  IdentityFile ~/.ssh/id_planted\n  IdentitiesOnly yes\n',
      });
      expect(() => guard(home)).not.toThrow();
    });

    it('passes when there is no .ssh folder (SG-03)', () => {
      expect(() => guard(userRecordHome())).not.toThrow();
    });

    it('goes by the user record, not HOME (SG-04)', () => {
      const home = userRecordHome({ '.ssh/id_rsa': REAL_KEY });
      const env = { HOME: planted.home };
      expect(() => guard(home, { env })).toThrow(join(home, '.ssh/id_rsa'));
    });

    it('reads the real user record when it is given no other home', () => {
      const saved = process.env.HOME;
      process.env.HOME = userRecordHome({ '.ssh/id_rsa': REAL_KEY });
      try {
        // Whatever this machine's user holds, the key under HOME is never what's reported.
        let message = '';
        try {
          assertNoRealSshInReach(planted, { env: {}, systemSshConfig: null });
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).not.toContain(process.env.HOME);
      } finally {
        process.env.HOME = saved;
      }
    });

    const asRoot = process.getuid?.() === 0;
    (asRoot ? it.skip : it)('passes when the key and its folder are unreadable (SG-05)', () => {
      const home = userRecordHome({ '.ssh/id_ed25519': REAL_KEY });
      chmodSync(join(home, '.ssh/id_ed25519'), 0o000);
      expect(() => guard(home)).not.toThrow();
      chmodSync(join(home, '.ssh'), 0o000);
      try {
        expect(() => guard(home)).not.toThrow();
      } finally {
        chmodSync(join(home, '.ssh'), 0o700);
      }
    });

    it('passes with only public keys, known_hosts, and a config (SG-06)', () => {
      const home = userRecordHome({
        '.ssh/id_ed25519.pub': 'ssh-ed25519 AAAA someone\n',
        '.ssh/known_hosts': 'github.com ssh-ed25519 AAAA\n',
        '.ssh/config': 'Host github.com\n  User git\n  IdentityAgent none\n',
      });
      expect(() => guard(home)).not.toThrow();
    });

    it('throws naming a key under another name, and one an IdentityFile line points to elsewhere (SG-07)', () => {
      const oddName = userRecordHome({ '.ssh/keys/work-laptop': REAL_KEY });
      expect(() => guard(oddName)).toThrow(join(oddName, '.ssh/keys/work-laptop'));

      const elsewhere = userRecordHome({
        'vault/deploy': REAL_KEY,
        '.ssh/config': 'Include conf.d/*\n',
        '.ssh/conf.d/work': 'Host work\n  IdentityFile "~/vault/deploy"\n',
      });
      expect(() => guard(elsewhere)).toThrow(join(elsewhere, 'vault/deploy'));
    });
  });

  describe('agents', () => {
    it('throws naming an agent socket that SSH_AUTH_SOCK reaches (SG-08)', async () => {
      const socket = await listeningSocket();
      expect(() => guard(userRecordHome(), { env: { SSH_AUTH_SOCK: socket } })).toThrow(socket);
    });

    it('throws for the agent SSH_AUTH_SOCK named before the planted logins took it out', async () => {
      const socket = await listeningSocket();
      const logins = { ...planted, sshAuthSockBefore: socket };
      expect(() => guard(userRecordHome(), {}, logins)).toThrow(socket);
    });

    it('passes when nothing listens at SSH_AUTH_SOCK, or it is not set (SG-09)', () => {
      const nothing = join(tempDir('slop-agent-'), 'agent.sock');
      expect(() => guard(userRecordHome(), { env: { SSH_AUTH_SOCK: nothing } })).not.toThrow();
      expect(() => guard(userRecordHome(), { env: {} })).not.toThrow();
    });

    it('throws for a reachable IdentityAgent in the configuration, with SSH_AUTH_SOCK unset (SG-10)', async () => {
      const socket = await listeningSocket();
      const home = userRecordHome({
        '.ssh/config': `Host github.com\n  IdentityAgent "${socket}"\n`,
      });
      expect(() => guard(home)).toThrow(socket);
      expect(() => guard(home)).toThrow('IdentityAgent');

      const system = join(tempDir('slop-guard-etc-'), 'ssh_config');
      writeFileSync(system, `Host *\n  IdentityAgent=${socket}\n`);
      expect(() => guard(userRecordHome(), { systemSshConfig: system })).toThrow(socket);
    });

    it('does not take `IdentityAgent none`, `SSH_AUTH_SOCK`, or a dead socket for an agent', () => {
      const dead = join(tempDir('slop-agent-'), 'agent.sock');
      const home = userRecordHome({
        '.ssh/config': [
          'Host a\n  IdentityAgent none',
          'Host b\n  IdentityAgent SSH_AUTH_SOCK',
          'Host c\n  IdentityAgent $UNSET_AGENT',
          `Host d\n  IdentityAgent ${dead}`,
          'Host e\n  IdentityAgent ~/missing/agent.sock',
        ].join('\n'),
      });
      expect(() => guard(home)).not.toThrow();
    });

    const hasSshAgent = spawnSync('ssh-agent', ['-h']).error === undefined;
    (hasSshAgent ? it : it.skip)(
      'passes for an agent that answers that it holds no identity',
      async () => {
        const socket = join(tempDir('slop-agent-'), 'agent.sock');
        children.push(spawn('ssh-agent', ['-D', '-a', socket], { stdio: 'ignore' }));
        for (let i = 0; i < 100 && !existsSync(socket); i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(existsSync(socket)).toBe(true);
        expect(() => guard(userRecordHome(), { env: { SSH_AUTH_SOCK: socket } })).not.toThrow();
      },
    );
  });

  it('gives both supported ways to run in every refusal (SG-11)', async () => {
    const socket = await listeningSocket();
    const refusals = [
      () => guard(userRecordHome({ '.ssh/id_ed25519': REAL_KEY })),
      () => guard(userRecordHome(), { env: { SSH_AUTH_SOCK: socket } }),
    ];
    for (const refusal of refusals) {
      expect(refusal).toThrow('macOS user with no SSH keys');
      expect(refusal).toThrow('CLAUDE_CODE_OAUTH_TOKEN');
      expect(refusal).toThrow('keys made unreadable');
    }
  });

  it('changes nothing in the home folder, whether it passes or refuses (SG-12)', () => {
    const refused = userRecordHome({
      '.ssh/id_ed25519': REAL_KEY,
      '.ssh/config': 'Host *\n  IdentityFile ~/.ssh/id_ed25519\n',
    });
    const passed = userRecordHome({ '.ssh/id_planted': PLANTED_KEY });
    const before = [snapshot(refused), snapshot(passed), snapshot(planted.home)];

    expect(() => guard(refused)).toThrow();
    expect(() => guard(passed)).not.toThrow();

    expect([snapshot(refused), snapshot(passed), snapshot(planted.home)]).toEqual(before);
  });

  it('has no override: no environment variable or option lets a real key through (SG-13)', () => {
    const home = userRecordHome({ '.ssh/id_ed25519': REAL_KEY });
    const env = Object.fromEntries(
      [
        'SMOKE_GUARD',
        'SMOKE_GUARD_OFF',
        'SKIP_SMOKE_GUARD',
        'SKIP_SSH_GUARD',
        'SLOP_SKIP_SSH_GUARD',
        'ALLOW_REAL_SSH',
        'CLAUDE_SMOKE_FORCE',
        'FORCE',
        'CI',
      ].flatMap((name) => [[name, '1']]),
    );
    expect(() => guard(home, { env })).toThrow(join(home, '.ssh/id_ed25519'));
    const options = { override: true, force: true, skip: true } as SmokeGuardOptions;
    expect(() => guard(home, options)).toThrow(join(home, '.ssh/id_ed25519'));
    // Nor does calling the real home the planted one.
    const logins = { home, sshAuthSockBefore: null };
    expect(() => guard(home, {}, logins)).toThrow(join(home, '.ssh/id_ed25519'));
  });
});
