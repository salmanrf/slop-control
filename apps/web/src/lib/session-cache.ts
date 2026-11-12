import type { QueryClient } from '@tanstack/react-query';
import type { DraftedAction, DraftedActionDetail, Session } from '@slop-control/shared';
import { isOlderAction, withInboxAction, withSessionAction } from './drafted-actions';
import { isOlderSession } from './session-view';

export const keys = {
  workspaces: () => ['workspaces'] as const,
  repos: (workspaceId: string) => ['repos', workspaceId] as const,
  sources: (workspaceId: string) => ['sources', workspaceId] as const,
  phaseSetups: (workspaceId: string) => ['phase-setups', workspaceId] as const,
  /** Every ticket list of a workspace, whatever its filters. */
  ticketLists: (workspaceId: string) => ['tickets', workspaceId] as const,
  tickets: (
    workspaceId: string,
    sourceId: string,
    search: string,
    category: string,
    mine: boolean,
  ) => ['tickets', workspaceId, sourceId, search, category, mine] as const,
  ticket: (workspaceId: string, sourceId: string, ticketKey: string) =>
    ['ticket', workspaceId, sourceId, ticketKey] as const,
  comments: (workspaceId: string, ticketKey: string) =>
    ['comments', workspaceId, ticketKey] as const,
  ticketSessions: (workspaceId: string, sourceId: string, ticketKey: string) =>
    ['sessions', workspaceId, 'ticket', sourceId, ticketKey] as const,
  session: (workspaceId: string, sessionId: string) =>
    ['sessions', workspaceId, 'session', sessionId] as const,
  artifact: (workspaceId: string, sessionId: string) =>
    ['sessions', workspaceId, 'artifact', sessionId] as const,
  diff: (workspaceId: string, sessionId: string) =>
    ['sessions', workspaceId, 'diff', sessionId] as const,
  githubCredential: (workspaceId: string) => ['github-credential', workspaceId] as const,
  /** Every drafted action query of a workspace. */
  actions: (workspaceId: string) => ['drafted-actions', workspaceId] as const,
  /** The workspace's actions that are waiting on the developer. */
  inbox: (workspaceId: string) => ['drafted-actions', workspaceId, 'inbox'] as const,
  sessionActions: (workspaceId: string, sessionId: string) =>
    ['drafted-actions', workspaceId, 'session', sessionId] as const,
  /** Every action read with its branch state, which a new round makes out of date. */
  actionDetails: (workspaceId: string) => ['drafted-actions', workspaceId, 'detail'] as const,
  actionDetail: (workspaceId: string, actionId: string) =>
    ['drafted-actions', workspaceId, 'detail', actionId] as const,
  /** Every preview of one ticket, whatever phase and repo it was asked for. */
  launchPreviews: (workspaceId: string, sourceId: string, ticketKey: string) =>
    ['launch-preview', workspaceId, sourceId, ticketKey] as const,
  launchPreview: (
    workspaceId: string,
    sourceId: string,
    ticketKey: string,
    phase: string,
    linkedRepoId: string,
  ) => ['launch-preview', workspaceId, sourceId, ticketKey, phase, linkedRepoId] as const,
};

/**
 * @params client: the query client; session: a full session from a stream frame or an API answer
 * @return nothing
 * Writes the session into its own entry and its ticket's list, unless the cached session is newer. Each frame carries the full session, so the cache needs no refetch.
 */
export function applySessionUpdate(client: QueryClient, session: Session): void {
  const sessionKey = keys.session(session.workspaceId, session.id);
  const listKey = keys.ticketSessions(
    session.workspaceId,
    session.ticketSourceId,
    session.ticketKey,
  );
  // An answer to a request can arrive after the stream frame that already moved the session on.
  const cached = [
    client.getQueryData<Session>(sessionKey),
    client.getQueryData<Session[]>(listKey)?.find((item) => item.id === session.id),
  ];
  if (cached.some((held) => held && isOlderSession(session, held))) return;

  client.setQueryData(sessionKey, session);

  client.setQueryData<Session[]>(listKey, (list) => {
    if (!list) return list;
    return list.some((item) => item.id === session.id)
      ? list.map((item) => (item.id === session.id ? session : item))
      : [session, ...list];
  });

  // The suggestion and the earlier artifacts depend on this ticket's sessions, and on nothing else.
  void client.invalidateQueries({
    queryKey: keys.launchPreviews(session.workspaceId, session.ticketSourceId, session.ticketKey),
  });

  if (session.artifactStatus) {
    void client.invalidateQueries({ queryKey: keys.artifact(session.workspaceId, session.id) });
  }

  // A round can add commits, and removing the worktree drops its uncommitted list.
  void client.invalidateQueries({ queryKey: keys.diff(session.workspaceId, session.id) });
  void client.invalidateQueries({ queryKey: keys.actionDetails(session.workspaceId) });
}

/**
 * @params client: the query client; action: a full drafted action from a stream frame or an API answer
 * @return nothing
 * Writes the action into its session's list and the workspace's inbox, unless a cached state of it is newer. Lists nobody has loaded are left alone.
 */
export function applyActionUpdate(client: QueryClient, action: DraftedAction): void {
  const { workspaceId } = action;
  const listKey = keys.sessionActions(workspaceId, action.sessionId);
  const inboxKey = keys.inbox(workspaceId);
  const detailKey = keys.actionDetail(workspaceId, action.id);

  // An answer to an approval can arrive after the frame that already carried a later state.
  const cached = [
    client.getQueryData<DraftedAction[]>(listKey)?.find((item) => item.id === action.id),
    client.getQueryData<DraftedAction[]>(inboxKey)?.find((item) => item.id === action.id),
    client.getQueryData<DraftedActionDetail>(detailKey)?.action,
  ];
  if (cached.some((held) => held && isOlderAction(action, held))) return;

  client.setQueryData<DraftedAction[]>(listKey, (list) => list && withSessionAction(list, action));
  client.setQueryData<DraftedAction[]>(inboxKey, (list) => list && withInboxAction(list, action));
  client.setQueryData<DraftedActionDetail>(detailKey, (detail) => detail && { ...detail, action });

  // A dispatch rejected for its credential marks that credential, on the workspace or the source.
  if (action.status === 'failed') {
    void client.invalidateQueries({ queryKey: keys.githubCredential(workspaceId) });
    void client.invalidateQueries({ queryKey: keys.sources(workspaceId) });
  }
  // A comment or a status change that went out has changed the ticket.
  if (action.status === 'succeeded' && action.type !== 'open_pr') {
    void client.invalidateQueries({
      queryKey: keys.ticket(workspaceId, action.ticketSourceId, action.ticketKey),
    });
    void client.invalidateQueries({ queryKey: keys.comments(workspaceId, action.ticketKey) });
    void client.invalidateQueries({ queryKey: keys.ticketLists(workspaceId) });
  }
}

/** Status is current state, not a log: after a reconnect, read it again. */
export function refetchSessionQueries(client: QueryClient, workspaceId: string): Promise<void> {
  return client.refetchQueries({ queryKey: ['sessions', workspaceId] });
}

/** Drafted actions are current state too: a frame missed while disconnected is never sent again. */
export function refetchActionQueries(client: QueryClient, workspaceId: string): Promise<void> {
  return client.refetchQueries({ queryKey: keys.actions(workspaceId) });
}
