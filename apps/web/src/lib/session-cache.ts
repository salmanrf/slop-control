import type { QueryClient } from '@tanstack/react-query';
import type { Session } from '@slop-control/shared';

export const keys = {
  workspaces: () => ['workspaces'] as const,
  workspace: (workspaceId: string) => ['workspaces', workspaceId] as const,
  repos: (workspaceId: string) => ['repos', workspaceId] as const,
  tickets: (workspaceId: string, linkedRepoId: string, search: string, state: string) =>
    ['tickets', workspaceId, linkedRepoId, search, state] as const,
  ticket: (workspaceId: string, ticketKey: string) => ['ticket', workspaceId, ticketKey] as const,
  ticketSessions: (workspaceId: string, ticketKey: string) =>
    ['sessions', workspaceId, 'ticket', ticketKey] as const,
  session: (workspaceId: string, sessionId: string) =>
    ['sessions', workspaceId, 'session', sessionId] as const,
  artifact: (workspaceId: string, sessionId: string) =>
    ['sessions', workspaceId, 'artifact', sessionId] as const,
};

/** Each frame carries the full session, so the cache needs no refetch. */
export function applySessionUpdate(client: QueryClient, session: Session): void {
  client.setQueryData(keys.session(session.workspaceId, session.id), session);

  client.setQueryData<Session[]>(
    keys.ticketSessions(session.workspaceId, session.ticketKey),
    (list) => {
      if (!list) return list;
      return list.some((item) => item.id === session.id)
        ? list.map((item) => (item.id === session.id ? session : item))
        : [session, ...list];
    },
  );

  if (session.artifactStatus) {
    void client.invalidateQueries({ queryKey: keys.artifact(session.workspaceId, session.id) });
  }
}

/** Status is current state, not a log: after a reconnect, read it again. */
export function refetchSessionQueries(client: QueryClient, workspaceId: string): Promise<void> {
  return client.refetchQueries({ queryKey: ['sessions', workspaceId] });
}
