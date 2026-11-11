import type { QueryClient } from '@tanstack/react-query';
import type { Session } from '@slop-control/shared';
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
}

/** Status is current state, not a log: after a reconnect, read it again. */
export function refetchSessionQueries(client: QueryClient, workspaceId: string): Promise<void> {
  return client.refetchQueries({ queryKey: ['sessions', workspaceId] });
}
