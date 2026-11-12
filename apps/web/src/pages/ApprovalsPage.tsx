import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ErrorMessage, Mono, PhasePill, StatusDot } from '../components/common';
import { api } from '../lib/app-api';
import {
  actionAnchor,
  actionStatus,
  actionSummary,
  actionTypeLabel,
  inboxActions,
} from '../lib/drafted-actions';
import { keys } from '../lib/session-cache';
import { formatMoment } from '../lib/session-view';

/** Lists what is waiting on the developer. Deciding happens on the session, with the work in view. */
export function ApprovalsPage() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId/approvals' });
  const inbox = useQuery({
    queryKey: keys.inbox(workspaceId),
    queryFn: () => api.listDraftedActions(workspaceId),
  });
  const actions = inboxActions(inbox.data ?? []);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Approvals</h1>
        <p className="max-w-[720px] text-[13px] text-muted">
          Drafted actions of this workspace that are waiting for you, or failed when they were sent,
          newest first. Open one to read the work, then edit, approve, or reject it on its session.
        </p>
      </div>

      <ErrorMessage error={inbox.error} />

      {inbox.data && actions.length === 0 && (
        <p className="rounded-xl border border-dashed border-field bg-paper-soft px-[18px] py-6 text-center text-[13px] text-muted">
          Nothing is waiting for approval.
        </p>
      )}
      {actions.length > 0 && (
        <ul aria-label="Actions waiting for approval" className="flex flex-col gap-2.5">
          {actions.map((action) => {
            const status = actionStatus(action);
            return (
              <li
                key={action.id}
                data-testid={`inbox-action-${action.id}`}
                data-action-type={action.type}
                data-action-status={action.status}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-line bg-white px-[18px] py-3.5"
              >
                <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
                  <Link
                    to="/w/$workspaceId/sessions/$sessionId"
                    params={{ workspaceId, sessionId: action.sessionId }}
                    hash={actionAnchor(action.id)}
                    className="font-medium no-underline"
                  >
                    {actionTypeLabel(action)} · {action.ticketTitle || action.ticketKey}
                  </Link>
                  <span className="text-[12px] text-muted">
                    {action.type === 'open_pr' && (
                      <>
                        <Mono>{action.ticketKey}</Mono> ·{' '}
                      </>
                    )}
                    {actionSummary(action)}
                  </span>
                </div>
                <PhasePill phase={action.phase} />
                <span className="text-[13px]">
                  <StatusDot tone={status.tone} label={status.label} />
                </span>
                <span className="text-[12px] whitespace-nowrap text-muted">
                  Drafted {formatMoment(action.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
