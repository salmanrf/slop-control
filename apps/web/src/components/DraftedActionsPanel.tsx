import type {
  DraftedAction,
  DraftedActionDetail,
  UpdateDraftedActionBody,
} from '@slop-control/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiRequestError } from '../lib/api';
import { api } from '../lib/app-api';
import {
  actionAnchor,
  actionResult,
  actionStatus,
  actionSummary,
  actionTypeLabel,
  isWaiting,
} from '../lib/drafted-actions';
import { applyActionUpdate, keys } from '../lib/session-cache';
import { formatMoment } from '../lib/session-view';
import {
  AppButton,
  ErrorMessage,
  LabeledInput,
  LabeledSelect,
  LabeledTextArea,
  Mono,
  Notice,
  StatusDot,
} from './common';
import { SessionDiffView, UncommittedList } from './DiffView';
import { Markdown } from './Markdown';

export function useSessionActions(workspaceId: string, sessionId: string) {
  return useQuery({
    queryKey: keys.sessionActions(workspaceId, sessionId),
    queryFn: () => api.listSessionActions(workspaceId, sessionId),
  });
}

/** What the workspace drafted from this session's rounds. Nothing here is sent until approved. */
export function DraftedActionsPanel({
  workspaceId,
  sessionId,
  sessionActive,
}: {
  workspaceId: string;
  sessionId: string;
  /** While a round runs it could commit during a push, so an open PR can't be approved. */
  sessionActive: boolean;
}) {
  const actions = useSessionActions(workspaceId, sessionId);
  if (actions.error) return <ErrorMessage error={actions.error} />;
  if (!actions.data || actions.data.length === 0) return null;

  return (
    <section
      aria-label="Drafted actions"
      className="flex flex-col gap-3 rounded-xl border border-line bg-white px-[18px] py-4"
    >
      <h2 className="text-[14px] font-semibold">
        Drafted actions{' '}
        <span className="font-normal text-muted">· nothing is sent until you approve it</span>
      </h2>
      {actions.data.map((action) => (
        <ActionCard
          key={action.id}
          workspaceId={workspaceId}
          action={action}
          sessionActive={sessionActive}
        />
      ))}
    </section>
  );
}

function ActionCard({
  workspaceId,
  action,
  sessionActive,
}: {
  workspaceId: string;
  action: DraftedAction;
  sessionActive: boolean;
}) {
  const client = useQueryClient();
  const anchor = actionAnchor(action.id);
  const card = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const waiting = isWaiting(action);
  const status = actionStatus(action);
  const result = actionResult(action);

  // The inbox links here before the actions have loaded, so the browser's own jump finds nothing.
  useEffect(() => {
    if (window.location.hash === `#${anchor}`) card.current?.scrollIntoView({ block: 'start' });
  }, [anchor]);

  // The branch state and the ticket's statuses are read only while there's a decision to make.
  const detailKey = keys.actionDetail(workspaceId, action.id);
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () => api.getDraftedAction(workspaceId, action.id),
    enabled: waiting && action.type !== 'ticket_comment',
  });
  const branch = waiting ? (detail.data?.branch ?? null) : null;

  const onRefused = (error: unknown) => {
    if (!(error instanceof ApiRequestError)) return;
    if (error.code === 'ACTION_STALE') void client.invalidateQueries({ queryKey: detailKey });
    if (error.code === 'ACTION_ALREADY_DECIDED') {
      void client.invalidateQueries({ queryKey: keys.actions(workspaceId) });
    }
  };
  const approve = useMutation({
    mutationFn: () =>
      api.approveAction(
        workspaceId,
        action.id,
        action.type === 'open_pr' ? { expectedHeadCommit: branch?.headCommit } : {},
      ),
    onSuccess: (updated) => applyActionUpdate(client, updated),
    onError: onRefused,
  });
  const reject = useMutation({
    mutationFn: () => api.rejectAction(workspaceId, action.id),
    onSuccess: (updated) => applyActionUpdate(client, updated),
    onError: onRefused,
  });
  const busy = approve.isPending || reject.isPending;
  // An open PR is approved for the commit that was shown, so there has to be one to show.
  const canApprove = action.type !== 'open_pr' || branch !== null;
  const heldByRound = action.type === 'open_pr' && sessionActive;

  return (
    <article
      ref={card}
      id={anchor}
      aria-label={`${actionTypeLabel(action)} action`}
      data-testid={`drafted-action-${action.id}`}
      data-action-type={action.type}
      data-action-status={action.status}
      className="flex scroll-mt-4 flex-col gap-2.5 rounded-lg border border-line px-3.5 py-3 target:border-accent"
    >
      <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
        <h3 className="font-semibold">{actionTypeLabel(action)}</h3>
        <span data-testid="action-status">
          <StatusDot tone={status.tone} label={status.label} />
        </span>
        {action.edited && <span className="text-[12px] text-muted">edited</span>}
        <span className="ml-auto text-[12px] text-muted">
          drafted {formatMoment(action.createdAt)} · round {action.round}
        </span>
      </div>

      {editing && waiting ? (
        <EditForm
          workspaceId={workspaceId}
          action={action}
          detail={detail.data}
          onDone={() => setEditing(false)}
        />
      ) : (
        <ActionPayload action={action} />
      )}

      {result && (
        <p data-testid="action-result" className="text-[13px] font-medium text-ok-text">
          {result.url ? (
            <a href={result.url} target="_blank" rel="noreferrer">
              {result.text}
            </a>
          ) : (
            result.text
          )}
        </p>
      )}
      {action.status === 'failed' && action.error && (
        <div
          role="alert"
          data-testid="action-error"
          className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2.5 text-[13px] break-words text-danger-text"
        >
          <strong className="font-semibold">The last attempt failed.</strong> {action.error}
        </div>
      )}

      {waiting && action.type === 'open_pr' && (
        <BranchSummary
          workspaceId={workspaceId}
          sessionId={action.sessionId}
          detail={detail.data}
          error={detail.error}
        />
      )}

      <ErrorMessage error={approve.error} />
      <ErrorMessage error={reject.error} />

      {waiting && !editing && (
        <div className="flex flex-wrap justify-end gap-2">
          <AppButton compact disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </AppButton>
          <AppButton compact tone="danger" disabled={busy} onClick={() => reject.mutate()}>
            Reject
          </AppButton>
          {heldByRound ? (
            <span className="self-center text-[12px] text-muted" role="status">
              Approve once the session's round has ended.
            </span>
          ) : (
            <AppButton
              compact
              tone="primary"
              disabled={busy || !canApprove}
              onClick={() => approve.mutate()}
            >
              Approve
            </AppButton>
          )}
        </div>
      )}
    </article>
  );
}

function ActionPayload({ action }: { action: DraftedAction }) {
  if (action.type === 'ticket_transition') {
    return (
      <p className="text-[13px] text-ink-soft">
        Move <Mono>{action.ticketKey}</Mono> to{' '}
        <strong className="font-semibold text-ink">{action.payload.toStatus}</strong>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {action.type === 'open_pr' ? (
        <>
          <p className="font-medium break-words">{action.payload.title}</p>
          <p className="text-[12px] text-muted">
            <Mono className="break-all">{action.payload.headBranch}</Mono> into{' '}
            <Mono className="break-all">{action.payload.baseBranch}</Mono>
          </p>
        </>
      ) : (
        <p className="text-[12px] text-muted">{actionSummary(action)}</p>
      )}
      <div className="max-h-80 overflow-y-auto rounded-md bg-paper-soft px-3.5 py-3 text-[13px]">
        <Markdown source={action.payload.body} />
      </div>
    </div>
  );
}

/** What approving an open PR would push, as the branch stands now. */
function BranchSummary({
  workspaceId,
  sessionId,
  detail,
  error,
}: {
  workspaceId: string;
  sessionId: string;
  detail: DraftedActionDetail | undefined;
  error: unknown;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const branch = detail?.branch;
  if (error) return <ErrorMessage error={error} />;
  if (detail && !branch) {
    return (
      <p className="text-[12px] text-muted" role="status">
        This session's branch isn't in the clone any more, so there is nothing to push.
      </p>
    );
  }
  if (!branch) return <p className="text-[12px] text-muted">Reading the branch…</p>;

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-paper-soft px-3 py-2.5 text-[13px] text-ink-soft">
      <p>
        Approving pushes{' '}
        <strong className="font-semibold text-ink" data-testid="action-commit-count">
          {branch.commitCount} {branch.commitCount === 1 ? 'commit' : 'commits'}
        </strong>
        , up to{' '}
        <span data-testid="action-head-commit">
          <Mono>{branch.headCommit.slice(0, 8)}</Mono>
        </span>
        , and opens the pull request.
      </p>
      {branch.uncommitted && branch.uncommitted.length > 0 && (
        <div className="flex flex-col gap-1 text-warn-text">
          <span>
            <strong className="font-semibold">Not part of this PR:</strong> uncommitted files left
            in the worktree.
          </span>
          <UncommittedList label="Uncommitted files, not in this PR" files={branch.uncommitted} />
        </div>
      )}
      {/* Rendered only once opened: the page's own Changes panel already holds the same diff. */}
      <details onToggle={(event) => setShowDiff(event.currentTarget.open)}>
        <summary className="cursor-pointer font-medium text-ink">Changes to push</summary>
        {showDiff && (
          <div className="mt-2.5">
            <SessionDiffView workspaceId={workspaceId} sessionId={sessionId} />
          </div>
        )}
      </details>
    </div>
  );
}

function EditForm({
  workspaceId,
  action,
  detail,
  onDone,
}: {
  workspaceId: string;
  action: DraftedAction;
  detail: DraftedActionDetail | undefined;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [title, setTitle] = useState(action.type === 'open_pr' ? action.payload.title : '');
  const [body, setBody] = useState(action.type === 'ticket_transition' ? '' : action.payload.body);
  const [toStatus, setToStatus] = useState(
    action.type === 'ticket_transition' ? action.payload.toStatus : '',
  );
  const changes = (): UpdateDraftedActionBody => {
    if (action.type === 'open_pr') return { title, body };
    if (action.type === 'ticket_comment') return { body };
    return { toStatus };
  };
  const save = useMutation({
    mutationFn: () => api.updateDraftedAction(workspaceId, action.id, changes()),
    onSuccess: (updated) => {
      applyActionUpdate(client, updated);
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const transitions = detail?.transitions ?? null;
  // The drafted target stays selectable even if the ticket can no longer move there.
  const targets =
    transitions && action.type === 'ticket_transition'
      ? [...new Set([action.payload.toStatus, ...transitions.map((item) => item.status)])]
      : [];

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      {action.type === 'open_pr' && (
        <LabeledInput
          label="PR title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      )}
      {action.type !== 'ticket_transition' && (
        <LabeledTextArea
          label={action.type === 'open_pr' ? 'PR body (markdown)' : 'Comment (markdown)'}
          rows={10}
          mono
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      )}
      {action.type === 'ticket_transition' &&
        (transitions ? (
          <LabeledSelect
            label="Move ticket to"
            value={toStatus}
            onChange={(event) => setToStatus(event.target.value)}
          >
            {targets.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </LabeledSelect>
        ) : (
          <Notice tone="info">
            {detail
              ? "The ticket's source can't be read right now, so the target status can't be changed."
              : 'Reading the statuses this ticket can move to…'}
          </Notice>
        ))}
      <ErrorMessage error={save.error} />
      <div className="flex flex-wrap justify-end gap-2">
        <AppButton compact onClick={onDone}>
          Cancel
        </AppButton>
        <AppButton
          compact
          tone="primary"
          type="submit"
          disabled={save.isPending || (action.type === 'ticket_transition' && !transitions)}
        >
          Save changes
        </AppButton>
      </div>
    </form>
  );
}
