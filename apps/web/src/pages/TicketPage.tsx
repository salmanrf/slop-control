import type { LaunchablePhase } from '@slop-control/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ArtifactBadge,
  ErrorMessage,
  StatusBadge,
  formatTime,
  phaseLabel,
} from '../components/common';
import { Markdown } from '../components/Markdown';
import { api } from '../lib/app-api';
import { applySessionUpdate, keys } from '../lib/session-cache';
import { useSessionUpdates } from '../lib/use-session-updates';

const LAUNCHABLE_PHASES: LaunchablePhase[] = [
  'investigation',
  'planning',
  'implementation',
  'code_review',
];

export function TicketPage() {
  const { workspaceId, ticketKey } = useParams({ from: '/w/$workspaceId/tickets/$ticketKey' });
  const client = useQueryClient();
  const [phase, setPhase] = useState<LaunchablePhase>('investigation');
  useSessionUpdates(workspaceId);

  const ticket = useQuery({
    queryKey: keys.ticket(workspaceId, ticketKey),
    queryFn: () => api.getTicket(workspaceId, ticketKey),
    retry: false,
  });
  const sessions = useQuery({
    queryKey: keys.ticketSessions(workspaceId, ticketKey),
    queryFn: () => api.listTicketSessions(workspaceId, ticketKey),
  });
  const start = useMutation({
    mutationFn: () => api.startSession(workspaceId, ticketKey, phase),
    onSuccess: (session) => applySessionUpdate(client, session),
  });

  return (
    <main>
      <p>
        <Link to="/w/$workspaceId" params={{ workspaceId }}>
          Back to tickets
        </Link>
      </p>
      <ErrorMessage error={ticket.error} />
      {ticket.data && (
        <>
          <h1>{ticket.data.title}</h1>
          <p>
            <span className="badge">{ticket.data.status}</span>{' '}
            <a href={ticket.data.url} target="_blank" rel="noopener noreferrer">
              {ticket.data.key}
            </a>
          </p>
          <Markdown source={ticket.data.body || '_No description._'} />
        </>
      )}

      <section>
        <h2>Start a session</h2>
        <div className="row">
          <select
            aria-label="Phase"
            value={phase}
            onChange={(event) => setPhase(event.target.value as LaunchablePhase)}
          >
            {LAUNCHABLE_PHASES.map((item) => (
              <option key={item} value={item}>
                {phaseLabel(item)}
              </option>
            ))}
          </select>
          <button type="button" disabled={start.isPending} onClick={() => start.mutate()}>
            Start session
          </button>
        </div>
        <ErrorMessage error={start.error} />
      </section>

      <section>
        <h2>Sessions</h2>
        <ErrorMessage error={sessions.error} />
        {sessions.data?.length === 0 && <p>No sessions yet.</p>}
        {sessions.data && sessions.data.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Phase</th>
                <th>Status</th>
                <th>Result</th>
                <th>Started</th>
                <th>Ended</th>
                <th>Worktree</th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.map((session) => (
                <tr key={session.id}>
                  <td>
                    <Link
                      to="/w/$workspaceId/sessions/$sessionId"
                      params={{ workspaceId, sessionId: session.id }}
                    >
                      {phaseLabel(session.phase)}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={session.status} />
                  </td>
                  <td>
                    <ArtifactBadge status={session.artifactStatus} />
                  </td>
                  <td>{formatTime(session.startedAt)}</td>
                  <td>{formatTime(session.endedAt)}</td>
                  <td>
                    {session.worktreeRemovedAt ? (
                      <em>removed</em>
                    ) : (
                      <code>{session.worktreePath}</code>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
