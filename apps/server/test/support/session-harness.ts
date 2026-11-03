import type { Session } from '@slop-control/shared';
import { SessionRuntime } from '../../src/sessions/runtime';
import { TrackerAdapterFactory } from '../../src/tickets/tracker';
import { FakeRuntime } from './fake-runtime';
import { FakeTracker, ticket } from './fake-tracker';
import { makeClone } from './git';
import { createTestApp, type TestApp, type TestAppOptions } from './test-app';

export const KEY = 'acme/widgets#1';
export const ENCODED_KEY = encodeURIComponent(KEY);

export interface Harness extends TestApp {
  runtime: FakeRuntime;
  tracker: FakeTracker;
}

export async function createHarness(
  options: TestAppOptions & { runtime?: FakeRuntime } = {},
): Promise<Harness> {
  const runtime = options.runtime ?? new FakeRuntime();
  const tracker = new FakeTracker();
  const app = await createTestApp({
    ...options,
    overrides: [
      [SessionRuntime, runtime],
      [TrackerAdapterFactory, tracker],
      ...(options.overrides ?? []),
    ],
  });
  return { ...app, runtime, tracker };
}

export async function seedWorkspace(
  h: Harness,
  name = 'w',
): Promise<{ workspaceId: string; clone: string; repoId: string }> {
  h.tracker.add(ticket(KEY));
  const workspaceId = (await h.api.post('/workspaces').send({ name })).body.id as string;
  const clone = makeClone();
  const repoId = (await h.api.post(`/workspaces/${workspaceId}/repos`).send({ localPath: clone }))
    .body.id as string;
  return { workspaceId, clone, repoId };
}

export async function startSession(
  h: Harness,
  workspaceId: string,
  phase = 'investigation',
): Promise<Session> {
  const res = await h.api
    .post(`/workspaces/${workspaceId}/tickets/${ENCODED_KEY}/sessions`)
    .send({ phase });
  if (res.status !== 201)
    throw new Error(`start failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Session;
}

/** Reads the session through the API until it passes the check. */
export async function waitForSession(
  h: Harness,
  session: { id: string; workspaceId: string },
  check: (session: Session) => boolean,
): Promise<Session> {
  const deadline = Date.now() + 5000;
  let last: Session | undefined;
  while (Date.now() < deadline) {
    last = (await h.api.get(`/workspaces/${session.workspaceId}/sessions/${session.id}`))
      .body as Session;
    if (check(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Session never reached the expected state; last: ${JSON.stringify(last)}`);
}
