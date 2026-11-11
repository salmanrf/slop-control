import type { LaunchPreview, Session } from '@slop-control/shared';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ticket } from './support/fake-tracker';
import { git } from './support/git';
import { resetDatabase } from './support/test-app';
import { CANARY_GITHUB_TOKEN } from './support/test-env';
import {
  completeSession,
  createHarness,
  KEY,
  linkSecondRepo,
  reportStarted,
  seedWorkspace,
  sendMessage,
  startSession,
  ticketPath,
  waitForSession,
  type Harness,
  type Seeded,
  type TicketRef,
} from './support/session-harness';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const PHASES = ['investigation', 'planning', 'implementation', 'code_review'] as const;

describe('launch preview', () => {
  let h: Harness;
  let seeded: Seeded;
  let workspaceId: string;

  const get = (query = '', ref: TicketRef = seeded, key = KEY) =>
    h.api.get(`${ticketPath(ref, key)}/launch-preview${query}`);
  const preview = async (query = '', ref: TicketRef = seeded, key = KEY) => {
    const res = await get(query, ref, key);
    if (res.status !== 200) throw new Error(`preview failed: ${res.status}`);
    return res.body as LaunchPreview;
  };
  const history = async () => (await h.api.get(`${ticketPath(seeded)}/sessions`)).body as Session[];
  /** A committed implementation, so a code review has a branch to start from. */
  const implement = () =>
    completeSession(h, seeded, 'implementation', {
      work: (run) => {
        run.writeFile('feature.txt', 'feature');
        run.commit('feature');
      },
    });
  /** A second source whose tickets match no linked repo, beside two linked repos. */
  const unresolvable = async (): Promise<TicketRef> => {
    await linkSecondRepo(h, workspaceId);
    h.tracker.source('acme/other').add(ticket('acme/other#1'));
    const other = await h.api
      .post(`/workspaces/${workspaceId}/sources`)
      .send({ type: 'github_issues', githubOwner: 'acme', githubRepo: 'other' });
    return { workspaceId, sourceId: other.body.id as string };
  };

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.runtime.readiness = { ready: true };
    h.tracker.reset();
    seeded = await seedWorkspace(h);
    ({ workspaceId } = seeded);
  });
  afterAll(() => h.close());

  it.each(PHASES)('agrees with what a %s launch then records', async (phase) => {
    await completeSession(h, seeded, 'investigation');
    await completeSession(h, seeded, 'planning');
    await implement();
    await completeSession(h, seeded, 'code_review');

    const shown = await preview(`?phase=${phase}`);
    const session = await startSession(h, seeded, phase);
    expect(session.linkedRepoId).toBe(shown.linkedRepoId);
    expect(session.baseRef).toBe(shown.baseRef);
    expect(session.setup).toEqual(shown.setup);
    expect(session.inputArtifacts).toEqual(shown.inputArtifacts);
    expect(shown.inputArtifacts).toHaveLength(3);
  });

  it('previews the suggested phase when none is asked for', async () => {
    expect((await preview()).phase).toBe('investigation');
    await completeSession(h, seeded, 'investigation');
    const shown = await preview();
    expect(shown.suggestion.phase).toBe('planning');
    expect(shown.phase).toBe('planning');
    expect(shown.setup.stopCondition.requiredArtifactPath).toBe('.slop/plan.md');
  });

  it('previews investigation once nothing is suggested', async () => {
    await completeSession(h, seeded, 'code_review');
    const shown = await preview();
    expect(shown.suggestion.phase).toBeNull();
    expect(shown.suggestion.reason).not.toBe('');
    expect(shown.phase).toBe('investigation');
  });

  it('previews the phase asked for, and leaves the suggestion as it was', async () => {
    await completeSession(h, seeded, 'investigation');
    const suggested = await preview();
    const shown = await preview('?phase=implementation');
    expect(shown.phase).toBe('implementation');
    expect(shown.setup.scope.mayChangeCode).toBe(true);
    expect(shown.suggestion).toEqual(suggested.suggestion);
  });

  it('previews the repo asked for, with a starting point in it', async () => {
    const second = await linkSecondRepo(h, workspaceId);
    await implement();
    const shown = await preview(`?phase=code_review&linkedRepoId=${second.repoId}`);
    expect(shown.linkedRepoId).toBe(second.repoId);
    // The implementation ran in the other repo, so its branch doesn't exist in this one.
    expect(shown.baseRef).toBe('origin/main');
    expect(shown.compareRef).toBeNull();
  });

  it('returns a null repo and starting point when the developer must choose', async () => {
    const ref = await unresolvable();
    const res = await get('', ref, 'acme/other#1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      linkedRepoId: null,
      baseRef: null,
      compareRef: null,
      phase: 'investigation',
      suggestion: { phase: 'investigation' },
      setup: { stopCondition: { requiredArtifactPath: '.slop/investigation.md' } },
      inputArtifacts: [],
    });

    const launch = await h.api
      .post(`${ticketPath(ref, 'acme/other#1')}/sessions`)
      .send({ phase: 'investigation' });
    expect(launch.status).toBe(409);
    expect(launch.body.code).toBe('REPO_CHOICE_REQUIRED');
  });

  it('returns a null repo for a workspace with no linked repo', async () => {
    const empty = (await h.api.post('/workspaces').send({ name: 'empty' })).body.id as string;
    const sources = (await h.api.get(`/workspaces/${empty}/sources`)).body as { id: string }[];
    const shown = await preview('', { workspaceId: empty, sourceId: sources[0]!.id }, 'T-1');
    expect(shown.linkedRepoId).toBeNull();
    expect(shown.baseRef).toBeNull();
  });

  it("starts a code review from the implementation's branch, and names what to compare against", async () => {
    const implementation = await implement();
    const review = await preview('?phase=code_review');
    expect(review.baseRef).toBe(implementation.branch);
    expect(review.compareRef).toBe('origin/main');

    for (const phase of ['investigation', 'planning', 'implementation']) {
      const other = await preview(`?phase=${phase}`);
      expect(other.baseRef).toBe('origin/main');
      expect(other.compareRef).toBeNull();
    }
  });

  it.each([['automated_testing'], ['e2e_testing'], ['nonsense']])(
    'rejects the phase %s',
    async (phase) => {
      const res = await get(`?phase=${phase}`);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    },
  );

  it('returns 404 for an unknown workspace, source, or repo, and a repo from another workspace', async () => {
    const other = await seedWorkspace(h, 'other');
    const responses = [
      await get('', { ...seeded, workspaceId: UNKNOWN }),
      await get('', { workspaceId, sourceId: UNKNOWN }),
      await get('', { workspaceId, sourceId: other.sourceId }),
      await get(`?linkedRepoId=${UNKNOWN}`),
      await get(`?linkedRepoId=${other.repoId}`),
    ];
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
  });

  it('creates nothing, however often it is read', async () => {
    const runs = h.runtime.runs.length;
    for (const phase of PHASES) {
      await preview(`?phase=${phase}`);
      await preview(`?phase=${phase}`);
    }
    expect(await history()).toEqual([]);
    expect(h.runtime.runs.length).toBe(runs);
    expect(git(seeded.clone, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(git(seeded.clone, 'branch', '--list', 'slop/*')).toBe('');
    expect(() => readdirSync(join(h.dataDir, 'worktrees', workspaceId))).toThrow();
  });

  it('shows a phase setup as edited', async () => {
    await h.api
      .patch(`/workspaces/${workspaceId}/phase-setups/planning`)
      .send({ instruction: 'Plan it in three steps.', userLevelSource: true });
    const shown = await preview('?phase=planning');
    expect(shown.setup.instruction).toBe('Plan it in three steps.');
    expect(shown.setup.userLevelSource).toBe(true);
  });

  it('resolves a ticket key that needs URL encoding', async () => {
    const key = 'acme/widgets#7 & more?';
    h.tracker.add(ticket(key));
    const session = await completeSession(h, seeded, 'investigation', { key });
    const shown = await preview('', seeded, key);
    expect(shown.suggestion.phase).toBe('planning');
    expect(shown.inputArtifacts).toEqual([
      {
        sessionId: session.id,
        round: 1,
        phase: 'investigation',
        path: '.slop/context/investigation.md',
      },
    ]);
    expect((await preview()).suggestion.phase).toBe('investigation');
  });

  it('is refused on a disconnected source, as the launch is', async () => {
    await h.api.delete(`/workspaces/${workspaceId}/sources/${seeded.sourceId}`);
    const res = await get();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SOURCE_DISCONNECTED');
  });

  // Differs from the test plan's Q7 assumption: the preview doesn't read the ticket, so it
  // costs no tracker call and still works while the tracker is down. The launch returns 404.
  it("doesn't read the ticket, so one the tracker doesn't have still previews", async () => {
    const gets = h.tracker.source().calls.get;
    const res = await get('', seeded, 'acme/widgets#99');
    expect(res.status).toBe(200);
    expect(h.tracker.source().calls.get).toBe(gets);

    const launch = await h.api
      .post(`${ticketPath(seeded, 'acme/widgets#99')}/sessions`)
      .send({ phase: 'investigation' });
    expect(launch.status).toBe(404);
  });

  it("never contains the server's GitHub token", async () => {
    await completeSession(h, seeded, 'investigation', {
      content: `# Findings\ntoken ${CANARY_GITHUB_TOKEN}`,
    });
    const setups = await h.api.get(`/workspaces/${workspaceId}/phase-setups`);
    expect(JSON.stringify(setups.body)).not.toContain(CANARY_GITHUB_TOKEN);
    expect(JSON.stringify(await preview())).not.toContain(CANARY_GITHUB_TOKEN);
  });

  describe('next-phase suggestion', () => {
    it('updates as soon as a session ends complete, with no other action', async () => {
      const session = await startSession(h, seeded, 'investigation');
      expect((await preview()).suggestion.phase).toBe('investigation');

      reportStarted(h.runtime.lastRun);
      h.runtime.lastRun.writeFile('.slop/investigation.md', '# Findings\n');
      // A running session doesn't hide the suggestion, and doesn't count as done.
      expect((await preview()).suggestion.phase).toBe('investigation');
      h.runtime.lastRun.ended('success');
      await waitForSession(h, session, (s) => s.status === 'ended');

      const shown = await preview();
      expect(shown.suggestion.phase).toBe('planning');
      expect(shown.suggestion.reason).toContain('Investigation');
    });

    it("isn't moved on by a session that ended without its artifact", async () => {
      const session = await startSession(h, seeded, 'investigation');
      h.runtime.lastRun.ended('success');
      await waitForSession(h, session, (s) => s.status === 'ended');
      expect((await preview()).suggestion.phase).toBe('investigation');
    });

    // Records today's rule (test plan Q8, undecided): a follow-up clears `artifactStatus`, and a
    // round that leaves the artifact alone ends incomplete, so the phase stops counting as done.
    it('falls back while a complete session runs a follow-up, and after a round that wrote nothing new', async () => {
      const session = await completeSession(h, seeded, 'investigation');
      expect((await preview()).suggestion.phase).toBe('planning');

      await sendMessage(h, session, 'Also commit your work.');
      expect((await preview()).suggestion.phase).toBe('investigation');

      h.runtime.lastRun.ended('success');
      const ended = await waitForSession(h, session, (s) => s.status === 'ended');
      expect(ended.artifactStatus).toBe('incomplete');
      const shown = await preview('?phase=planning');
      expect(shown.suggestion.phase).toBe('investigation');
      expect(shown.inputArtifacts).toEqual([]);
    });
  });
});
