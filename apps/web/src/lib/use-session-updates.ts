import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { applySessionUpdate, refetchSessionQueries } from './session-cache';
import { connectSessionUpdates } from './session-stream';
import { getToken, handleExpiredSignIn } from './supabase';

/** Holds the workspace's one status stream open while a view under it is mounted. */
export function useSessionUpdates(workspaceId: string): void {
  const client = useQueryClient();

  useEffect(
    () =>
      connectSessionUpdates({
        workspaceId,
        getToken,
        onSession: (session) => applySessionUpdate(client, session),
        onConnected: () => void refetchSessionQueries(client, workspaceId),
        onUnauthorized: handleExpiredSignIn,
      }),
    [client, workspaceId],
  );
}
