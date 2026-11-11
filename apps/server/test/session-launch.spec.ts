import type { PhaseSetup, Session } from '@slop-control/shared';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './support/git';
import { TrackerAuthError, TrackerUnavailableError } from '../src/tickets/tracker';
import { ticket } from './support/fake-tracker';
import { resetDatabase } from './support/test-app';
import {
  completeSession,
  createHarness,
  KEY,
  linkSecondRepo,
  seedWorkspace,
  startSession,
  ticketPath,
  waitForSession,
  type Harness,
  type Seeded,
  type TicketRef,
} from './support/session-harness';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const PHASES = [
  ['investigation', '.slop/investigation.md', false],
  ['planning', '.slop/plan.md', false],
  ['implementation', '.slop/implementation-report.md', true],
  ['code_review', '.slop/review-report.md', false],
] as const;

describe('starting a session', () => {
  let h: Harness;
  let seeded: Seeded;
  let workspaceId: string;
  let clone: string;

  const post = (body: object, ref: TicketRef = seeded, key = KEY) =>
    h.api.post(`${ticketPath(ref, key)}/sessions`).send(body);
  const history = async (ref: TicketRef = seeded, key = KEY) =>
    (await h.api.get(`${ticketPath(ref, key)}/sessions`)).body as Session[];
  const phaseSetups = async () =>
    (await h.api.get(`/workspaces/${workspaceId}/phase-setups`)).body as PhaseSetup[];

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.runtime.readiness = { ready: true };
    h.runtime.throwOnStart = null;
    h.tracker.reset();
    seeded = await seedWorkspace(h);
    ({ workspaceId, clone } = seeded);
  });
  afterAll(() => h.close());

  it('records the session, creates its worktree, and starts the runtime there', async () => {
    const res = await post({ phase: 'investigation' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      workspaceId,
      linkedRepoId: seeded.repoId,
      ticketSourceId: seeded.sourceId,
      ticketKey: KEY,
      ticketTitle: `Title of ${KEY}`,
      phase: 'investigation',
      round: 1,
      status: 'starting',
      statusReason: null,
      runtimeSessionId: null,
      resumeCommand: null,
      artifactStatus: null,
      endedAt: null,
      worktreeRemovedAt: null,
    });
    const shortId = res.body.id.slice(0, 8);
    expect(res.body.branch).toBe(`slop/acme-widgets-1/${shortId}`);
    expect(existsSync(res.body.worktreePath)).toBe(true);
    expect(git(res.body.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(res.body.branch);
    expect(h.runtime.lastRun.input).toMatchObject({
      cwd: res.body.worktreePath,
      setup: { permissionMode: 'auto' },
    });
  });

  it.each(PHASES)(
    'records the %s setup, starting point, and an empty list of inputs and flags',
    async (phase, artifactPath, mayChangeCode) => {
      const setup = (await phaseSetups()).find((item) => item.phase === phase)!;
      const session = await startSession(h, seeded, phase);
      expect(session.setup).toEqual({
        instruction: setup.instruction,
        scope: { mayChangeCode },
        stopCondition: { requiredArtifactPath: artifactPath },
        userLevelSource: false,
      });
      expect(session.baseRef).toBe('origin/main');
      expect(session.baseCommit).toBe(git(clone, 'rev-parse', 'origin/main'));
      expect(session.inputArtifacts).toEqual([]);
      expect(session.scopeFlags).toEqual([]);
    },
  );

  it.each(PHASES)(
    'builds the %s brief from the ticket, the instruction, and the baseline scope',
    async (phase, artifactPath) => {
      const setup = (await phaseSetups()).find((item) => item.phase === phase)!;
      const session = await startSession(h, seeded, phase);
      expect(session.brief).toContain(`Title of ${KEY}`);
      expect(session.brief).toContain(`Body of ${KEY}`);
      expect(session.brief).toContain(setup.instruction);
      expect(session.brief).toContain(artifactPath);
      expect(session.brief).toContain("can't push");
      expect(session.brief).toContain('GitHub');
      expect((h.runtime.lastRun.input as { brief: string }).brief).toBe(session.brief);
    },
  );

  it.each(PHASES)(
    'gives the runtime the %s scope and user-level source switch from the recorded setup',
    async (phase, _path, mayChangeCode) => {
      const session = await startSession(h, seeded, phase);
      expect(h.runtime.starts.at(-1)!.setup).toEqual({
        permissionMode: 'auto',
        scope: session.setup.scope,
        userLevelSource: session.setup.userLevelSource,
      });
      expect(session.setup.scope.mayChangeCode).toBe(mayChangeCode);
    },
  );

  it.each(PHASES)(
    'finds the %s artifact at the path in the recorded setup',
    async (phase, artifactPath) => {
      const session = await completeSession(h, seeded, phase, { content: '# Found\n' });
      expect(session.artifactStatus).toBe('complete');
      const artifact = await h.api.get(
        `/workspaces/${workspaceId}/sessions/${session.id}/artifact`,
      );
      expect(artifact.body).toMatchObject({ path: artifactPath, markdown: '# Found\n', round: 1 });
    },
  );

  it('ignores an artifact path or a setup sent by the client', async () => {
    const res = await post({
      phase: 'investigation',
      artifactPath: '.slop/elsewhere.md',
      requiredArtifactPath: '.slop/elsewhere.md',
      setup: {
        instruction: 'Do anything.',
        scope: { mayChangeCode: true },
        stopCondition: { requiredArtifactPath: '.slop/elsewhere.md' },
        userLevelSource: true,
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.setup).toMatchObject({
      scope: { mayChangeCode: false },
      stopCondition: { requiredArtifactPath: '.slop/investigation.md' },
      userLevelSource: false,
    });
    expect(res.body.brief).not.toContain('Do anything.');
  });

  it('starts nothing else when a session ends with its artifact', async () => {
    const runs = h.runtime.runs.length;
    await completeSession(h, seeded, 'investigation');
    expect(h.runtime.runs.length).toBe(runs + 1);
    expect(await history()).toHaveLength(1);
  });

  it("fails the session with the reason when the runtime can't enforce its scope", async () => {
    const session = await startSession(h, seeded);
    h.runtime.lastRun.ended(
      'error',
      "This host can't enforce a session's scope (bwrap must be installed), so sessions don't run here.",
    );
    const failed = await waitForSession(h, session, (s) => s.status === 'failed');
    expect(failed.statusReason).toContain("can't enforce a session's scope");
  });

  it.each([['automated_testing'], ['e2e_testing'], ['nonsense'], [undefined]])(
    'rejects the phase %p and creates nothing',
    async (phase) => {
      const runs = h.runtime.runs.length;
      const res = await post({ phase });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(h.runtime.runs.length).toBe(runs);
      expect(await history()).toEqual([]);
    },
  );

  it('allows several sessions on one ticket, each with its own worktree', async () => {
    const first = await startSession(h, seeded);
    const second = await startSession(h, seeded);
    expect(second.worktreePath).not.toBe(first.worktreePath);
    expect((await history()).map((s) => s.id)).toEqual([second.id, first.id]);
  });

  it('is blocked when the workspace has no linked repo', async () => {
    const empty = (await h.api.post('/workspaces').send({ name: 'empty' })).body.id as string;
    const sources = (await h.api.get(`/workspaces/${empty}/sources`)).body as { id: string }[];
    const created = await h.api.post(`/workspaces/${empty}/built-in-tickets`).send({ title: 'T' });
    const res = await post(
      { phase: 'investigation' },
      { workspaceId: empty, sourceId: sources[0]!.id },
      created.body.key,
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_LINKED_REPO');
  });

  it('starts a session on a built-in ticket with no source setup', async () => {
    const fresh = (await h.api.post('/workspaces').send({ name: 'fresh' })).body.id as string;
    const { repoId } = await linkSecondRepo(h, fresh);
    const sources = (await h.api.get(`/workspaces/${fresh}/sources`)).body as { id: string }[];
    const created = await h.api
      .post(`/workspaces/${fresh}/built-in-tickets`)
      .send({ title: 'Fix the login', body: 'It loops.' });
    expect(created.status).toBe(201);

    const ref = { workspaceId: fresh, sourceId: sources[0]!.id };
    const res = await post({ phase: 'investigation' }, ref, created.body.key);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ticketSourceId: ref.sourceId,
      ticketKey: created.body.key,
      ticketTitle: 'Fix the login',
      linkedRepoId: repoId,
    });
    expect(res.body.brief).toContain('It loops.');
  });

  it('returns 404 for an unknown workspace, source, or ticket', async () => {
    expect(
      (await post({ phase: 'investigation' }, { ...seeded, workspaceId: UNKNOWN })).status,
    ).toBe(404);
    expect(
      (await post({ phase: 'investigation' }, { workspaceId, sourceId: UNKNOWN })).status,
    ).toBe(404);
    const missing = await post({ phase: 'investigation' }, seeded, 'acme/widgets#99');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('NOT_FOUND');
    expect(await history()).toEqual([]);
    expect(await history(seeded, 'acme/widgets#99')).toEqual([]);
  });

  it("returns 404 for another workspace's source", async () => {
    const other = await seedWorkspace(h, 'other');
    const res = await post({ phase: 'investigation' }, { workspaceId, sourceId: other.sourceId });
    expect(res.status).toBe(404);
  });

  it('is blocked on a disconnected source, with a clear reason', async () => {
    await h.api.delete(`/workspaces/${workspaceId}/sources/${seeded.sourceId}`);
    const runs = h.runtime.runs.length;
    const res = await post({ phase: 'investigation' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SOURCE_DISCONNECTED');
    expect(h.runtime.runs.length).toBe(runs);
  });

  it.each([
    ['TRACKER_AUTH_FAILED', new TrackerAuthError('rejected')],
    ['TRACKER_UNAVAILABLE', new TrackerUnavailableError('down')],
  ])('reports %s and creates nothing', async (code, failure) => {
    h.tracker.failure = failure;
    const res = await post({ phase: 'investigation' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe(code);
    h.tracker.failure = null;
    expect(await history()).toEqual([]);
    expect(git(clone, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('fails with the runtime message when it is not ready, creating no session or worktree', async () => {
    h.runtime.readiness = {
      ready: false,
      message: "Claude Code isn't signed in. Run `claude auth login`.",
    };
    const res = await post({ phase: 'investigation' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      code: 'RUNTIME_NOT_READY',
      message: "Claude Code isn't signed in. Run `claude auth login`.",
    });
    expect(git(clone, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(await history()).toEqual([]);
  });

  it("is refused before a worktree exists when the host can't enforce a session's scope", async () => {
    h.runtime.readiness = {
      ready: false,
      message:
        "This host can't enforce a session's scope (bwrap must be installed), so sessions don't run here.",
    };
    const res = await post({ phase: 'investigation' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('RUNTIME_NOT_READY');
    expect(res.body.message).toContain("can't enforce a session's scope");
    expect(git(clone, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(await history()).toEqual([]);
  });

  it('records no session and leaves no files when git cannot create the worktree', async () => {
    const investigation = await completeSession(h, seeded, 'investigation');
    const worktreesDir = join(h.dataDir, 'worktrees', workspaceId);
    const before = readdirSync(worktreesDir);

    git(clone, 'update-ref', '-d', 'refs/remotes/origin/main');
    const res = await post({ phase: 'planning' });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('WORKTREE_CREATE_FAILED');
    expect((await history()).map((s) => s.id)).toEqual([investigation.id]);
    expect(readdirSync(worktreesDir)).toEqual(before);
  });

  describe('choosing the repo', () => {
    it('uses the repo given in the request', async () => {
      const second = await linkSecondRepo(h, workspaceId);
      const session = await startSession(h, seeded, 'investigation', {
        linkedRepoId: second.repoId,
      });
      expect(session.linkedRepoId).toBe(second.repoId);
      expect(git(second.clone, 'worktree', 'list')).toContain(session.worktreePath);
    });

    it("then the repo of the ticket's most recent session", async () => {
      const second = await linkSecondRepo(h, workspaceId);
      await startSession(h, seeded, 'investigation', { linkedRepoId: second.repoId });
      expect((await startSession(h, seeded, 'planning')).linkedRepoId).toBe(second.repoId);
    });

    it("then the source's default repo", async () => {
      const second = await linkSecondRepo(h, workspaceId);
      await h.api
        .patch(`/workspaces/${workspaceId}/sources/${seeded.sourceId}`)
        .send({ defaultLinkedRepoId: second.repoId });
      expect((await startSession(h, seeded)).linkedRepoId).toBe(second.repoId);
    });

    it('then the linked clone of the same GitHub repo', async () => {
      await linkSecondRepo(h, workspaceId);
      expect((await startSession(h, seeded)).linkedRepoId).toBe(seeded.repoId);
    });

    it("then the workspace's only repo", async () => {
      h.tracker.source('acme/other').add(ticket('acme/other#1'));
      const other = await h.api
        .post(`/workspaces/${workspaceId}/sources`)
        .send({ type: 'github_issues', githubOwner: 'acme', githubRepo: 'other' });
      const session = await startSession(
        h,
        { workspaceId, sourceId: other.body.id },
        'investigation',
        { key: 'acme/other#1' },
      );
      expect(session.linkedRepoId).toBe(seeded.repoId);
    });

    it('asks for a choice when nothing can be preselected', async () => {
      await linkSecondRepo(h, workspaceId);
      h.tracker.source('acme/other').add(ticket('acme/other#1'));
      const other = await h.api
        .post(`/workspaces/${workspaceId}/sources`)
        .send({ type: 'github_issues', githubOwner: 'acme', githubRepo: 'other' });
      const ref = { workspaceId, sourceId: other.body.id as string };
      const res = await post({ phase: 'investigation' }, ref, 'acme/other#1');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('REPO_CHOICE_REQUIRED');
      expect(await history(ref, 'acme/other#1')).toEqual([]);
    });

    it('returns 404 for an unknown repo, or one from another workspace', async () => {
      const other = await seedWorkspace(h, 'other');
      expect((await post({ phase: 'investigation', linkedRepoId: UNKNOWN })).status).toBe(404);
      expect((await post({ phase: 'investigation', linkedRepoId: other.repoId })).status).toBe(404);
      expect(await history()).toEqual([]);
    });
  });
});

describe('workspace isolation', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.reset();
  });
  afterAll(() => h.close());

  it("returns 404 for another workspace's session on every session route", async () => {
    const one = await seedWorkspace(h, 'one');
    const session = await startSession(h, one);
    const two = await seedWorkspace(h, 'two');

    const base = `/workspaces/${two.workspaceId}/sessions/${session.id}`;
    expect((await h.api.get(base)).status).toBe(404);
    expect((await h.api.get(`${base}/artifact`)).status).toBe(404);
    expect((await h.api.post(`${base}/stop`)).status).toBe(404);
    expect((await h.api.post(`${base}/messages`).send({ message: 'Carry on.' })).status).toBe(404);
    expect((await h.api.delete(`${base}/worktree`)).status).toBe(404);
    expect(h.runtime.lastRun.stopCalls).toBe(0);

    const list = await h.api.get(`${ticketPath(two)}/sessions`);
    expect(list.body).toEqual([]);
  });
});
