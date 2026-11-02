import { RadioGroup } from '@chakra-ui/react';
import type { LaunchablePhase, Phase, Session } from '@slop-control/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import {
  AppButton,
  CheckIcon,
  InfoIcon,
  Mono,
  PhasePill,
  PlayIcon,
  SessionOutcome,
  ErrorMessage,
  cx,
  phaseColors,
  useNow,
} from '../components/common';
import { Markdown } from '../components/Markdown';
import { ApiRequestError } from '../lib/api';
import { api } from '../lib/app-api';
import { applySessionUpdate, keys } from '../lib/session-cache';
import {
  LAUNCHABLE_PHASES,
  PHASES,
  commandInMessage,
  formatDuration,
  formatMoment,
  isActive,
  phaseLabel,
  phaseState,
  requiredArtifact,
  shortId,
} from '../lib/session-view';

export function TicketPage() {
  const { workspaceId, ticketKey } = useParams({ from: '/w/$workspaceId/tickets/$ticketKey' });

  const ticket = useQuery({
    queryKey: keys.ticket(workspaceId, ticketKey),
    queryFn: () => api.getTicket(workspaceId, ticketKey),
    retry: false,
  });
  const sessions = useQuery({
    queryKey: keys.ticketSessions(workspaceId, ticketKey),
    queryFn: () => api.listTicketSessions(workspaceId, ticketKey),
  });
  const list = sessions.data ?? [];
  const now = useNow(list.some(isActive));

  return (
    <>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
          <div className="text-[13px] text-muted">
            <Link to="/w/$workspaceId" params={{ workspaceId }} className="no-underline">
              Tickets
            </Link>{' '}
            / <span className="font-mono">{ticketKey}</span>
          </div>
          {ticket.data && (
            <>
              <h1 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.01em]">
                {ticket.data.title}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
                <span className="rounded-full border border-line bg-white px-2.5 py-[3px] capitalize">
                  GitHub · {ticket.data.status}
                </span>
                <span className="rounded-full border border-line bg-white px-2.5 py-[3px]">
                  {list.length} {list.length === 1 ? 'session' : 'sessions'}
                </span>
                <span>Updated {formatMoment(ticket.data.updatedAt, now)}</span>
                <a href={ticket.data.url} target="_blank" rel="noopener noreferrer">
                  Open in GitHub
                </a>
              </div>
            </>
          )}
        </div>
        <AppButton disabled={ticket.isFetching} onClick={() => void ticket.refetch()}>
          {ticket.isFetching ? 'Syncing…' : 'Sync ticket'}
        </AppButton>
      </div>

      <ErrorMessage error={ticket.error} />

      <PhaseStrip sessions={list} />

      <div className="flex flex-wrap items-start gap-6">
        <section aria-label="Sessions" className="flex min-w-0 flex-[999_1_480px] flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[16px] font-semibold">
              Sessions <span className="font-normal text-muted">· {list.length}</span>
            </h2>
            <span className="text-[13px] text-muted">
              Linked to this ticket. Each has its own worktree.
            </span>
          </div>
          <ErrorMessage error={sessions.error} />
          {sessions.data?.length === 0 && (
            <p className="rounded-xl border border-dashed border-field p-4 text-[13px] text-muted">
              No sessions yet. Pick a phase to start the first one.
            </p>
          )}
          {list.map((session) => (
            <SessionCard key={session.id} workspaceId={workspaceId} session={session} now={now} />
          ))}
        </section>

        <aside className="flex max-w-full min-w-0 flex-[1_1_320px] flex-col gap-4 lg:max-w-[400px]">
          <NextSessionCard workspaceId={workspaceId} ticketKey={ticketKey} />
          {ticket.data && (
            <section
              aria-label="Ticket description"
              className="flex flex-col gap-2 rounded-xl border border-line bg-white px-[18px] py-4"
            >
              <h2 className="text-[14px] font-semibold">
                Description <span className="font-normal text-muted">· from GitHub</span>
              </h2>
              <div className="text-[13px] text-ink-soft">
                <Markdown source={ticket.data.body || '_No description._'} />
              </div>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

function PhaseStrip({ sessions }: { sessions: Session[] }) {
  return (
    <section
      aria-label="Phases"
      className="flex flex-wrap gap-y-2 rounded-xl border border-line bg-white px-5 py-[18px]"
    >
      {PHASES.map((phase, index) => (
        <PhaseStep
          key={phase}
          phase={phase}
          number={index + 1}
          sessions={sessions.filter((session) => session.phase === phase)}
          last={index === PHASES.length - 1}
        />
      ))}
    </section>
  );
}

function PhaseStep({
  phase,
  number,
  sessions,
  last,
}: {
  phase: Phase;
  number: number;
  sessions: Session[];
  last: boolean;
}) {
  const state = phaseState(sessions, phase);
  const artifact = requiredArtifact(phase)?.replace('.slop/', '');
  const colors = phaseColors(phase);

  const detail = !artifact
    ? 'In a later release'
    : state === 'running'
      ? 'Running now'
      : state === 'done'
        ? artifact
        : state === 'incomplete'
          ? `No ${artifact} yet`
          : 'Not started';

  return (
    <div
      className={cx(
        'flex min-w-0 flex-[1_1_140px] items-center gap-2 px-1.5 py-1.5',
        !last && 'border-line lg:border-r',
      )}
    >
      {state === 'done' && (
        <span
          className={cx(
            'flex size-[26px] shrink-0 items-center justify-center rounded-full text-white',
            colors.solid,
          )}
        >
          <CheckIcon />
        </span>
      )}
      {state === 'running' && (
        <span
          className={cx(
            'flex size-[26px] shrink-0 items-center justify-center rounded-full border-2',
            colors.ring,
          )}
        >
          <span className={cx('size-2.5 animate-pulse rounded-full', colors.solid)} />
        </span>
      )}
      {state === 'incomplete' && (
        <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full border-2 border-dashed border-warn text-[12px] font-semibold text-warn-text">
          {number}
        </span>
      )}
      {state === 'idle' && (
        <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full border-2 border-field text-[12px] font-semibold text-muted">
          {number}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className={cx('text-[13px] font-semibold', state === 'idle' && 'text-ink-soft')}>
          {phaseLabel(phase)}
        </span>
        <span
          className={cx(
            'text-[12px]',
            state === 'incomplete' ? 'font-medium text-warn-text' : 'text-muted',
          )}
        >
          {detail}
        </span>
      </span>
    </div>
  );
}

function SessionCard({
  workspaceId,
  session,
  now,
}: {
  workspaceId: string;
  session: Session;
  now: number;
}) {
  const incomplete = session.artifactStatus === 'incomplete';
  return (
    <article
      className={cx(
        'flex flex-col gap-2.5 rounded-xl border bg-white px-[18px] py-4',
        incomplete ? 'border-warn-line' : 'border-line',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <PhasePill phase={session.phase} />
        <Link
          to="/w/$workspaceId/sessions/$sessionId"
          params={{ workspaceId, sessionId: session.id }}
          className="font-mono text-[12px]"
        >
          {shortId(session.id)}
        </Link>
        <span className="ml-auto text-[12px]">
          <SessionOutcome session={session} />
        </span>
      </div>
      {session.statusReason && (
        <p className="text-[13px] text-danger-text">{session.statusReason}</p>
      )}
      <div className="flex flex-wrap items-center gap-3.5 text-[12px] text-muted">
        <span>
          {formatMoment(session.startedAt, now)} ·{' '}
          {formatDuration(session.startedAt, session.endedAt, now)}
          {session.endedAt && ` · ended ${formatMoment(session.endedAt, now)}`}
        </span>
        {session.worktreeRemovedAt ? (
          <span>Worktree removed</span>
        ) : (
          <Mono className="min-w-0 break-all">{session.worktreePath}</Mono>
        )}
        <Link
          to="/w/$workspaceId/sessions/$sessionId"
          params={{ workspaceId, sessionId: session.id }}
          className="ml-auto text-[13px]"
        >
          {isActive(session) ? 'Watch' : 'Result'}
        </Link>
      </div>
    </article>
  );
}

function NextSessionCard({ workspaceId, ticketKey }: { workspaceId: string; ticketKey: string }) {
  const client = useQueryClient();
  const [phase, setPhase] = useState<LaunchablePhase>('investigation');
  const start = useMutation({
    mutationFn: () => api.startSession(workspaceId, ticketKey, phase),
    onSuccess: (session) => applySessionUpdate(client, session),
  });
  const notReady =
    start.error instanceof ApiRequestError && start.error.code === 'RUNTIME_NOT_READY';

  return (
    <section
      aria-label="Next session"
      className="flex flex-col gap-3.5 rounded-xl bg-nav p-5 text-nav-text"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold tracking-[0.06em] text-nav-muted uppercase">
          Next session
        </span>
        <PhasePill phase={phase} />
      </div>

      <RadioGroup.Root
        unstyled
        value={phase}
        onValueChange={({ value }) => setPhase(value as LaunchablePhase)}
        className="flex flex-col gap-1.5"
      >
        <RadioGroup.Label className="mb-0.5 text-[12px] text-nav-muted">Phase</RadioGroup.Label>
        {LAUNCHABLE_PHASES.map((item) => (
          <RadioGroup.Item
            key={item}
            value={item}
            className={cx(
              'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-[13px]',
              item === phase ? 'border-accent bg-[#1e2638]' : 'border-nav-line',
            )}
          >
            <RadioGroup.ItemHiddenInput />
            <RadioGroup.ItemIndicator
              className={cx(
                'size-3.5 shrink-0 rounded-full border',
                item === phase ? 'border-[4px] border-white bg-accent' : 'border-nav-muted',
              )}
            />
            <RadioGroup.ItemText className={cx('grow', item === phase && 'font-medium')}>
              {phaseLabel(item)}
            </RadioGroup.ItemText>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>

      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[13px]">
        <dt className="text-nav-muted">Runtime</dt>
        <dd className="font-medium">Claude Code · auto mode</dd>
        <dt className="text-nav-muted">Brief</dt>
        <dd>Ticket title and body, plus this phase's instruction</dd>
        <dt className="text-nav-muted">Stops when</dt>
        <dd className="font-mono text-[12px] break-all">{requiredArtifact(phase)}</dd>
        <dt className="text-nav-muted">Branch</dt>
        <dd className="font-mono text-[12px] break-all">slop/&lt;ticket&gt;/&lt;session&gt;</dd>
        <dt className="text-nav-muted">Worktree</dt>
        <dd>New, just for this session</dd>
      </dl>

      {notReady && start.error instanceof Error && (
        <RuntimeNotReady message={start.error.message} />
      )}
      {start.error && !notReady && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-[10px] border border-[#8a3b36] bg-[#2a1c1b] px-3.5 py-3 text-[13px]"
        >
          <div className="flex items-center gap-2 font-semibold text-[#ffb4ab]">
            <InfoIcon />
            Couldn't start
          </div>
          <div>{start.error instanceof Error ? start.error.message : 'Something went wrong.'}</div>
        </div>
      )}

      <AppButton tone="primary" disabled={start.isPending} onClick={() => start.mutate()}>
        <PlayIcon size={14} />
        {start.error ? 'Start again' : 'Start session'}
      </AppButton>
    </section>
  );
}

function RuntimeNotReady({ message }: { message: string }) {
  const command = commandInMessage(message);
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-[10px] border border-[#8a3b36] bg-[#2a1c1b] px-3.5 py-3 text-[13px]"
    >
      <div className="flex items-center gap-2 font-semibold text-[#ffb4ab]">
        <InfoIcon />
        Couldn't start · Claude Code isn't ready
      </div>
      <div>{message.replaceAll('`', '')} Nothing was created: no session, no worktree.</div>
      {command && (
        <code className="block rounded-md border border-nav-line bg-code px-2.5 py-2 font-mono text-[12px] text-code-text">
          {command}
        </code>
      )}
      <div className="text-[12px] text-nav-muted">
        Checked at every launch, so fixing the host takes effect without a restart.
      </div>
    </div>
  );
}
