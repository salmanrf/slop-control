import type {
  DraftedAction,
  DraftedActionDetail,
  DraftedActionType,
  Session,
} from '@slop-control/shared';
import { makeClone } from './git';
import { completeSession, type Harness, type Seeded, type TicketRef } from './session-harness';

export const WORKSPACE_TOKEN = 'ghp_workspace_token_for_drafted_actions';

/** A workspace with one linked clone and a built-in ticket `T-1`, with no connected source. */
export async function seedBuiltIn(h: Harness, name = 'built-in'): Promise<Seeded & TicketRef> {
  const workspaceId = (await h.api.post('/workspaces').send({ name })).body.id as string;
  const clone = makeClone();
  const repoId = (await h.api.post(`/workspaces/${workspaceId}/repos`).send({ localPath: clone }))
    .body.id as string;
  const sources = (await h.api.get(`/workspaces/${workspaceId}/sources`)).body as { id: string }[];
  const created = await h.api
    .post(`/workspaces/${workspaceId}/built-in-tickets`)
    .send({ title: 'Built-in work', body: 'Do it.' });
  if (created.status !== 201) throw new Error(`ticket failed: ${JSON.stringify(created.body)}`);
  const sourceId = sources[0]!.id;
  return { workspaceId, clone, repoId, sourceId, builtInSourceId: sourceId };
}

export async function saveCredential(
  h: Harness,
  workspaceId: string,
  token = WORKSPACE_TOKEN,
): Promise<void> {
  const res = await h.api.put(`/workspaces/${workspaceId}/github-credential`).send({ token });
  if (res.status !== 200) throw new Error(`credential failed: ${JSON.stringify(res.body)}`);
}

/** An implementation session that commits one file and ends with its report. */
export function implement(
  h: Harness,
  ref: TicketRef,
  options: { key?: string; report?: string; commit?: boolean } = {},
): Promise<Session> {
  return completeSession(h, ref, 'implementation', {
    key: options.key,
    content: options.report ?? '# Implementation report\n\nAdded the feature.',
    work: (run) => {
      if (options.commit === false) return;
      run.writeFile('feature.txt', 'the feature\n');
      run.commit('Add the feature');
    },
  });
}

export async function sessionActions(
  h: Harness,
  session: { id: string; workspaceId: string },
): Promise<DraftedAction[]> {
  const res = await h.api.get(
    `/workspaces/${session.workspaceId}/sessions/${session.id}/drafted-actions`,
  );
  if (res.status !== 200) throw new Error(`actions failed: ${JSON.stringify(res.body)}`);
  return res.body as DraftedAction[];
}

/** Drafting follows the session's end, so the action is read until it's there. */
export async function waitForAction<T extends DraftedActionType>(
  h: Harness,
  session: { id: string; workspaceId: string },
  type: T,
  check: (action: DraftedAction & { type: T }) => boolean = () => true,
): Promise<DraftedAction & { type: T }> {
  const deadline = Date.now() + 5000;
  let last: DraftedAction[] = [];
  while (Date.now() < deadline) {
    last = await sessionActions(h, session);
    const found = last
      .filter((action): action is DraftedAction & { type: T } => action.type === type)
      .reverse()
      .find(check);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`No ${type} action arrived; the session has: ${JSON.stringify(last)}`);
}

/** Long enough for a draft to have been written, for the cases where none should be. */
export async function settledActions(
  h: Harness,
  session: { id: string; workspaceId: string },
): Promise<DraftedAction[]> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return sessionActions(h, session);
}

export const actionPath = (action: { workspaceId: string; id: string }) =>
  `/workspaces/${action.workspaceId}/drafted-actions/${action.id}`;

export async function detail(h: Harness, action: DraftedAction): Promise<DraftedActionDetail> {
  return (await h.api.get(actionPath(action))).body as DraftedActionDetail;
}

/** Approves an open PR the way the dashboard does: naming the head commit it was shown. */
export async function approveOpenPr(h: Harness, action: DraftedAction) {
  const { branch } = await detail(h, action);
  return h.api
    .post(`${actionPath(action)}/approve`)
    .send({ expectedHeadCommit: branch?.headCommit });
}
