import type { Session } from '@slop-control/shared';
import { SessionRuntime } from '../../src/sessions/runtime';
import { TrackerAdapterFactory } from '../../src/tickets/tracker';
import { FakeRun, FakeRuntime } from './fake-runtime';
import { FakeTracker, ticket } from './fake-tracker';
import { makeClone } from './git';
import { createTestApp, type TestApp, type TestAppOptions } from './test-app';

export const KEY = 'acme/widgets#1';
export const ENCODED_KEY = encodeURIComponent(KEY);

export interface Harness extends TestApp {
  runtime: FakeRuntime;
  tracker: FakeTracker;
}

/** A workspace with one linked clone of `acme/widgets` and that repo's Issues connected as a source. */
export interface Seeded {
  workspaceId: string;
  clone: string;
  repoId: string;
  /** The connected `acme/widgets` GitHub Issues source, served by the fake tracker. */
  sourceId: string;
  builtInSourceId: string;
}

export interface TicketRef {
  workspaceId: string;
  sourceId: string;
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

/** The API path of a ticket, to which `/sessions` or `/launch-preview` is added. */
export function ticketPath(ref: TicketRef, key: string = KEY): string {
  return `/workspaces/${ref.workspaceId}/sources/${ref.sourceId}/tickets/${encodeURIComponent(key)}`;
}

export async function seedWorkspace(h: Harness, name = 'w'): Promise<Seeded> {
  h.tracker.add(ticket(KEY));
  const workspaceId = (await h.api.post('/workspaces').send({ name })).body.id as string;
  const clone = makeClone();
  const repoId = (await h.api.post(`/workspaces/${workspaceId}/repos`).send({ localPath: clone }))
    .body.id as string;
  const connected = await h.api
    .post(`/workspaces/${workspaceId}/sources`)
    .send({ type: 'github_issues', githubOwner: 'acme', githubRepo: 'widgets' });
  if (connected.status !== 201) {
    throw new Error(`connect failed: ${connected.status} ${JSON.stringify(connected.body)}`);
  }
  const sources = (await h.api.get(`/workspaces/${workspaceId}/sources`)).body as {
    id: string;
    type: string;
  }[];
  return {
    workspaceId,
    clone,
    repoId,
    sourceId: connected.body.id as string,
    builtInSourceId: sources.find((source) => source.type === 'built_in')!.id,
  };
}

export async function startSession(
  h: Harness,
  ref: TicketRef,
  phase = 'investigation',
  options: { key?: string; linkedRepoId?: string } = {},
): Promise<Session> {
  const res = await h.api
    .post(`${ticketPath(ref, options.key)}/sessions`)
    .send({ phase, linkedRepoId: options.linkedRepoId });
  if (res.status !== 201)
    throw new Error(`start failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Session;
}

let runtimeSessionCounter = 0;

/** Makes the latest run report a session ID no other run has used. */
export function reportStarted(run: FakeRun): string {
  runtimeSessionCounter += 1;
  const id = `runtime-session-${runtimeSessionCounter}`;
  run.started(id);
  return id;
}

/**
 * Starts a session, has the fake runtime write the phase's required artifact, and ends it.
 * @return the session once it has ended with its artifact stored
 */
export async function completeSession(
  h: Harness,
  ref: TicketRef,
  phase = 'investigation',
  options: {
    key?: string;
    linkedRepoId?: string;
    content?: string;
    /** Runs in the worktree before the run ends, e.g. to change or commit code. */
    work?: (run: FakeRun, session: Session) => void;
  } = {},
): Promise<Session> {
  const session = await startSession(h, ref, phase, options);
  const run = h.runtime.lastRun;
  reportStarted(run);
  run.writeFile(
    session.setup.stopCondition.requiredArtifactPath,
    options.content ?? `# ${phase} result of ${session.id}`,
  );
  options.work?.(run, session);
  run.ended('success');
  return waitForSession(h, session, (current) => current.status === 'ended');
}

/** Sends a follow-up and returns the session in its new round. The new run is `h.runtime.lastRun`. */
export async function sendMessage(
  h: Harness,
  session: { id: string; workspaceId: string },
  message = 'Carry on.',
): Promise<Session> {
  const res = await h.api
    .post(`/workspaces/${session.workspaceId}/sessions/${session.id}/messages`)
    .send({ message });
  if (res.status !== 202)
    throw new Error(`follow-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Session;
}

/** Links a second clone, of `acme/gadgets` unless told otherwise, and returns its linked repo ID. */
export async function linkSecondRepo(
  h: Harness,
  workspaceId: string,
  origin = 'git@github.com:acme/gadgets.git',
): Promise<{ repoId: string; clone: string }> {
  const clone = makeClone({ origin });
  const res = await h.api.post(`/workspaces/${workspaceId}/repos`).send({ localPath: clone });
  if (res.status !== 201) throw new Error(`link failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { repoId: res.body.id as string, clone };
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
