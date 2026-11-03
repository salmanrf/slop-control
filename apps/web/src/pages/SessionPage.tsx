import { Checkbox, Clipboard } from '@chakra-ui/react';
import type { Session, SessionArtifact } from '@slop-control/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import {
  AppButton,
  CheckIcon,
  CopyCommand,
  ErrorMessage,
  InfoIcon,
  Mono,
  Notice,
  Panel,
  PhasePill,
  StatusDot,
  cx,
  useNow,
} from '../components/common';
import { Markdown } from '../components/Markdown';
import { ApiRequestError } from '../lib/api';
import { api } from '../lib/app-api';
import { applySessionUpdate, keys } from '../lib/session-cache';
import {
  formatClock,
  formatDuration,
  formatMoment,
  isActive,
  requiredArtifact,
  sessionTimeline,
  shortId,
  statusLabel,
  type TimelineStep,
  type Tone,
} from '../lib/session-view';
import { useStreamState } from '../lib/use-session-updates';

const STATUS_TONES: Record<Session['status'], Tone> = {
  starting: 'ok',
  running: 'ok',
  ended: 'neutral',
  failed: 'danger',
  stopped: 'neutral',
};

export function SessionPage() {
  const { workspaceId, sessionId } = useParams({ from: '/w/$workspaceId/sessions/$sessionId' });
  const client = useQueryClient();

  const session = useQuery({
    queryKey: keys.session(workspaceId, sessionId),
    queryFn: () => api.getSession(workspaceId, sessionId),
  });
  const data = session.data;
  const active = data ? isActive(data) : false;
  const now = useNow(active);

  const ticket = useQuery({
    queryKey: keys.ticket(workspaceId, data?.ticketKey ?? ''),
    queryFn: () => api.getTicket(workspaceId, data?.ticketKey ?? ''),
    enabled: Boolean(data),
    retry: false,
  });
  const artifact = useQuery({
    queryKey: keys.artifact(workspaceId, sessionId),
    queryFn: () => api.getArtifact(workspaceId, sessionId),
    enabled: data?.artifactStatus === 'complete',
    retry: false,
  });
  const stop = useMutation({
    mutationFn: () => api.stopSession(workspaceId, sessionId),
    onSuccess: (updated) => applySessionUpdate(client, updated),
  });

  if (!data) return <ErrorMessage error={session.error} />;

  return (
    <>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-1.5">
          <div className="text-[13px] text-muted">
            <Link to="/w/$workspaceId" params={{ workspaceId }} className="no-underline">
              Tickets
            </Link>{' '}
            /{' '}
            <Link
              to="/w/$workspaceId/tickets/$ticketKey"
              params={{ workspaceId, ticketKey: data.ticketKey }}
              className="font-mono no-underline"
            >
              {data.ticketKey}
            </Link>{' '}
            / <span className="font-mono">{shortId(data.id)}</span>
          </div>
          <h1 className="flex flex-wrap items-center gap-2.5 text-[24px] font-semibold tracking-[-0.01em]">
            <PhasePill phase={data.phase} className="px-2.5 py-[3px] text-[13px]" />
            {ticket.data?.title ?? data.ticketKey}
          </h1>
          <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-ink-soft">
            <StatusDot
              tone={STATUS_TONES[data.status]}
              label={`${statusLabel(data)} · ${formatDuration(data.startedAt, data.endedAt, now)}`}
            />
            <ResultPill session={data} artifact={artifact.data} />
            <span>Claude Code · auto mode</span>
            <span>
              Started {formatMoment(data.startedAt, now)}
              {data.endedAt && ` · ended ${formatMoment(data.endedAt, now)}`}
            </span>
          </div>
        </div>
        {active && (
          <AppButton tone="danger" disabled={stop.isPending} onClick={() => stop.mutate()}>
            Stop session
          </AppButton>
        )}
      </div>

      <ErrorMessage error={stop.error} />
      {data.status === 'failed' && data.statusReason && (
        <ErrorMessage error={new Error(data.statusReason)} />
      )}

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
          {active ? (
            <LiveStatusPanel session={data} now={now} />
          ) : (
            <ResultPanel session={data} artifact={artifact.data} error={artifact.error} />
          )}
          <details className="rounded-xl border border-line bg-white px-[18px] py-3">
            <summary className="cursor-pointer text-[14px] font-semibold">
              Brief <span className="font-normal text-muted">· what the agent was told</span>
            </summary>
            <pre className="mt-3 overflow-x-auto rounded-md bg-paper p-3 font-mono text-[12px] whitespace-pre-wrap">
              {data.brief}
            </pre>
          </details>
        </div>

        <aside className="flex max-w-full min-w-0 flex-[1_1_300px] flex-col gap-4 lg:max-w-[380px]">
          {active ? (
            <StopConditionPanel session={data} />
          ) : (
            <Panel label="Session status" title="Session status">
              <Timeline steps={sessionTimeline(data, now)} />
              <p className="text-[12px] text-muted">
                Session status and result status are separate: a session can end normally and still
                be incomplete when the file is missing.
              </p>
            </Panel>
          )}
          <SetupPanel />
          <WorktreePanel workspaceId={workspaceId} session={data} active={active} />
          {data.transcriptPath && (
            <Panel
              label="Transcript"
              title="Transcript"
              aside={active ? 'on disk · not live' : 'on disk'}
            >
              <Mono className="break-all text-ink-soft">{data.transcriptPath}</Mono>
            </Panel>
          )}
          <ResumePanel session={data} active={active} />
        </aside>
      </div>
    </>
  );
}

function ResultPill({
  session,
  artifact,
}: {
  session: Session;
  artifact: SessionArtifact | undefined;
}) {
  if (session.artifactStatus === 'complete') {
    return (
      <span className="rounded-full bg-ok-soft px-[9px] py-0.5 font-medium text-ok-text">
        Result complete{artifact && ` · round ${artifact.round}`}
      </span>
    );
  }
  if (session.artifactStatus === 'incomplete') {
    return (
      <span className="rounded-full bg-warn-soft px-[9px] py-0.5 font-medium text-warn-text">
        Result incomplete
      </span>
    );
  }
  return null;
}

function LiveStatusPanel({ session, now }: { session: Session; now: number }) {
  const artifactPath = requiredArtifact(session.phase);
  return (
    <section
      aria-label="Session status"
      className="flex flex-col overflow-hidden rounded-xl border border-line bg-white"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-[18px] py-3 text-[13px]">
        <span className="font-semibold">Session status</span>
        <span className="text-muted">pushed by the server · no polling</span>
        <span className="ml-auto text-[12px]">
          <ConnectionStatus />
        </span>
      </div>
      <div className="flex flex-col gap-3.5 p-[18px]">
        <Timeline steps={sessionTimeline(session, now)} />
        <div className="flex items-start gap-2.5 rounded-[10px] border border-line bg-paper-soft px-3.5 py-3 text-[13px] text-ink-soft">
          <InfoIcon />
          <span>
            Auto mode, no permission prompts: a call nothing approves is denied and the agent
            carries on, and a denial does not fail the session. Denials show up in the transcript,
            not here. If the server restarts, the session is marked failed with reason{' '}
            <Mono>server_restarted</Mono>.
          </span>
        </div>
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-dashed border-field p-4 text-[13px] text-muted">
          <div>
            <span className="font-semibold text-ink">Result</span> · appears here when the session
            ends
          </div>
          <div>
            The agent was told to write <Mono>{artifactPath}</Mono>. When the session ends, the
            server checks for it, marks the result{' '}
            <strong className="font-semibold">complete</strong> or{' '}
            <strong className="font-semibold">incomplete</strong>, and stores a copy so it stays
            readable after the worktree is removed.
          </div>
        </div>
      </div>
    </section>
  );
}

function ConnectionStatus() {
  const state = useStreamState();
  if (state === 'connected') return <StatusDot tone="ok" label="Connected" />;
  return <StatusDot tone="warn" label={state === 'connecting' ? 'Connecting…' : 'Reconnecting…'} />;
}

function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step) => (
        <li key={step.title} className="flex items-start gap-3">
          <TimelineMarker state={step.state} />
          <div
            className={cx(
              'flex min-w-0 flex-col gap-0.5',
              step.state === 'pending' && 'text-muted',
            )}
          >
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span
                className={cx(
                  'font-semibold',
                  step.state === 'current' && 'text-ok-text',
                  step.state === 'danger' && 'text-danger-text',
                  step.state === 'warn' && 'text-warn-text',
                )}
              >
                {step.title}
              </span>
              {step.at && <Mono className="text-muted">{formatClock(step.at)}</Mono>}
            </div>
            <div
              className={cx('text-[13px] break-words', step.state !== 'pending' && 'text-ink-soft')}
            >
              {step.detail}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function TimelineMarker({ state }: { state: TimelineStep['state'] }) {
  const base = 'mt-px flex size-5 shrink-0 items-center justify-center rounded-full';
  if (state === 'done') {
    return (
      <span className={cx(base, 'bg-ok text-white')}>
        <CheckIcon size={11} />
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span className={cx(base, 'border-2 border-ok')}>
        <span className="size-2 animate-pulse rounded-full bg-ok" />
      </span>
    );
  }
  if (state === 'danger') return <span className={cx(base, 'bg-danger')} />;
  if (state === 'warn') return <span className={cx(base, 'bg-warn')} />;
  return <span className={cx(base, 'border-2 border-field')} />;
}

function ResultPanel({
  session,
  artifact,
  error,
}: {
  session: Session;
  artifact: SessionArtifact | undefined;
  error: unknown;
}) {
  const path = artifact?.path ?? requiredArtifact(session.phase);
  return (
    <section
      aria-label="Result"
      className="flex flex-col overflow-hidden rounded-xl border border-line bg-white"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-[18px] py-3 text-[13px]">
        <span className="font-semibold">Result</span>
        {path && <Mono className="text-ink-soft">{path}</Mono>}
        {artifact && (
          <>
            <span className="text-muted">stored copy · round {artifact.round} · read-only</span>
            <Clipboard.Root value={artifact.markdown} className="ml-auto">
              <Clipboard.Trigger asChild aria-label="Copy markdown">
                <AppButton compact className="text-[12px]">
                  <Clipboard.Indicator copied="Copied">Copy markdown</Clipboard.Indicator>
                </AppButton>
              </Clipboard.Trigger>
            </Clipboard.Root>
          </>
        )}
      </div>
      <div className="flex flex-col gap-3 px-[26px] pt-[22px] pb-[26px]">
        {session.artifactStatus === 'incomplete' && (
          <Notice>This session didn't produce its required artifact.</Notice>
        )}
        <ErrorMessage error={error} />
        {artifact && <Markdown source={artifact.markdown} />}
      </div>
    </section>
  );
}

function StopConditionPanel({ session }: { session: Session }) {
  return (
    <Panel label="Stop condition" title="Stop condition">
      <div className="flex items-center gap-2.5 text-[13px]">
        <span className="size-[18px] shrink-0 rounded-full border-2 border-field" />
        <Mono className="min-w-0 grow break-all">{requiredArtifact(session.phase)}</Mono>
        <span className="text-muted">checked at end</span>
      </div>
      <p className="text-[12px] text-muted">
        The result is marked complete only when this file exists in the worktree. The session won't
        continue into another phase on its own.
      </p>
    </Panel>
  );
}

function SetupPanel() {
  return (
    <Panel label="Setup" title="Setup used">
      <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-2 text-[13px]">
        <dt className="text-muted">Runtime</dt>
        <dd className="font-medium">Claude Code, headless</dd>
        <dt className="text-muted">Permissions</dt>
        <dd>Auto mode, no prompts</dd>
        <dt className="text-muted">Scope</dt>
        <dd className="text-ink-soft">
          Runs in its worktree. Nothing else enforces a boundary yet.
        </dd>
      </dl>
    </Panel>
  );
}

function WorktreePanel({
  workspaceId,
  session,
  active,
}: {
  workspaceId: string;
  session: Session;
  active: boolean;
}) {
  const client = useQueryClient();
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.removeWorktree(workspaceId, session.id, discard),
    onSuccess: (updated) => {
      setDirty(false);
      applySessionUpdate(client, updated);
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === 'WORKTREE_DIRTY') setDirty(true);
    },
  });

  const removed = session.worktreeRemovedAt !== null;
  const waitingForConfirm = dirty && !discard;

  return (
    <Panel label="Worktree" title="Worktree" aside={removed ? 'removed' : undefined}>
      <Mono className="break-all text-ink-soft">{session.worktreePath}</Mono>
      <div className="text-[13px] text-ink-soft">
        Branch <Mono className="break-all">{session.branch}</Mono>
        {removed && ' · kept'}
      </div>

      {removed && session.worktreeRemovedAt && (
        <p className="text-[12px] text-muted">
          Removed {formatMoment(session.worktreeRemovedAt)}. The branch and the stored result are
          kept.
        </p>
      )}

      {dirty && !removed && (
        <div className="flex flex-col gap-2 rounded-lg border border-warn-line bg-warn-soft px-3 py-2.5 text-[13px] text-warn-text">
          <span>
            <strong className="font-semibold">Uncommitted changes</strong> in the worktree. Removing
            discards them; they exist nowhere else. The branch and the stored result are kept.
          </span>
          <Checkbox.Root
            checked={discard}
            onCheckedChange={({ checked }) => setDiscard(checked === true)}
            className="flex min-h-9 cursor-pointer items-center gap-2 text-ink"
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>Discard the uncommitted changes</Checkbox.Label>
          </Checkbox.Root>
        </div>
      )}

      {!removed && (
        <AppButton
          tone="danger"
          className="ml-auto"
          disabled={active || remove.isPending || waitingForConfirm}
          onClick={() => remove.mutate()}
        >
          Remove worktree
        </AppButton>
      )}
      {active && (
        <p className="text-[12px] text-muted">Removal is refused while the session is active.</p>
      )}
      {!(remove.error instanceof ApiRequestError && remove.error.code === 'WORKTREE_DIRTY') && (
        <ErrorMessage error={remove.error} />
      )}
    </Panel>
  );
}

function ResumePanel({ session, active }: { session: Session; active: boolean }) {
  if (session.resumeCommand) {
    return (
      <section
        aria-label="Continue in terminal"
        className="flex flex-col gap-2.5 rounded-xl bg-nav px-[18px] py-4 text-nav-text"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold">Continue in a terminal</h2>
          <span className="text-[12px] text-nav-muted">worktree exists</span>
        </div>
        <CopyCommand command={session.resumeCommand} />
        <p className="text-[12px] text-nav-muted">Hidden once the worktree is removed.</p>
      </section>
    );
  }

  return (
    <DashedNote>
      {active
        ? 'The resume command appears once the session has ended, while its worktree still exists.'
        : session.worktreeRemovedAt
          ? "The resume command is hidden because this session's worktree was removed."
          : "This session can't be resumed: the runtime never reported a session id."}
    </DashedNote>
  );
}

function DashedNote({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Resume command"
      className="flex items-start gap-2.5 rounded-xl border border-dashed border-field bg-paper-soft px-[18px] py-3.5 text-[13px] text-muted"
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="mt-0.5 shrink-0"
      >
        <path d="M3 4l4 4-4 4M8 12h5" />
      </svg>
      <span>{children}</span>
    </section>
  );
}
