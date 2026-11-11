import { RadioGroup } from '@chakra-ui/react';
import type {
  BuiltInTicketStatus,
  LaunchablePhase,
  LaunchPreview,
  LinkedRepo,
  Phase,
  Session,
  Ticket,
} from '@slop-control/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import {
  AppButton,
  CheckIcon,
  ErrorMessage,
  InfoIcon,
  LabeledInput,
  LabeledSelect,
  LabeledTextArea,
  Mono,
  PhasePill,
  PlayIcon,
  SessionOutcome,
  cx,
  phaseColors,
  useNow,
} from '../components/common';
import { Markdown } from '../components/Markdown';
import { ApiRequestError } from '../lib/api';
import { api } from '../lib/app-api';
import { errorText } from '../lib/error-text';
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
  roundLabel,
  scopeFlagLabel,
  shortId,
} from '../lib/session-view';

/** The built-in tracker's status names, as the server shows them, and the values it accepts. */
const BUILT_IN_STATUSES: { value: BuiltInTicketStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'in_review', label: 'In review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const repoName = (repo: LinkedRepo) => `${repo.githubOwner}/${repo.githubRepo}`;

export function TicketPage() {
  const { workspaceId, sourceId, ticketKey } = useParams({
    from: '/w/$workspaceId/sources/$sourceId/tickets/$ticketKey',
  });

  const ticket = useQuery({
    queryKey: keys.ticket(workspaceId, sourceId, ticketKey),
    queryFn: () => api.getTicket(workspaceId, sourceId, ticketKey),
    retry: false,
  });
  const sessions = useQuery({
    queryKey: keys.ticketSessions(workspaceId, sourceId, ticketKey),
    queryFn: () => api.listTicketSessions(workspaceId, sourceId, ticketKey),
  });
  const sources = useQuery({
    queryKey: keys.sources(workspaceId),
    queryFn: () => api.listSources(workspaceId),
  });
  const repos = useQuery({
    queryKey: keys.repos(workspaceId),
    queryFn: () => api.listRepos(workspaceId),
  });
  const source = sources.data?.find((item) => item.id === sourceId);
  const builtIn = source?.type === 'built_in';
  const sourceLabel = source?.label ?? 'Source';
  const list = sessions.data ?? [];
  const now = useNow(list.some(isActive));
  const [editing, setEditing] = useState(false);

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
                <span className="rounded-full border border-line bg-white px-2.5 py-[3px]">
                  {sourceLabel} · {ticket.data.status}
                </span>
                <span className="rounded-full border border-line bg-white px-2.5 py-[3px]">
                  {list.length} {list.length === 1 ? 'session' : 'sessions'}
                </span>
                <span>Updated {formatMoment(ticket.data.updatedAt, now)}</span>
                {ticket.data.url && (
                  <a href={ticket.data.url} target="_blank" rel="noopener noreferrer">
                    Open in its tracker
                  </a>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {builtIn && ticket.data && (
            <AppButton aria-expanded={editing} onClick={() => setEditing((value) => !value)}>
              Edit ticket
            </AppButton>
          )}
          <AppButton disabled={ticket.isFetching} onClick={() => void ticket.refetch()}>
            {ticket.isFetching ? 'Syncing…' : 'Sync ticket'}
          </AppButton>
        </div>
      </div>

      <ErrorMessage error={ticket.error} />
      {source?.disconnectedAt && !ticket.data && list[0] && (
        <p className="text-[13px] text-ink-soft">
          Title when its latest session started: <strong>{list[0].ticketTitle}</strong>
        </p>
      )}

      {builtIn && ticket.data && editing && (
        <EditTicketForm
          workspaceId={workspaceId}
          ticket={ticket.data}
          onDone={() => setEditing(false)}
        />
      )}

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
            <SessionCard
              key={session.id}
              workspaceId={workspaceId}
              session={session}
              repo={repos.data?.find((item) => item.id === session.linkedRepoId)}
              now={now}
            />
          ))}
          {builtIn && ticket.data && (
            <CommentsSection workspaceId={workspaceId} ticketKey={ticketKey} now={now} />
          )}
        </section>

        <aside className="flex max-w-full min-w-0 flex-[1_1_320px] flex-col gap-4 lg:max-w-[400px]">
          <NextSessionCard
            workspaceId={workspaceId}
            sourceId={sourceId}
            ticketKey={ticketKey}
            repos={repos.data ?? []}
          />
          {builtIn && ticket.data && (
            <StatusPicker workspaceId={workspaceId} ticket={ticket.data} />
          )}
          {ticket.data && (
            <section
              aria-label="Ticket description"
              className="flex flex-col gap-2 rounded-xl border border-line bg-white px-[18px] py-4"
            >
              <h2 className="text-[14px] font-semibold">
                Description <span className="font-normal text-muted">· from {sourceLabel}</span>
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

function useTicketSaved(workspaceId: string) {
  const client = useQueryClient();
  return (ticket: Ticket) => {
    client.setQueryData(keys.ticket(workspaceId, ticket.sourceId, ticket.key), ticket);
    void client.invalidateQueries({ queryKey: keys.ticketLists(workspaceId) });
  };
}

function EditTicketForm({
  workspaceId,
  ticket,
  onDone,
}: {
  workspaceId: string;
  ticket: Ticket;
  onDone: () => void;
}) {
  const saved = useTicketSaved(workspaceId);
  const [title, setTitle] = useState(ticket.title);
  const [body, setBody] = useState(ticket.body);
  const save = useMutation({
    mutationFn: () => api.updateBuiltInTicket(workspaceId, ticket.key, { title, body }),
    onSuccess: (updated) => {
      saved(updated);
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <section aria-label="Edit ticket">
      <form
        onSubmit={submit}
        className="flex flex-col gap-3 rounded-xl border border-line bg-white px-[18px] py-4"
      >
        <h2 className="font-semibold">Edit ticket</h2>
        <LabeledInput
          label="Title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <LabeledTextArea
          label="Description (markdown)"
          rows={8}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <ErrorMessage error={save.error} />
        <div className="flex flex-wrap justify-end gap-2">
          <AppButton onClick={onDone}>Cancel</AppButton>
          <AppButton tone="primary" type="submit" disabled={save.isPending}>
            Save ticket
          </AppButton>
        </div>
      </form>
    </section>
  );
}

function StatusPicker({ workspaceId, ticket }: { workspaceId: string; ticket: Ticket }) {
  const saved = useTicketSaved(workspaceId);
  const current =
    BUILT_IN_STATUSES.find((item) => item.label.toLowerCase() === ticket.status.toLowerCase())
      ?.value ?? 'todo';
  const save = useMutation({
    mutationFn: (status: BuiltInTicketStatus) =>
      api.updateBuiltInTicket(workspaceId, ticket.key, { status }),
    onSuccess: saved,
  });

  return (
    <section
      aria-label="Ticket status"
      className="flex flex-col gap-2 rounded-xl border border-line bg-white px-[18px] py-4"
    >
      <LabeledSelect
        label="Ticket status"
        value={save.isPending && save.variables ? save.variables : current}
        disabled={save.isPending}
        onChange={(event) => save.mutate(event.target.value as BuiltInTicketStatus)}
      >
        {BUILT_IN_STATUSES.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </LabeledSelect>
      <p className="text-[12px] text-muted">
        Tickets are never deleted. Retire one as Cancelled to keep its sessions.
      </p>
      <ErrorMessage error={save.error} />
    </section>
  );
}

function CommentsSection({
  workspaceId,
  ticketKey,
  now,
}: {
  workspaceId: string;
  ticketKey: string;
  now: number;
}) {
  const client = useQueryClient();
  const [body, setBody] = useState('');
  const comments = useQuery({
    queryKey: keys.comments(workspaceId, ticketKey),
    queryFn: () => api.listComments(workspaceId, ticketKey),
  });
  const add = useMutation({
    mutationFn: () => api.addComment(workspaceId, ticketKey, body),
    onSuccess: async () => {
      setBody('');
      await client.invalidateQueries({ queryKey: keys.comments(workspaceId, ticketKey) });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate();
  };

  return (
    <section
      aria-label="Comments"
      className="mt-3 flex flex-col gap-3 rounded-xl border border-line bg-white px-[18px] py-4"
    >
      <h2 className="text-[14px] font-semibold">
        Comments{' '}
        <span className="font-normal text-muted">· your notes; sessions don't see them</span>
      </h2>
      <ErrorMessage error={comments.error} />
      {comments.data?.length === 0 && <p className="text-[13px] text-muted">No comments yet.</p>}
      <ol className="flex flex-col gap-3">
        {comments.data?.map((comment) => (
          <li key={comment.id} className="flex flex-col gap-1 border-b border-line-soft pb-3">
            <span className="text-[12px] text-muted">{formatMoment(comment.createdAt, now)}</span>
            <div className="text-[13px] text-ink-soft">
              <Markdown source={comment.body} />
            </div>
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <LabeledTextArea
          label="Add a comment"
          rows={3}
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <ErrorMessage error={add.error} />
        <AppButton type="submit" className="self-end" disabled={add.isPending}>
          Add comment
        </AppButton>
      </form>
    </section>
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
  repo,
  now,
}: {
  workspaceId: string;
  session: Session;
  repo: LinkedRepo | undefined;
  now: number;
}) {
  const incomplete = session.artifactStatus === 'incomplete';
  const round = roundLabel(session);
  const flag = scopeFlagLabel(session.scopeFlags);
  return (
    <article
      aria-label={`Session ${shortId(session.id)}`}
      className={cx(
        'flex flex-col gap-2.5 rounded-xl border bg-white px-[18px] py-4',
        incomplete || flag ? 'border-warn-line' : 'border-line',
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
        {round && (
          <span className="rounded-full border border-line px-2 py-0.5 text-[12px] text-ink-soft">
            {round}
          </span>
        )}
        {flag && (
          <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[12px] font-medium text-warn-text">
            Scope flag · {flag}
          </span>
        )}
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
        {repo && <span>Repo {repoName(repo)}</span>}
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

const AUTO_REPO = '';

function NextSessionCard({
  workspaceId,
  sourceId,
  ticketKey,
  repos,
}: {
  workspaceId: string;
  sourceId: string;
  ticketKey: string;
  repos: LinkedRepo[];
}) {
  const client = useQueryClient();
  // Null means "not chosen": the preview's suggested phase and preselected repo are used.
  const [chosenPhase, setChosenPhase] = useState<LaunchablePhase | null>(null);
  const [chosenRepoId, setChosenRepoId] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: keys.launchPreview(
      workspaceId,
      sourceId,
      ticketKey,
      chosenPhase ?? '',
      chosenRepoId ?? AUTO_REPO,
    ),
    queryFn: () =>
      api.launchPreview(workspaceId, sourceId, ticketKey, {
        phase: chosenPhase ?? undefined,
        linkedRepoId: chosenRepoId ?? undefined,
      }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const data = preview.data;
  const phase = chosenPhase ?? data?.phase ?? 'investigation';
  const repoId = chosenRepoId ?? data?.linkedRepoId ?? null;

  const start = useMutation({
    mutationFn: () =>
      api.startSession(workspaceId, sourceId, ticketKey, {
        phase,
        linkedRepoId: repoId ?? undefined,
      }),
    onSuccess: (session) => {
      // The next launch starts from the suggestion again.
      setChosenPhase(null);
      applySessionUpdate(client, session);
    },
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

      {data && (
        <p role="status" aria-label="Suggested phase" className="text-[13px]">
          {data.suggestion.phase ? (
            <>
              <span className="font-semibold">Suggested: {phaseLabel(data.suggestion.phase)}.</span>{' '}
              {data.suggestion.reason}
            </>
          ) : (
            <>
              <span className="font-semibold">No phase suggested.</span> {data.suggestion.reason}{' '}
              You can still start any phase.
            </>
          )}
        </p>
      )}

      <RadioGroup.Root
        unstyled
        value={phase}
        onValueChange={({ value }) => setChosenPhase(value as LaunchablePhase)}
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
            {data?.suggestion.phase === item && (
              <span className="text-[12px] text-nav-muted">suggested</span>
            )}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>

      <LabeledSelect
        dark
        label="Repo"
        value={repoId ?? AUTO_REPO}
        onChange={(event) => setChosenRepoId(event.target.value || null)}
      >
        {repoId === null && <option value={AUTO_REPO}>Choose a repo…</option>}
        {repos.map((repo) => (
          <option key={repo.id} value={repo.id}>
            {repoName(repo)}
          </option>
        ))}
      </LabeledSelect>
      {data && repoId === null && (
        <p role="status" className="text-[13px] text-[#ffd166]">
          {repos.length === 0
            ? 'Link a repo to this workspace before starting a session.'
            : 'No repo could be preselected for this ticket. Choose the repo it should run in.'}
        </p>
      )}

      <ErrorMessage error={preview.error} />
      {data && <PreLaunchView preview={data} repos={repos} workspaceId={workspaceId} />}

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
          <div>{errorText(start.error)}</div>
        </div>
      )}

      <AppButton
        tone="primary"
        disabled={start.isPending || !data || repoId === null || preview.isPlaceholderData}
        onClick={() => start.mutate()}
      >
        <PlayIcon size={14} />
        {start.error ? 'Start again' : 'Start session'}
      </AppButton>
    </section>
  );
}

/** What the launch will use. Read-only: setups are changed on the phase setups screen. */
function PreLaunchView({
  preview,
  repos,
  workspaceId,
}: {
  preview: LaunchPreview;
  repos: LinkedRepo[];
  workspaceId: string;
}) {
  const repo = repos.find((item) => item.id === preview.linkedRepoId);
  const { setup } = preview;
  return (
    <section aria-label="Before launch" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[12px] font-semibold tracking-[0.06em] text-nav-muted uppercase">
          Before launch
        </h3>
        <Link
          to="/w/$workspaceId/phase-setups"
          params={{ workspaceId }}
          className="text-[12px] text-nav-soft"
        >
          Edit phase setups
        </Link>
      </div>
      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[13px]">
        <dt className="text-nav-muted">Runtime</dt>
        <dd className="font-medium">Claude Code · auto mode</dd>
        <dt className="text-nav-muted">Repo</dt>
        <dd className="font-medium break-all">{repo ? repoName(repo) : 'Not chosen yet'}</dd>
        <dt className="text-nav-muted">Starts from</dt>
        <dd className="font-mono text-[12px] break-all">{preview.baseRef ?? '—'}</dd>
        {preview.compareRef && (
          <>
            <dt className="text-nav-muted">Compares to</dt>
            <dd className="font-mono text-[12px] break-all">{preview.compareRef}</dd>
          </>
        )}
        <dt className="text-nav-muted">Instruction</dt>
        <dd className="break-words">{setup.instruction}</dd>
        <dt className="text-nav-muted">Scope</dt>
        <dd>
          {setup.scope.mayChangeCode ? 'May change code' : 'Read-only: code changes are flagged'}
          <span className="block text-[12px] text-nav-muted">
            Every session is cut off from pushing, gh, SSH, and account connectors.
          </span>
        </dd>
        <dt className="text-nav-muted">Stops when</dt>
        <dd className="font-mono text-[12px] break-all">
          {setup.stopCondition.requiredArtifactPath}
        </dd>
        <dt className="text-nav-muted">~/.claude</dt>
        <dd>{setup.userLevelSource ? 'User-level source on' : 'User-level source off'}</dd>
        <dt className="text-nav-muted">Given</dt>
        <dd>
          {preview.inputArtifacts.length === 0 ? (
            'No earlier artifacts'
          ) : (
            <ul aria-label="Earlier artifacts" className="flex flex-col gap-1">
              {preview.inputArtifacts.map((artifact) => (
                <li key={artifact.path}>
                  {phaseLabel(artifact.phase)} ·{' '}
                  <span className="font-mono text-[12px] break-all">{artifact.path}</span>
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt className="text-nav-muted">Worktree</dt>
        <dd>New, just for this session</dd>
      </dl>
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
