import type {
  DraftedAction,
  DraftedActionStatus,
  Session,
  SessionDiff,
  UncommittedFile,
} from '@slop-control/shared';
import type { Tone } from './session-view';

const TYPE_LABELS: Record<DraftedAction['type'], string> = {
  open_pr: 'Open PR',
  ticket_comment: 'Ticket comment',
  ticket_transition: 'Status change',
};

export const actionTypeLabel = (action: Pick<DraftedAction, 'type'>) => TYPE_LABELS[action.type];

const STATUSES: Record<DraftedActionStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting for approval', tone: 'warn' },
  dispatching: { label: 'Sending', tone: 'ok' },
  succeeded: { label: 'Sent', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  rejected: { label: 'Rejected', tone: 'neutral' },
};

export const actionStatus = (action: Pick<DraftedAction, 'status'>) => STATUSES[action.status];

export interface ActionResultWording {
  text: string;
  /** Null when the result has no page to open, as on a built-in ticket. */
  url: string | null;
}

/** What a dispatched action did. Null until it has succeeded. */
export function actionResult(action: DraftedAction): ActionResultWording | null {
  if (action.status !== 'succeeded' || !action.result) return null;
  switch (action.type) {
    case 'open_pr':
      return { text: `Pull request #${action.result.number}`, url: action.result.url };
    case 'ticket_comment':
      return action.result.url
        ? { text: 'Comment posted', url: action.result.url }
        : { text: 'Comment added to the ticket', url: null };
    case 'ticket_transition':
      return { text: `Ticket moved to ${action.result.status}`, url: null };
  }
}

/** One line saying what approving would send. */
export function actionSummary(action: DraftedAction): string {
  switch (action.type) {
    case 'open_pr':
      return `${action.payload.headBranch} into ${action.payload.baseBranch}`;
    case 'ticket_comment':
      return `Comment on ${action.ticketKey}`;
    case 'ticket_transition':
      return `Move ${action.ticketKey} to ${action.payload.toStatus}`;
  }
}

/** A failed action waits on the developer as much as a new draft does. */
export const isWaiting = (action: Pick<DraftedAction, 'status'>) =>
  action.status === 'pending' || action.status === 'failed';

/** The inbox's order: newest first. */
export function inboxActions(actions: DraftedAction[]): DraftedAction[] {
  return actions
    .filter(isWaiting)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

const STATUS_ORDER: Record<DraftedActionStatus, number> = {
  pending: 0,
  dispatching: 1,
  failed: 2,
  succeeded: 3,
  rejected: 3,
};

const isFinal = (status: DraftedActionStatus) => status === 'succeeded' || status === 'rejected';

type ActionState = Pick<DraftedAction, 'status' | 'updatedAt'>;

/**
 * @params incoming: a state of an action just received; cached: the state of the same action already held
 * @return true when `incoming` was saved before `cached`
 * Orders two states of one action. Nothing follows `succeeded` or `rejected`. Otherwise the later
 * save wins, which lets `failed` return to `dispatching`; statuses only decide a tie.
 */
export function isOlderAction(incoming: ActionState, cached: ActionState): boolean {
  if (isFinal(cached.status) && incoming.status !== cached.status) return true;
  const saved = Date.parse(incoming.updatedAt) - Date.parse(cached.updatedAt);
  if (saved !== 0) return saved < 0;
  return STATUS_ORDER[incoming.status] < STATUS_ORDER[cached.status];
}

/** A session's list after a state of one of its actions arrives; oldest first, as the API lists them. */
export function withSessionAction(list: DraftedAction[], action: DraftedAction): DraftedAction[] {
  return list.some((item) => item.id === action.id)
    ? list.map((item) => (item.id === action.id ? action : item))
    : [...list, action];
}

/** The inbox after a state of an action arrives: it joins, updates in place, or leaves. */
export function withInboxAction(list: DraftedAction[], action: DraftedAction): DraftedAction[] {
  return inboxActions([...list.filter((item) => item.id !== action.id), action]);
}

/** The id an action's card carries on its session page, for a link from the inbox. */
export const actionAnchor = (actionId: string) => `action-${actionId}`;

export interface NothingToPush {
  uncommitted: UncommittedFile[];
}

/**
 * An implementation session that finished its report but committed nothing gets no open PR action.
 * @return what to say in its place, or null when that isn't the case or isn't known yet
 */
export function nothingToPush(
  session: Pick<Session, 'phase' | 'status' | 'artifactStatus'>,
  actions: DraftedAction[] | undefined,
  diff: Pick<SessionDiff, 'commitCount' | 'uncommitted'> | undefined,
): NothingToPush | null {
  if (session.phase !== 'implementation') return null;
  if (session.status !== 'ended' || session.artifactStatus !== 'complete') return null;
  if (!actions || !diff) return null;
  if (actions.some((action) => action.type === 'open_pr') || diff.commitCount > 0) return null;
  return { uncommitted: diff.uncommitted ?? [] };
}
