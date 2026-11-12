import type { PhaseSetup, Session, TicketSource } from '@slop-control/shared';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PHASE_SETUPS, LAUNCHABLE_PHASES } from '../src/phase-setups/phase-defaults';
import { ticket } from './support/fake-tracker';
import { git, makeClone, tempDir } from './support/git';
import {
  applyMigrations,
  createEmptyDatabase,
  dropDatabase,
  INITIAL_MIGRATION,
  migrationFiles,
  withClient,
} from './support/migration-db';
import {
  createHarness,
  reportStarted,
  sendMessage,
  startSession,
  ticketPath,
  waitForSession,
  type Harness,
} from './support/session-harness';

const DATABASE = 'slop_control_migration_test';
const EMPTY_DATABASE = 'slop_control_migration_empty_test';

const ALPHA = 'aaaaaaaa-0000-4000-8000-000000000001';
const BETA = 'bbbbbbbb-0000-4000-8000-000000000002';
const REPO = {
  widgets: 'aaaaaaaa-1111-4000-8000-000000000001',
  widgetsSecondClone: 'aaaaaaaa-1111-4000-8000-000000000002',
  gadgets: 'aaaaaaaa-1111-4000-8000-000000000003',
  thing: 'bbbbbbbb-1111-4000-8000-000000000001',
};
const SESSION = {
  ended: 'aaaaaaaa-2222-4000-8000-000000000001',
  failed: 'aaaaaaaa-2222-4000-8000-000000000002',
  stopped: 'aaaaaaaa-2222-4000-8000-000000000003',
  running: 'aaaaaaaa-2222-4000-8000-000000000004',
  starting: 'aaaaaaaa-2222-4000-8000-000000000005',
  beta: 'bbbbbbbb-2222-4000-8000-000000000001',
};
const SPRINT_1 = {
  investigation: {
    instruction:
      'Investigate this ticket without changing code, and write your findings as markdown to `.slop/investigation.md`.',
    path: '.slop/investigation.md',
    mayChangeCode: false,
  },
  planning: {
    instruction:
      'Plan the work for this ticket without changing code, and write the plan as markdown to `.slop/plan.md`.',
    path: '.slop/plan.md',
    mayChangeCode: false,
  },
  implementation: {
    instruction:
      'Implement this ticket, commit your work, and write a report as markdown to `.slop/implementation-report.md`.',
    path: '.slop/implementation-report.md',
    mayChangeCode: true,
  },
  code_review: {
    instruction:
      'Review the code for this ticket without changing it, and write your review as markdown to `.slop/review-report.md`.',
    path: '.slop/review-report.md',
    mayChangeCode: false,
  },
} as const;
type Sprint1Phase = keyof typeof SPRINT_1;

const brief = (key: string, phase: Sprint1Phase) =>
  `Title of ${key}\n\nBody of ${key}\n\n${SPRINT_1[phase].instruction}`;

/**
 * A database at the Sprint 1 schema is seeded as Sprint 1 would have left it, then upgraded.
 * Everything after that is read through the API. The cases run in order and share the database.
 */
describe('upgrading from the Sprint 1 schema', () => {
  let h: Harness;
  let url: string;
  let dataDir: string;
  let clone: string;
  let endedWorktree: string;
  const sourceByLabel = new Map<string, TicketSource>();

  const session = async (id: string, workspaceId = ALPHA) =>
    (await h.api.get(`/workspaces/${workspaceId}/sessions/${id}`)).body as Session;
  const widgets = () => ({ workspaceId: ALPHA, sourceId: sourceByLabel.get('acme/widgets')!.id });

  beforeAll(async () => {
    url = await createEmptyDatabase(DATABASE);
    await applyMigrations(url, [INITIAL_MIGRATION]);

    dataDir = tempDir('slop-data-');
    clone = makeClone();
    const secondClone = makeClone();
    const gadgetsClone = makeClone({ origin: 'git@github.com:acme/gadgets.git' });
    const thingClone = makeClone({ origin: 'git@github.com:other/thing.git' });
    // A real worktree, as Sprint 1 laid them out, so a follow-up and a removal can act on it.
    endedWorktree = join(dataDir, 'worktrees', ALPHA, 'acme-widgets-1-aaaaaaaa');
    mkdirSync(join(dataDir, 'worktrees', ALPHA), { recursive: true });
    writeFileSync(join(clone, '.git/info/exclude'), '/.slop/\n', { flag: 'a' });
    git(
      clone,
      'worktree',
      'add',
      '--quiet',
      '--no-track',
      '-b',
      'slop/acme-widgets-1/aaaaaaaa',
      endedWorktree,
      'origin/main',
    );
    mkdirSync(join(endedWorktree, '.slop'));
    writeFileSync(join(endedWorktree, '.slop/investigation.md'), '# Old findings');

    await withClient(url, async (client) => {
      await client.query(`insert into workspace (id, name) values ($1, 'alpha'), ($2, 'beta')`, [
        ALPHA,
        BETA,
      ]);
      await client.query(
        `insert into linked_repo (id, workspace_id, local_path, github_owner, github_repo, default_branch, created_at)
         values ($1, $5, $7, 'acme', 'widgets', 'main', now() - interval '3 days'),
                ($2, $5, $8, 'Acme', 'Widgets', 'main', now() - interval '2 days'),
                ($3, $5, $9, 'acme', 'gadgets', 'trunk', now() - interval '1 day'),
                ($4, $6, $10, 'other', 'thing', 'main', now())`,
        [
          REPO.widgets,
          REPO.widgetsSecondClone,
          REPO.gadgets,
          REPO.thing,
          ALPHA,
          BETA,
          clone,
          secondClone,
          gadgetsClone,
          thingClone,
        ],
      );
      const insert = (values: unknown[]) =>
        client.query(
          `insert into session
             (id, workspace_id, linked_repo_id, ticket_key, phase, status, status_reason, brief,
              worktree_path, branch, worktree_removed_at, runtime_session_id, artifact_status,
              started_at, ended_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          values,
        );
      const gone = join(dataDir, 'worktrees', 'gone');
      await insert([
        SESSION.ended,
        ALPHA,
        REPO.widgets,
        'acme/widgets#1',
        'investigation',
        'ended',
        null,
        brief('acme/widgets#1', 'investigation'),
        endedWorktree,
        'slop/acme-widgets-1/aaaaaaaa',
        null,
        'rt-old-1',
        'complete',
        '2026-11-03T10:00:00Z',
        '2026-11-03T10:05:00Z',
      ]);
      await insert([
        SESSION.failed,
        ALPHA,
        REPO.widgets,
        'acme/widgets#1',
        'planning',
        'failed',
        'It broke.',
        brief('acme/widgets#1', 'planning'),
        `${gone}-2`,
        'slop/acme-widgets-1/bbbbbbbb',
        '2026-11-03T12:00:00Z',
        null,
        'incomplete',
        '2026-11-03T11:00:00Z',
        '2026-11-03T11:01:00Z',
      ]);
      await insert([
        SESSION.stopped,
        ALPHA,
        REPO.widgetsSecondClone,
        'Acme/Widgets#2',
        'implementation',
        'stopped',
        null,
        brief('Acme/Widgets#2', 'implementation'),
        `${gone}-3`,
        'slop/Acme-Widgets-2/cccccccc',
        null,
        'rt-old-3',
        'incomplete',
        '2026-11-03T13:00:00Z',
        '2026-11-03T13:02:00Z',
      ]);
      await insert([
        SESSION.running,
        ALPHA,
        REPO.gadgets,
        'acme/gadgets#5',
        'code_review',
        'running',
        null,
        brief('acme/gadgets#5', 'code_review'),
        `${gone}-4`,
        'slop/acme-gadgets-5/dddddddd',
        null,
        'rt-old-4',
        null,
        '2026-11-03T14:00:00Z',
        null,
      ]);
      await insert([
        SESSION.starting,
        ALPHA,
        REPO.widgets,
        'acme/widgets#1',
        'investigation',
        'starting',
        null,
        brief('acme/widgets#1', 'investigation'),
        `${gone}-5`,
        'slop/acme-widgets-1/eeeeeeee',
        null,
        null,
        null,
        '2026-11-03T15:00:00Z',
        null,
      ]);
      await insert([
        SESSION.beta,
        BETA,
        REPO.thing,
        'other/thing#9',
        'investigation',
        'ended',
        null,
        brief('other/thing#9', 'investigation'),
        `${gone}-6`,
        'slop/other-thing-9/ffffffff',
        '2026-11-03T17:00:00Z',
        'rt-old-6',
        'complete',
        '2026-11-03T16:00:00Z',
        '2026-11-03T16:03:00Z',
      ]);
      await client.query(
        `insert into session_artifact (session_id, round, path, markdown)
         values ($1, 1, '.slop/investigation.md', '# Old findings'),
                ($2, 1, '.slop/investigation.md', '# Beta findings')`,
        [SESSION.ended, SESSION.beta],
      );
    });

    // MG-07, first half: both of the release's migrations, together, on a database with data.
    await applyMigrations(
      url,
      migrationFiles().filter((file) => file !== INITIAL_MIGRATION),
    );

    h = await createHarness({ databaseUrl: url, dataDir });
    h.tracker.add(ticket('acme/widgets#1'));
    for (const source of (await h.api.get(`/workspaces/${ALPHA}/sources`)).body as TicketSource[]) {
      sourceByLabel.set(source.label, source);
    }
  });

  afterAll(async () => {
    await h?.close();
    await dropDatabase(DATABASE);
    await dropDatabase(EMPTY_DATABASE);
  });

  it('gives every workspace the four default phase setups, with the user-level source off (MG-01)', async () => {
    for (const workspaceId of [ALPHA, BETA]) {
      const res = await h.api.get(`/workspaces/${workspaceId}/phase-setups`);
      expect(res.status).toBe(200);
      const setups = res.body as PhaseSetup[];
      expect(setups.map((setup) => setup.phase)).toEqual([...LAUNCHABLE_PHASES]);
      for (const setup of setups) {
        const sprint1 = SPRINT_1[setup.phase];
        expect(setup).toMatchObject({
          workspaceId,
          instruction: sprint1.instruction,
          scope: { mayChangeCode: sprint1.mayChangeCode },
          stopCondition: { requiredArtifactPath: sprint1.path },
          userLevelSource: false,
        });
        // The migration's copy and the one new workspaces get must not drift apart.
        expect(setup).toMatchObject(DEFAULT_PHASE_SETUPS[setup.phase]);
      }
    }
  });

  it("connects each linked repo's Issues, once per repo, beside a built-in tracker", async () => {
    const alpha = (await h.api.get(`/workspaces/${ALPHA}/sources`)).body as TicketSource[];
    expect(alpha.map((source) => source.type)).toEqual([
      'built_in',
      'github_issues',
      'github_issues',
    ]);
    // Two clones of one repo make one source, whose default is the oldest clone.
    expect(alpha.filter((source) => source.label.toLowerCase() === 'acme/widgets')).toHaveLength(1);
    expect(sourceByLabel.get('acme/widgets')).toMatchObject({
      defaultLinkedRepoId: REPO.widgets,
      hasCredential: false,
      disconnectedAt: null,
    });
    expect(sourceByLabel.get('acme/gadgets')).toMatchObject({ defaultLinkedRepoId: REPO.gadgets });
    expect(alpha[0]!.canCreateTickets).toBe(false);

    const beta = (await h.api.get(`/workspaces/${BETA}/sources`)).body as TicketSource[];
    expect(beta.map((source) => source.label)).toEqual(['Built-in', 'other/thing']);
  });

  it('reads every old session with the setup it really ran with (MG-02)', async () => {
    const cases: [string, string, Sprint1Phase, string, string][] = [
      [SESSION.ended, ALPHA, 'investigation', 'acme/widgets', 'acme/widgets#1'],
      [SESSION.failed, ALPHA, 'planning', 'acme/widgets', 'acme/widgets#1'],
      [SESSION.stopped, ALPHA, 'implementation', 'acme/widgets', 'Acme/Widgets#2'],
      [SESSION.running, ALPHA, 'code_review', 'acme/gadgets', 'acme/gadgets#5'],
      [SESSION.starting, ALPHA, 'investigation', 'acme/widgets', 'acme/widgets#1'],
    ];
    for (const [id, workspaceId, phase, label, key] of cases) {
      const res = await h.api.get(`/workspaces/${workspaceId}/sessions/${id}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id,
        phase,
        round: 1,
        ticketKey: key,
        ticketTitle: `Title of ${key}`,
        ticketSourceId: sourceByLabel.get(label)!.id,
        brief: brief(key, phase),
        setup: {
          instruction: SPRINT_1[phase].instruction,
          scope: { mayChangeCode: SPRINT_1[phase].mayChangeCode },
          stopCondition: { requiredArtifactPath: SPRINT_1[phase].path },
          userLevelSource: true,
        },
        baseRef: phase === 'code_review' ? 'origin/trunk' : 'origin/main',
        baseCommit: null,
        inputArtifacts: [],
        scopeFlags: [],
      });
    }
    const beta = await session(SESSION.beta, BETA);
    expect(beta).toMatchObject({
      round: 1,
      ticketTitle: 'Title of other/thing#9',
      baseCommit: null,
    });
    expect(beta.setup.userLevelSource).toBe(true);
  });

  it('keeps finished sessions as they were, and closes the ones the old server left running', async () => {
    expect(await session(SESSION.ended)).toMatchObject({
      status: 'ended',
      artifactStatus: 'complete',
      runtimeSessionId: 'rt-old-1',
      worktreeRemovedAt: null,
    });
    expect(await session(SESSION.failed)).toMatchObject({
      status: 'failed',
      statusReason: 'It broke.',
      artifactStatus: 'incomplete',
    });
    expect((await session(SESSION.failed)).worktreeRemovedAt).not.toBeNull();
    expect(await session(SESSION.stopped)).toMatchObject({ status: 'stopped' });
    for (const id of [SESSION.running, SESSION.starting]) {
      expect(await session(id)).toMatchObject({ status: 'failed', scopeFlags: [] });
    }
  });

  it("reads each ticket's history through its source (MG-02)", async () => {
    const history = await h.api.get(`${ticketPath(widgets(), 'acme/widgets#1')}/sessions`);
    expect(history.status).toBe(200);
    expect(history.body.map((item: Session) => item.id)).toEqual([
      SESSION.starting,
      SESSION.failed,
      SESSION.ended,
    ]);
    // The second clone's session is on the same source as the first clone's.
    const second = await h.api.get(`${ticketPath(widgets(), 'Acme/Widgets#2')}/sessions`);
    expect(second.body.map((item: Session) => item.id)).toEqual([SESSION.stopped]);
  });

  it("reads an old session's artifact unchanged, with or without its worktree (MG-03)", async () => {
    const alpha = await h.api.get(`/workspaces/${ALPHA}/sessions/${SESSION.ended}/artifact`);
    expect(alpha.body).toMatchObject({
      round: 1,
      path: '.slop/investigation.md',
      markdown: '# Old findings',
    });
    const beta = await h.api.get(`/workspaces/${BETA}/sessions/${SESSION.beta}/artifact`);
    expect(beta.body.markdown).toBe('# Beta findings');
  });

  it('gives nobody a credential, marks no base fetch as failed, and drafts nothing (MG-08)', async () => {
    const sources = (await h.api.get(`/workspaces/${ALPHA}/sources`)).body as TicketSource[];
    expect(sources.length).toBeGreaterThan(1);
    for (const source of sources) {
      expect(source.hasCredential).toBe(false);
      expect(source.credential).toEqual({
        isSet: false,
        state: null,
        login: null,
        message: null,
        checkedAt: null,
      });
    }
    expect((await h.api.get(`/workspaces/${ALPHA}/github-credential`)).body).toMatchObject({
      isSet: false,
      repos: [],
    });
    expect((await session(SESSION.ended)).baseFetchFailed).toBe(false);
    expect((await session(SESSION.beta, BETA)).baseFetchFailed).toBe(false);
    expect((await h.api.get(`/workspaces/${ALPHA}/drafted-actions`)).body).toEqual([]);
    const actions = await h.api.get(
      `/workspaces/${ALPHA}/sessions/${SESSION.ended}/drafted-actions`,
    );
    expect(actions.body).toEqual([]);
  });

  it("keeps one workspace's old sessions out of another", async () => {
    expect((await h.api.get(`/workspaces/${BETA}/sessions/${SESSION.ended}`)).status).toBe(404);
  });

  it('starts a new session on an old ticket, fed by the old complete result (MG-04)', async () => {
    const preview = await h.api.get(`${ticketPath(widgets(), 'acme/widgets#1')}/launch-preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.suggestion.phase).toBe('planning');

    const planning = await startSession(h, widgets(), 'planning', { key: 'acme/widgets#1' });
    expect(planning).toMatchObject({
      round: 1,
      linkedRepoId: REPO.widgets,
      baseRef: 'origin/main',
      setup: { userLevelSource: false },
      inputArtifacts: [
        {
          sessionId: SESSION.ended,
          round: 1,
          phase: 'investigation',
          path: '.slop/context/investigation.md',
        },
      ],
    });
    expect(planning.baseCommit).toBe(git(clone, 'rev-parse', 'origin/main'));
    expect(existsSync(join(planning.worktreePath, '.slop/context/investigation.md'))).toBe(true);
    h.runtime.lastRun.ended('success');
    await waitForSession(h, planning, (current) => current.status === 'ended');
  });

  it('continues an old read-only session with its old setup, and never flags it (MG-05)', async () => {
    const resumed = await sendMessage(h, { id: SESSION.ended, workspaceId: ALPHA }, 'Tidy up.');
    expect(resumed).toMatchObject({ round: 2, status: 'running' });
    expect(h.runtime.resumes.at(-1)).toMatchObject({
      runtimeSessionId: 'rt-old-1',
      message: 'Tidy up.',
      cwd: endedWorktree,
      setup: { userLevelSource: true, scope: { mayChangeCode: false } },
    });

    const run = h.runtime.lastRun;
    reportStarted(run);
    run.writeFile('README.md', 'changed by an old read-only session');
    run.commit('a change nobody can attribute');
    run.ended('success');
    const ended = await waitForSession(h, resumed, (current) => current.status === 'ended');
    // There is no starting commit to compare against, so there is nothing to flag it with.
    expect(ended).toMatchObject({ round: 2, scopeFlags: [], baseCommit: null });
  });

  it('stops and removes the worktree of an old session as before (MG-06)', async () => {
    const base = `/workspaces/${ALPHA}/sessions/${SESSION.ended}`;
    const stopped = await h.api.post(`${base}/stop`);
    expect(stopped.status).toBe(200);
    expect(stopped.body.status).toBe('ended');

    const removed = await h.api.delete(`${base}/worktree`);
    expect(removed.status).toBe(200);
    expect(removed.body.worktreeRemovedAt).not.toBeNull();
    expect(existsSync(endedWorktree)).toBe(false);
    expect(git(clone, 'rev-parse', '--verify', 'slop/acme-widgets-1/aaaaaaaa')).not.toBe('');

    const already = await h.api.delete(`/workspaces/${ALPHA}/sessions/${SESSION.failed}/worktree`);
    expect(already.status).toBe(200);
  });

  it('lets an upgraded workspace create new workspaces alongside it, with their own defaults', async () => {
    const created = await h.api.post('/workspaces').send({ name: 'gamma' });
    expect(created.status).toBe(201);
    const sources = (await h.api.get(`/workspaces/${created.body.id}/sources`))
      .body as TicketSource[];
    expect(sources.map((source) => source.type)).toEqual(['built_in']);
    expect((await h.api.get(`/workspaces/${created.body.id}/phase-setups`)).body).toHaveLength(4);
  });

  it('applies every migration to an empty database too (MG-07)', async () => {
    const emptyUrl = await createEmptyDatabase(EMPTY_DATABASE);
    await expect(applyMigrations(emptyUrl, migrationFiles())).resolves.toBeUndefined();
    await withClient(emptyUrl, async (client) => {
      const { rows } = await client.query<{ count: string }>(
        `select (select count(*) from phase_setup) + (select count(*) from ticket_source)
              + (select count(*) from session) as count`,
      );
      expect(Number(rows[0]!.count)).toBe(0);
    });
  });
});
