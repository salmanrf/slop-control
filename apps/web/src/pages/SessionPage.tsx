import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import {
  ArtifactBadge,
  CopyCommand,
  ErrorMessage,
  StatusBadge,
  formatTime,
  phaseLabel,
} from '../components/common';
import { Markdown } from '../components/Markdown';
import { ApiRequestError } from '../lib/api';
import { api } from '../lib/app-api';
import { applySessionUpdate, keys } from '../lib/session-cache';
import { useSessionUpdates } from '../lib/use-session-updates';

export function SessionPage() {
  const { workspaceId, sessionId } = useParams({ from: '/w/$workspaceId/sessions/$sessionId' });
  const client = useQueryClient();
  useSessionUpdates(workspaceId);

  const session = useQuery({
    queryKey: keys.session(workspaceId, sessionId),
    queryFn: () => api.getSession(workspaceId, sessionId),
  });
  const artifact = useQuery({
    queryKey: keys.artifact(workspaceId, sessionId),
    queryFn: () => api.getArtifact(workspaceId, sessionId),
    enabled: session.data?.artifactStatus === 'complete',
    retry: false,
  });

  const stop = useMutation({
    mutationFn: () => api.stopSession(workspaceId, sessionId),
    onSuccess: (updated) => applySessionUpdate(client, updated),
  });

  const remove = useMutation({
    mutationFn: async () => {
      try {
        return await api.removeWorktree(workspaceId, sessionId, false);
      } catch (error) {
        const dirty = error instanceof ApiRequestError && error.code === 'WORKTREE_DIRTY';
        const confirmed =
          dirty &&
          window.confirm(
            'This worktree has uncommitted changes that exist nowhere else. Remove it and lose them?',
          );
        if (!confirmed) throw error;
        return api.removeWorktree(workspaceId, sessionId, true);
      }
    },
    onSuccess: (updated) => applySessionUpdate(client, updated),
  });

  const data = session.data;
  const active = data?.status === 'starting' || data?.status === 'running';

  return (
    <main>
      <ErrorMessage error={session.error} />
      {data && (
        <>
          <p>
            <Link
              to="/w/$workspaceId/tickets/$ticketKey"
              params={{ workspaceId, ticketKey: data.ticketKey }}
            >
              Back to {data.ticketKey}
            </Link>
          </p>
          <h1>
            {phaseLabel(data.phase)} <StatusBadge status={data.status} />{' '}
            <ArtifactBadge status={data.artifactStatus} />
          </h1>
          {data.statusReason && (
            <p className="error" role="status">
              {data.statusReason}
            </p>
          )}
          <dl>
            <dt>Started</dt>
            <dd>{formatTime(data.startedAt)}</dd>
            <dt>Ended</dt>
            <dd>{formatTime(data.endedAt)}</dd>
            <dt>Branch</dt>
            <dd>
              <code>{data.branch}</code>
            </dd>
            <dt>Worktree</dt>
            <dd>
              {data.worktreeRemovedAt ? (
                <em>removed {formatTime(data.worktreeRemovedAt)}</em>
              ) : (
                <code>{data.worktreePath}</code>
              )}
            </dd>
          </dl>

          {data.resumeCommand && (
            <section>
              <h2>Continue in a terminal</h2>
              <CopyCommand command={data.resumeCommand} />
            </section>
          )}

          <div className="row">
            {active && (
              <button type="button" disabled={stop.isPending} onClick={() => stop.mutate()}>
                Stop session
              </button>
            )}
            {!active && !data.worktreeRemovedAt && (
              <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()}>
                Remove worktree
              </button>
            )}
          </div>
          <ErrorMessage error={stop.error ?? remove.error} />

          <section>
            <h2>Result</h2>
            {active && <p>The result appears here when the session ends.</p>}
            {data.artifactStatus === 'incomplete' && (
              <p className="notice">This session didn't produce its required artifact.</p>
            )}
            <ErrorMessage error={artifact.error} />
            {artifact.data && <Markdown source={artifact.data.markdown} />}
          </section>

          <details>
            <summary>Brief</summary>
            <pre>{data.brief}</pre>
          </details>
        </>
      )}
    </main>
  );
}
