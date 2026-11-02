import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState } from 'react';
import { applySessionUpdate, refetchSessionQueries } from './session-cache';
import { connectSessionUpdates } from './session-stream';
import { getToken, handleExpiredSignIn } from './supabase';

export type StreamState = 'connecting' | 'connected' | 'reconnecting';

/**
 * Holds the workspace's one status stream open while a view under it is mounted.
 * @return whether the stream is live, so a view can say when its status might be out of date
 */
export function useSessionUpdates(workspaceId: string): StreamState {
  const client = useQueryClient();
  const [state, setState] = useState<StreamState>('connecting');

  useEffect(() => {
    setState('connecting');
    return connectSessionUpdates({
      workspaceId,
      getToken,
      onSession: (session) => applySessionUpdate(client, session),
      onConnected: () => {
        setState('connected');
        void refetchSessionQueries(client, workspaceId);
      },
      onDisconnected: () => setState('reconnecting'),
      onUnauthorized: handleExpiredSignIn,
    });
  }, [client, workspaceId]);

  return state;
}

export const StreamStateContext = createContext<StreamState>('connecting');

export const useStreamState = () => useContext(StreamStateContext);
