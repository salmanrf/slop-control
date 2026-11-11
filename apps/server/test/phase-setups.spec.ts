import type { PhaseSetup } from '@slop-control/shared';
import { resetDatabase } from './support/test-app';
import {
  createHarness,
  seedWorkspace,
  startSession,
  ticketPath,
  type Harness,
  type Seeded,
} from './support/session-harness';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('phase setups', () => {
  let h: Harness;
  let seeded: Seeded;
  let workspaceId: string;

  const list = async (ws = workspaceId) =>
    (await h.api.get(`/workspaces/${ws}/phase-setups`)).body as PhaseSetup[];
  const patch = (phase: string, body: unknown, ws = workspaceId) =>
    h.api.patch(`/workspaces/${ws}/phase-setups/${phase}`).send(body as object);
  const setupOf = async (phase: string, ws = workspaceId) =>
    (await list(ws)).find((setup) => setup.phase === phase)!;

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.reset();
    seeded = await seedWorkspace(h);
    ({ workspaceId } = seeded);
  });
  afterAll(() => h.close());

  it('gives a new workspace the four defaults, in the default order', async () => {
    const res = await h.api.get(`/workspaces/${workspaceId}/phase-setups`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject([
      {
        workspaceId,
        phase: 'investigation',
        instruction:
          'Investigate this ticket without changing code, and write your findings as markdown to `.slop/investigation.md`.',
        scope: { mayChangeCode: false },
        stopCondition: { requiredArtifactPath: '.slop/investigation.md' },
        userLevelSource: false,
      },
      {
        phase: 'planning',
        instruction:
          'Plan the work for this ticket without changing code, and write the plan as markdown to `.slop/plan.md`.',
        scope: { mayChangeCode: false },
        stopCondition: { requiredArtifactPath: '.slop/plan.md' },
        userLevelSource: false,
      },
      {
        phase: 'implementation',
        instruction:
          'Implement this ticket, commit your work, and write a report as markdown to `.slop/implementation-report.md`.',
        scope: { mayChangeCode: true },
        stopCondition: { requiredArtifactPath: '.slop/implementation-report.md' },
        userLevelSource: false,
      },
      {
        phase: 'code_review',
        instruction:
          'Review the code for this ticket without changing it, and write your review as markdown to `.slop/review-report.md`.',
        scope: { mayChangeCode: false },
        stopCondition: { requiredArtifactPath: '.slop/review-report.md' },
        userLevelSource: false,
      },
    ]);
    expect(res.body).toHaveLength(4);
  });

  it.each([
    ['an unknown workspace', UNKNOWN],
    ['a workspace ID that is not a UUID', 'not-a-uuid'],
  ])('returns 404 for %s', async (_name, ws) => {
    const listed = await h.api.get(`/workspaces/${ws}/phase-setups`);
    expect(listed.status).toBe(404);
    expect(listed.body.code).toBe('NOT_FOUND');
    expect((await patch('planning', { instruction: 'Plan it.' }, ws)).status).toBe(404);
  });

  it("changes the instruction, which the next session's brief and setup carry", async () => {
    const before = await setupOf('planning');
    const res = await patch('planning', { instruction: 'Plan it in three steps.' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      phase: 'planning',
      instruction: 'Plan it in three steps.',
      scope: before.scope,
      stopCondition: before.stopCondition,
      userLevelSource: false,
    });
    expect(Date.parse(res.body.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));

    const session = await startSession(h, seeded, 'planning');
    expect(session.setup.instruction).toBe('Plan it in three steps.');
    expect(session.brief).toContain('Plan it in three steps.');
    expect(session.brief).not.toContain(before.instruction);
  });

  it("leaves an earlier session's recorded setup and brief alone", async () => {
    const earlier = await startSession(h, seeded, 'planning');
    await patch('planning', { instruction: 'Plan it differently.', userLevelSource: true });

    const read = (await h.api.get(`/workspaces/${workspaceId}/sessions/${earlier.id}`)).body;
    expect(read.setup).toEqual(earlier.setup);
    expect(read.brief).toBe(earlier.brief);
    const history = (await h.api.get(`${ticketPath(seeded)}/sessions`)).body;
    expect(history[0].setup).toEqual(earlier.setup);
  });

  it("doesn't show one workspace's edits in another", async () => {
    const other = await seedWorkspace(h, 'other');
    const before = await list(other.workspaceId);
    await patch('investigation', { instruction: 'Only here.', userLevelSource: true });
    expect(await list(other.workspaceId)).toEqual(before);
  });

  it('turns the user-level source on for one phase only, and the runtime is told', async () => {
    const res = await patch('implementation', { userLevelSource: true });
    expect(res.status).toBe(200);
    expect(res.body.userLevelSource).toBe(true);
    expect((await list()).map((setup) => setup.userLevelSource)).toEqual([
      false,
      false,
      true,
      false,
    ]);

    const session = await startSession(h, seeded, 'implementation');
    expect(session.setup.userLevelSource).toBe(true);
    expect(h.runtime.starts.at(-1)!.setup.userLevelSource).toBe(true);

    await startSession(h, seeded, 'planning');
    expect(h.runtime.starts.at(-1)!.setup.userLevelSource).toBe(false);
  });

  it.each([[''], ['   '], ['\n\t'], [42], [null]])(
    'rejects the instruction %p and changes nothing',
    async (instruction) => {
      const before = await list();
      const res = await patch('planning', { instruction });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(await list()).toEqual(before);
    },
  );

  it.each([
    ['scope', { scope: { mayChangeCode: true } }],
    ['stopCondition', { stopCondition: { requiredArtifactPath: '.slop/other.md' } }],
    ['an unknown field', { permissionMode: 'bypass' }],
    ['scope beside a valid field', { instruction: 'Fine.', scope: { mayChangeCode: true } }],
    [
      'stopCondition beside a valid field',
      { userLevelSource: true, stopCondition: { requiredArtifactPath: '.slop/other.md' } },
    ],
  ])('rejects a body that sets %s, changing nothing', async (_name, body) => {
    const before = await list();
    const res = await patch('planning', body);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(await list()).toEqual(before);
  });

  it.each([['yes'], [1], [null]])(
    'rejects the user-level source switch %p',
    async (userLevelSource) => {
      const before = await list();
      const res = await patch('planning', { userLevelSource });
      expect(res.status).toBe(422);
      expect(await list()).toEqual(before);
    },
  );

  it.each([['automated_testing'], ['e2e_testing'], ['nonsense']])(
    'returns 404 for the phase %s',
    async (phase) => {
      const res = await patch(phase, { instruction: 'Test it.' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    },
  );

  it('returns the setup unchanged for an empty body', async () => {
    const before = await setupOf('planning');
    const res = await patch('planning', {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual(before);
  });
});

describe('authentication on the Sprint 2 endpoints', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.reset();
  });
  afterAll(() => h.close());

  it('returns 401 without a token', async () => {
    const seeded = await seedWorkspace(h);
    const session = await startSession(h, seeded);
    const ws = `/workspaces/${seeded.workspaceId}`;

    // Built one at a time: supertest starts a request as soon as it is built.
    const requests = [
      () => h.http.get(`${ws}/phase-setups`),
      () => h.http.patch(`${ws}/phase-setups/planning`).send({ instruction: 'Plan.' }),
      () => h.http.get(`${ticketPath(seeded)}/launch-preview`),
      () => h.http.get(`${ticketPath(seeded)}/sessions`),
      () => h.http.post(`${ticketPath(seeded)}/sessions`).send({ phase: 'investigation' }),
      () => h.http.post(`${ws}/sessions/${session.id}/messages`).send({ message: 'Carry on.' }),
    ];
    for (const request of requests) {
      const res = await request();
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    }
  });
});
