import { Checkbox, Clipboard } from '@chakra-ui/react';
import type { LinkedRepo, Session, SessionArtifact, TicketSource } from '@slop-control/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  AppButton,
  CheckIcon,
  CopyCommand,
  ErrorMessage,
  InfoIcon,
  LabeledTextArea,
  Mono,
  Notice,
  Panel,
  PhasePill,
  StatusDot,
  cx,
  useNow,
} from '../components/common';
import { SessionDiffView, useSessionDiff } from '../components/DiffView';
import { DraftedActionsPanel, useSessionActions } from '../components/DraftedActionsPanel';
import { Markdown } from '../components/Markdown';
import { ApiRequestError } from '../lib/api';
import { api } from '../lib/app-api';
import { nothingToPush } from '../lib/drafted-actions';
import { applySessionUpdate, keys } from '../lib/session-cache';
import {
  formatClock,
  formatDuration,
  continueMessage,
  followUpAction,
  formatMoment,
  isActive,
  phaseLabel,
  resultWording,
  roundLabel,
  scopeFlagLabel,
  sessionArtifactPath,
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

  const sources = useQuery({
    queryKey: keys.sources(workspaceId),
    queryFn: () => api.listSources(workspaceId),
  });
  const repos = useQuery({
    queryKey: keys.repos(workspaceId),
    queryFn: () => api.listRepos(workspaceId),
  });
  // Read in every state: while a later round runs, the previous round's copy stays readable.
  const artifact = useQuery({
    queryKey: keys.artifact(workspaceId, sessionId),
    queryFn: () => api.getArtifact(workspaceId, sessionId),
    enabled: Boolean(data),
    retry: false,
  });
  const artifactError =
    artifact.error instanceof ApiRequestError && artifact.error.code === 'NOT_FOUND'
      ? null
      : artifact.error;
  const stop = useMutation({
    mutationFn: () => api.stopSession(workspaceId, sessionId),
    onSuccess: (updated) => applySessionUpdate(client, updated),
  });

  if (!data) return <ErrorMessage error={session.error} />;
  const flag = scopeFlagLabel(data.scopeFlags);

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
              to="/w/$workspaceId/sources/$sourceId/tickets/$ticketKey"
              params={{ workspaceId, sourceId: data.ticketSourceId, ticketKey: data.ticketKey }}
              className="font-mono no-underline"
            >
              {data.ticketKey}
            </Link>{' '}
            / <span className="font-mono">{shortId(data.id)}</span>
          </div>
          <h1 className="flex flex-wrap items-center gap-2.5 text-[24px] font-semibold tracking-[-0.01em]">
            <PhasePill phase={data.phase} className="px-2.5 py-[3px] text-[13px]" />
            {data.ticketTitle || data.ticketKey}
          </h1>
          <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-ink-soft">
            {roundLabel(data) && (
              <span className="rounded-full border border-line bg-white px-[9px] py-0.5 font-medium">
                {roundLabel(data)}
              </span>
            )}
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
          {flag && (
            <Notice>
              <strong className="font-semibold">Scope flag: {flag}.</strong> This phase is
              read-only, but the worktree has code changes or new commits. The result and status
              below are unchanged; check the branch before relying on it.
            </Notice>
          )}
          {data.baseFetchFailed && (
            <Notice>
              <strong className="font-semibold">The base couldn't be fetched</strong> before this
              session started, so <Mono>{data.baseRef}</Mono> was used as it was in the clone. The
              branch, and a pull request from it, may start behind the remote.
            </Notice>
          )}
          {active && <LiveStatusPanel session={data} now={now} />}
          {(!active || artifact.data) && (
            <ResultPanel
              session={data}
              artifact={artifact.data}
              error={artifactError}
              previous={active}
            />
          )}
          <DraftedActionsPanel
            workspaceId={workspaceId}
            sessionId={sessionId}
            sessionActive={active}
          />
          <NothingToPush workspaceId={workspaceId} session={data} />
          <Panel label="Changes" title="Changes" aside="against the commit it started from">
            <SessionDiffView workspaceId={workspaceId} sessionId={sessionId} />
          </Panel>
          <FollowUpPanel workspaceId={workspaceId} session={data} />
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
          <SetupPanel
            session={data}
            source={sources.data?.find((item) => item.id === data.ticketSourceId)}
            repo={repos.data?.find((item) => item.id === data.linkedRepoId)}
          />
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
  const wording = resultWording(session, artifact?.round ?? null);
  if (!wording) return null;
  return (
    <span
      className={cx(
        'rounded-full px-[9px] py-0.5 font-medium',
        wording.tone === 'ok' ? 'bg-ok-soft text-ok-text' : 'bg-warn-soft text-warn-text',
      )}
    >
      {wording.label}
    </span>
  );
}

/** Stands in for the open PR action an implementation session with no commits doesn't get. */
function NothingToPush({ workspaceId, session }: { workspaceId: string; session: Session }) {
  const actions = useSessionActions(workspaceId, session.id);
  const diff = useSessionDiff(workspaceId, session.id);
  const nothing = nothingToPush(session, actions.data, diff.data);
  if (!nothing) return null;
  return (
    <Notice tone="info">
      <strong className="font-semibold">Nothing to push.</strong> This session committed nothing to
      its branch, so no pull request was drafted.
      {nothing.uncommitted.length > 0 && (
        <>
          {' '}
          It left uncommitted files in the worktree, which are never pushed:{' '}
          {nothing.uncommitted.map((file, index) => (
            <span key={file.path}>
              {index > 0 && ', '}
              <Mono className="break-all">{file.path}</Mono>
            </span>
          ))}
          .
        </>
      )}
    </Notice>
  );
}

function LiveStatusPanel({ session, now }: { session: Session; now: number }) {
  const artifactPath = sessionArtifactPath(session);
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
  previous,
}: {
  session: Session;
  artifact: SessionArtifact | undefined;
  error: unknown;
  /** True while a later round runs and this is the earlier round's copy. */
  previous: boolean;
}) {
  const path = artifact?.path ?? sessionArtifactPath(session);
  const wording = resultWording(session, artifact?.round ?? null);
  return (
    <section
      aria-label={previous ? 'Previous result' : 'Result'}
      className="flex flex-col overflow-hidden rounded-xl border border-line bg-white"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-[18px] py-3 text-[13px]">
        <span className="font-semibold">{previous ? 'Previous result' : 'Result'}</span>
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
        {previous && (
          <Notice tone="info">
            Round {session.round} is running. This is the copy stored by round {artifact?.round}.
          </Notice>
        )}
        {!previous && wording?.detail && <Notice>{wording.detail}</Notice>}
        <ErrorMessage error={error} />
        {artifact && <Markdown source={artifact.markdown} />}
      </div>
    </section>
  );
}

/** Continues an ended session from the dashboard, as a new round. */
function FollowUpPanel({ workspaceId, session }: { workspaceId: string; session: Session }) {
  const client = useQueryClient();
  const action = followUpAction(session);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const send = useMutation({
    mutationFn: () => api.sendMessage(workspaceId, session.id, message),
    onSuccess: (updated) => {
      setMessage('');
      setOpen(false);
      applySessionUpdate(client, updated);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send.mutate();
  };

  if (action === 'none') return null;
  if (action === 'not_resumable') {
    return (
      <section
        aria-label="Follow-up"
        className="rounded-xl border border-dashed border-field bg-paper-soft px-[18px] py-3.5 text-[13px] text-muted"
      >
        This session can't be continued, because Claude Code never started it. Start a new session
        on the ticket instead.
      </section>
    );
  }

  return (
    <section
      aria-label="Follow-up"
      className="flex flex-col gap-3 rounded-xl border border-line bg-white px-[18px] py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold">
          Follow-up{' '}
          <span className="font-normal text-muted">
            · resumes this session as round {session.round + 1}, with its context kept
          </span>
        </h2>
        {action === 'continue' && !open && (
          <AppButton
            tone="warn"
            onClick={() => {
              setMessage(continueMessage(session));
              setOpen(true);
            }}
          >
            Continue
          </AppButton>
        )}
      </div>
      {action === 'continue' && !open && (
        <p className="text-[13px] text-ink-soft">
          This session ended without its required artifact. Continue asks it to finish; you can
          change the message before sending.
        </p>
      )}
      {(action === 'follow_up' || open) && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <LabeledTextArea
            label="Follow-up message"
            rows={4}
            required
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <p className="text-[12px] text-muted">
            Runs with the setup this session started with
            {session.worktreeRemovedAt && ', after restoring its worktree from its branch'}. A round
            that doesn't change the artifact ends as incomplete.
          </p>
          <ErrorMessage error={send.error} />
          <AppButton tone="primary" type="submit" className="self-end" disabled={send.isPending}>
            Send follow-up
          </AppButton>
        </form>
      )}
    </section>
  );
}

function StopConditionPanel({ session }: { session: Session }) {
  return (
    <Panel label="Stop condition" title="Stop condition">
      <div className="flex items-center gap-2.5 text-[13px]">
        <span className="size-[18px] shrink-0 rounded-full border-2 border-field" />
        <Mono className="min-w-0 grow break-all">{sessionArtifactPath(session)}</Mono>
        <span className="text-muted">checked at end</span>
      </div>
      <p className="text-[12px] text-muted">
        The result is marked complete only when this file exists in the worktree. The session won't
        continue into another phase on its own.
      </p>
    </Panel>
  );
}

function SetupPanel({
  session,
  source,
  repo,
}: {
  session: Session;
  source: TicketSource | undefined;
  repo: LinkedRepo | undefined;
}) {
  const { setup } = session;
  return (
    <Panel label="Setup" title="Setup used" aside="recorded at start">
      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[13px]">
        <dt className="text-muted">Ticket</dt>
        <dd className="break-words">
          <Mono>{session.ticketKey}</Mono> · {source?.label ?? 'Unknown source'}
          {source?.disconnectedAt && ' (disconnected)'}
        </dd>
        <dt className="text-muted">Repo</dt>
        <dd className="break-all">{repo ? `${repo.githubOwner}/${repo.githubRepo}` : '—'}</dd>
        <dt className="text-muted">Runtime</dt>
        <dd className="font-medium">Claude Code, headless · auto mode</dd>
        <dt className="text-muted">Instruction</dt>
        <dd className="break-words text-ink-soft">{setup.instruction}</dd>
        <dt className="text-muted">Scope</dt>
        <dd className="text-ink-soft">
          {setup.scope.mayChangeCode ? 'May change code' : 'Read-only: code changes are flagged'}
          <span className="block text-[12px] text-muted">
            Cut off from pushing, gh, SSH, and account connectors.
          </span>
        </dd>
        <dt className="text-muted">Stops when</dt>
        <dd>
          <Mono className="break-all">{setup.stopCondition.requiredArtifactPath}</Mono>
        </dd>
        <dt className="text-muted">~/.claude</dt>
        <dd>{setup.userLevelSource ? 'User-level source on' : 'User-level source off'}</dd>
        <dt className="text-muted">Started from</dt>
        <dd>
          <Mono className="break-all">{session.baseRef}</Mono>
          {session.baseCommit && (
            <span className="text-muted">
              {' '}
              at <Mono>{session.baseCommit.slice(0, 8)}</Mono>
            </span>
          )}
        </dd>
        <dt className="text-muted">Given</dt>
        <dd>
          {session.inputArtifacts.length === 0 ? (
            'No earlier artifacts'
          ) : (
            <ul aria-label="Earlier artifacts" className="flex flex-col gap-1">
              {session.inputArtifacts.map((artifact) => (
                <li key={artifact.path}>
                  {phaseLabel(artifact.phase)} · <Mono className="break-all">{artifact.path}</Mono>
                </li>
              ))}
            </ul>
          )}
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
    // A terminal session runs with the developer's own logins, outside the baseline scope.
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
        <p className="text-[12px] text-nav-muted">
          Runs with your own permissions and logins, not the session's scope. Hidden once the
          worktree is removed.
        </p>
      </section>
    );
  }

  return (
    <DashedNote>
      {active
        ? 'The resume command appears once the session has ended, while its worktree still exists.'
        : session.worktreeRemovedAt
          ? "The resume command is hidden because this session's worktree was removed."
          : "This session can't be resumed: Claude Code never reported a session ID."}
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
