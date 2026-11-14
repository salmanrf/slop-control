import type { Session, SessionDiff } from '@slop-control/shared';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { implement } from './support/actions';
import { git, makeClone } from './support/git';
import {
  completeSession,
  createHarness,
  seedWorkspace,
  sendMessage,
  startSession,
  ticketPath,
  waitForSession,
  type Harness,
  type Seeded,
} from './support/session-harness';
import { resetDatabase } from './support/test-app';
import { TEST_DATABASE_URL } from './support/test-env';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('a session against its base', () => {
  let h: Harness;
  let seeded: Seeded;

  const diffPath = (session: { id: string }, ws = seeded.workspaceId) =>
    `/workspaces/${ws}/sessions/${session.id}/diff`;
  const diff = async (session: { id: string }) =>
    (await h.api.get(diffPath(session))).body as SessionDiff;

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.reset();
    seeded = await seedWorkspace(h);
  });
  afterAll(() => h.close());

  describe('the diff', () => {
    it("shows the session's committed changes per file, and its uncommitted files apart", async () => {
      const session = await implement(h, seeded);
      h.runtime.lastRun.writeFile('scratch.txt', 'not committed\n');
      h.runtime.lastRun.writeFile('README.md', '# widgets\nedited, not committed\n');

      const res = await h.api.get(diffPath(session));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        baseCommit: session.baseCommit,
        headCommit: git(session.worktreePath, 'rev-parse', 'HEAD'),
        commitCount: 1,
        truncated: false,
        files: [
          {
            path: 'feature.txt',
            previousPath: null,
            status: 'added',
            additions: 1,
            deletions: 0,
            binary: false,
            patch: expect.stringContaining('+the feature'),
          },
        ],
        // The report under `.slop/` is in neither list.
        uncommitted: [
          { path: 'README.md', state: 'modified' },
          { path: 'scratch.txt', state: 'untracked' },
        ],
      });
    });

    it('is empty for a session that changed nothing, in any phase', async () => {
      const session = await completeSession(h, seeded, 'investigation');
      expect(await diff(session)).toMatchObject({
        baseCommit: session.baseCommit,
        headCommit: session.baseCommit,
        commitCount: 0,
        files: [],
        uncommitted: [],
      });
    });

    it('shows what a read-only phase changed anyway', async () => {
      const session = await completeSession(h, seeded, 'investigation', {
        work: (run) => {
          run.writeFile('sneaky.txt', 'x\n');
          run.commit();
        },
      });
      expect((await diff(session)).files.map((file) => file.path)).toEqual(['sneaky.txt']);
    });

    it('is the same after the worktree is removed, without the uncommitted list', async () => {
      const session = await implement(h, seeded);
      const before = await diff(session);
      await h.api.delete(
        `/workspaces/${seeded.workspaceId}/sessions/${session.id}/worktree?force=true`,
      );
      expect(await diff(session)).toEqual({ ...before, uncommitted: null });
    });

    it('compares a session from before its starting commit was recorded with where it left its base', async () => {
      const session = await implement(h, seeded);
      const client = new Client({ connectionString: TEST_DATABASE_URL });
      await client.connect();
      await client.query('update session set base_commit = null where id = $1', [session.id]);
      await client.end();
      // The base has moved on since, which must not show as the session's change.
      writeFileSync(join(seeded.clone, 'later.txt'), 'on main later\n');
      git(seeded.clone, 'add', '.');
      git(seeded.clone, 'commit', '-qm', 'later on main');
      git(seeded.clone, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

      const result = await diff(session);
      expect(result.baseCommit).toBe(session.baseCommit);
      expect(result.commitCount).toBe(1);
      expect(result.files.map((file) => file.path)).toEqual(['feature.txt']);
    });

    it("returns 404 for an unknown session, another workspace's, and a deleted branch", async () => {
      const session = await implement(h, seeded);
      const other = (await h.api.post('/workspaces').send({ name: 'other' })).body.id as string;
      expect((await h.api.get(diffPath({ id: UNKNOWN }))).status).toBe(404);
      expect((await h.api.get(diffPath(session, other))).status).toBe(404);

      await h.api.delete(
        `/workspaces/${seeded.workspaceId}/sessions/${session.id}/worktree?force=true`,
      );
      git(seeded.clone, 'branch', '-D', session.branch);
      const gone = await h.api.get(diffPath(session));
      expect(gone.status).toBe(404);
      expect(gone.body.code).toBe('NOT_FOUND');
    });
  });

  describe('fetching the base', () => {
    /**
     * Links a clone the usual way, then points its origin at a repo on this machine, so the
     * server's fetch is a real one that needs no network.
     */
    async function seedWithLocalOrigin(): Promise<Seeded & { origin: string }> {
      const origin = makeClone({ origin: null });
      git(seeded.clone, 'remote', 'set-url', 'origin', origin);
      git(seeded.clone, 'fetch', '-q', 'origin');
      return { ...seeded, origin };
    }
    function commitOnOrigin(origin: string, file: string): string {
      writeFileSync(join(origin, file), 'added on the remote after the clone\n');
      git(origin, 'add', '.');
      git(origin, 'commit', '-qm', `add ${file}`);
      return git(origin, 'rev-parse', 'HEAD');
    }
    const originMain = (clone: string) => git(clone, 'rev-parse', 'origin/main');

    it('starts a session from what the remote has now', async () => {
      const local = await seedWithLocalOrigin();
      const latest = commitOnOrigin(local.origin, 'fresh.txt');

      const session = await startSession(h, local);
      expect(session.baseFetchFailed).toBe(false);
      expect(session.baseCommit).toBe(latest);
      expect(existsSync(join(session.worktreePath, 'fresh.txt'))).toBe(true);
      // The session itself was given no way to reach the remote: the server did the fetch.
      expect(h.runtime.starts.at(-1)!.cwd).toBe(session.worktreePath);
    });

    it('starts anyway when the remote cannot be reached, and says the base may be behind', async () => {
      const before = originMain(seeded.clone);
      const res = await h.api
        .post(`${ticketPath(seeded)}/sessions`)
        .send({ phase: 'investigation' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'starting', round: 1, baseFetchFailed: true });
      expect(res.body.baseCommit).toBe(before);
      const read = await h.api.get(`/workspaces/${seeded.workspaceId}/sessions/${res.body.id}`);
      expect(read.body.baseFetchFailed).toBe(true);
    });

    it('fetches nothing for a code review that starts from an implementation branch', async () => {
      const implemented = await implement(h, seeded);
      const reviewed = await startSession(h, seeded, 'code_review');
      expect(reviewed.baseRef).toBe(implemented.branch);
      // The remote can't be reached here, so a fetch would have been recorded as failed.
      expect(reviewed.baseFetchFailed).toBe(false);
    });

    it('fetches nothing for the launch preview or a follow-up round', async () => {
      const local = await seedWithLocalOrigin();
      const session = await completeSession(h, local, 'investigation');
      const fetched = originMain(local.clone);
      commitOnOrigin(local.origin, 'even-later.txt');

      const preview = await h.api.get(`${ticketPath(local)}/launch-preview`);
      expect(preview.body.baseRef).toBe('origin/main');
      expect(originMain(local.clone)).toBe(fetched);

      await sendMessage(h, session);
      h.runtime.lastRun.ended('success');
      const after = await waitForSession(h, session, (s: Session) => s.status === 'ended');
      expect(after.baseFetchFailed).toBe(false);
      expect(originMain(local.clone)).toBe(fetched);
      expect(readFileSync(join(local.clone, 'README.md'), 'utf8')).toBe('# widgets\n');
    });
  });
});
