import { Checkbox, Table, Tabs } from '@chakra-ui/react';
import type {
  LinkedRepo,
  TicketCategoryFilter,
  TicketSource,
  TicketSummary,
} from '@slop-control/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import {
  AppButton,
  ErrorMessage,
  LabeledInput,
  LabeledSelect,
  LabeledTextArea,
  Mono,
  Notice,
  PlayIcon,
  SessionOutcome,
  StatusDot,
  TextInput,
  cx,
  phaseColors,
  useNow,
} from '../components/common';
import { api } from '../lib/app-api';
import { keys } from '../lib/session-cache';
import {
  PHASES,
  formatDuration,
  formatMoment,
  isActive,
  phaseLabel,
  phaseState,
  sessionArtifactPath,
} from '../lib/session-view';
import { mergeTicketPages, sourceProblems, sourcesNotLimitedToMe } from '../lib/ticket-list';

const CATEGORIES: { value: TicketCategoryFilter; label: string }[] = [
  { value: 'not_done', label: 'Not done' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All tickets' },
];

const ALL_SOURCES = '';

const TABLE_HEAD =
  'border-b border-line px-3 py-2.5 text-left text-[12px] font-semibold text-muted';
const TABLE_CELL = 'border-b border-line-soft p-3 align-top';

export function WorkspacePage() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId/' });
  const repos = useQuery({
    queryKey: keys.repos(workspaceId),
    queryFn: () => api.listRepos(workspaceId),
  });
  const sources = useQuery({
    queryKey: keys.sources(workspaceId),
    queryFn: () => api.listSources(workspaceId),
  });
  const [linking, setLinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [justLinked, setJustLinked] = useState<LinkedRepo | null>(null);

  const connected = (sources.data ?? []).filter((source) => source.disconnectedAt === null);
  const canCreate = connected.some(
    (source) => source.type === 'built_in' && source.canCreateTickets,
  );
  const noRepo = repos.data?.length === 0;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Tickets</h1>
          <p className="text-[13px] text-muted">
            Every ticket source of this workspace in one list, most recently updated first.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreate && (
            <AppButton
              tone="primary"
              aria-expanded={creating}
              onClick={() => setCreating((value) => !value)}
            >
              New ticket
            </AppButton>
          )}
          <AppButton
            aria-expanded={linking || noRepo}
            onClick={() => setLinking((value) => !value)}
          >
            {noRepo ? 'Link a repo' : 'Link another repo'}
          </AppButton>
        </div>
      </div>

      <ErrorMessage error={repos.error} />
      <ErrorMessage error={sources.error} />

      {noRepo && (
        <Notice>
          No repo is linked yet. You can create and read tickets, but link a local clone before
          starting a session.
        </Notice>
      )}
      {(linking || noRepo) && (
        <LinkRepoCard
          workspaceId={workspaceId}
          required={noRepo}
          onLinked={(repo) => {
            setLinking(false);
            setJustLinked(repo);
          }}
        />
      )}
      {justLinked && (
        <ConnectIssuesOffer
          workspaceId={workspaceId}
          repo={justLinked}
          sources={sources.data ?? []}
          onDone={() => setJustLinked(null)}
        />
      )}
      {creating && canCreate && (
        <NewTicketForm workspaceId={workspaceId} onCancel={() => setCreating(false)} />
      )}

      {sources.data && <TicketList workspaceId={workspaceId} sources={connected} />}
    </>
  );
}

function LinkRepoCard({
  workspaceId,
  required,
  onLinked,
}: {
  workspaceId: string;
  required: boolean;
  onLinked: (repo: LinkedRepo) => void;
}) {
  const client = useQueryClient();
  const [localPath, setLocalPath] = useState('');
  const link = useMutation({
    mutationFn: () => api.linkRepo(workspaceId, localPath),
    onSuccess: async (repo) => {
      setLocalPath('');
      await client.invalidateQueries({ queryKey: keys.repos(workspaceId) });
      await client.invalidateQueries({ queryKey: keys.workspaces() });
      onLinked(repo);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    link.mutate();
  };

  return (
    <section
      aria-label="Link a repo"
      className="flex flex-col gap-2.5 rounded-xl border border-line bg-white px-[18px] py-4"
    >
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Code repositories</h2>
        {required && (
          <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger-text">
            Required for sessions
          </span>
        )}
      </div>
      <p className="text-[13px] text-ink-soft">
        A local clone of a GitHub repository. Each session gets its own worktree of it. Linking a
        repo doesn't connect its Issues; you can do that afterwards.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <LabeledInput
          label="Path to a local clone"
          placeholder="/absolute/path/to/clone"
          mono
          required
          className="min-w-0 flex-[1_1_320px]"
          value={localPath}
          onChange={(event) => setLocalPath(event.target.value)}
        />
        <AppButton tone="primary" type="submit" disabled={link.isPending}>
          Link repo
        </AppButton>
      </form>
      <ErrorMessage error={link.error} />
    </section>
  );
}

/** Linking a repo never connects its Issues on its own; this only offers to. */
function ConnectIssuesOffer({
  workspaceId,
  repo,
  sources,
  onDone,
}: {
  workspaceId: string;
  repo: LinkedRepo;
  sources: TicketSource[];
  onDone: () => void;
}) {
  const client = useQueryClient();
  const name = `${repo.githubOwner}/${repo.githubRepo}`;
  const connect = useMutation({
    mutationFn: () =>
      api.connectSource(workspaceId, {
        type: 'github_issues',
        githubOwner: repo.githubOwner,
        githubRepo: repo.githubRepo,
        defaultLinkedRepoId: repo.id,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.sources(workspaceId) });
      await client.invalidateQueries({ queryKey: keys.ticketLists(workspaceId) });
      onDone();
    },
  });
  const alreadyConnected = sources.some(
    (source) =>
      source.disconnectedAt === null &&
      source.type === 'github_issues' &&
      source.label.toLowerCase() === name.toLowerCase(),
  );

  return (
    <section
      aria-label="Connect this repo's Issues"
      className="flex flex-col gap-2.5 rounded-xl border border-line bg-white px-[18px] py-4"
    >
      <h2 className="font-semibold">Linked {name}</h2>
      {alreadyConnected ? (
        <p className="text-[13px] text-ink-soft">Its GitHub Issues are already a ticket source.</p>
      ) : (
        <p className="text-[13px] text-ink-soft">
          Its GitHub Issues aren't a ticket source yet. Connecting them lists its issues here, and
          turns off new tickets in the built-in tracker.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!alreadyConnected && (
          <AppButton tone="primary" disabled={connect.isPending} onClick={() => connect.mutate()}>
            Connect {name}'s Issues
          </AppButton>
        )}
        <AppButton onClick={onDone}>{alreadyConnected ? 'Close' : 'Not now'}</AppButton>
      </div>
      <ErrorMessage error={connect.error} />
    </section>
  );
}

function NewTicketForm({ workspaceId, onCancel }: { workspaceId: string; onCancel: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const create = useMutation({
    mutationFn: () => api.createBuiltInTicket(workspaceId, { title, body }),
    onSuccess: async (ticket) => {
      await client.invalidateQueries({ queryKey: keys.ticketLists(workspaceId) });
      await navigate({
        to: '/w/$workspaceId/sources/$sourceId/tickets/$ticketKey',
        params: { workspaceId, sourceId: ticket.sourceId, ticketKey: ticket.key },
      });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <section aria-label="New ticket">
      <form
        onSubmit={submit}
        className="flex flex-col gap-3 rounded-xl border border-line bg-white px-[18px] py-4"
      >
        <h2 className="font-semibold">
          New ticket <span className="font-normal text-muted">· built-in tracker</span>
        </h2>
        <LabeledInput
          label="Title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <LabeledTextArea
          label="Description (markdown)"
          rows={6}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <ErrorMessage error={create.error} />
        <div className="flex flex-wrap justify-end gap-2">
          <AppButton onClick={onCancel}>Cancel</AppButton>
          <AppButton tone="primary" type="submit" disabled={create.isPending}>
            Create ticket
          </AppButton>
        </div>
      </form>
    </section>
  );
}

function TicketList({ workspaceId, sources }: { workspaceId: string; sources: TicketSource[] }) {
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<TicketCategoryFilter>('not_done');
  const [sourceId, setSourceId] = useState(ALL_SOURCES);
  const [mine, setMine] = useState(true);
  // A source picked earlier can be disconnected since.
  const activeSourceId = sources.some((source) => source.id === sourceId) ? sourceId : ALL_SOURCES;

  const tickets = useInfiniteQuery({
    queryKey: keys.tickets(workspaceId, activeSourceId, search, category, mine),
    queryFn: ({ pageParam }) =>
      api.listTickets(workspaceId, {
        sourceId: activeSourceId || undefined,
        search: search || undefined,
        category,
        mine,
        cursor: pageParam || undefined,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });

  const pages = tickets.data?.pages ?? [];
  const items = mergeTicketPages(pages.map((page) => page.items));
  const statuses = pages.flatMap((page) => page.sources);
  const problems = sourceProblems(statuses, sources);
  const everyone = mine ? sourcesNotLimitedToMe(statuses, sources) : [];
  const labelOf = (id: string) => sources.find((source) => source.id === id)?.label ?? 'Unknown';

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line">
        <Tabs.Root
          unstyled
          value={category}
          onValueChange={({ value }) => setCategory(value as TicketCategoryFilter)}
        >
          <Tabs.List aria-label="Ticket status" className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((item) => (
              <Tabs.Trigger
                key={item.value}
                value={item.value}
                className={cx(
                  'min-h-11 cursor-pointer border-b-2 px-3.5 py-2.5',
                  item.value === category
                    ? 'border-ink font-semibold text-ink'
                    : 'border-transparent text-ink-soft',
                )}
              >
                {item.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
        <AppButton
          compact
          className="mb-1 ml-auto"
          disabled={tickets.isFetching}
          onClick={() => void tickets.refetch()}
        >
          {tickets.isFetching ? 'Syncing…' : 'Sync now'}
        </AppButton>
      </div>

      <form
        role="search"
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(searchText.trim());
        }}
      >
        <TextInput
          type="search"
          aria-label="Search tickets"
          placeholder="Search tickets in every source"
          className="min-w-0 flex-[1_1_240px]"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <AppButton type="submit">Search</AppButton>
        <LabeledSelect
          label="Source"
          className="min-w-[180px]"
          value={activeSourceId}
          onChange={(event) => setSourceId(event.target.value)}
        >
          <option value={ALL_SOURCES}>All sources</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.label}
            </option>
          ))}
        </LabeledSelect>
        <Checkbox.Root
          checked={mine}
          onCheckedChange={({ checked }) => setMine(checked === true)}
          className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px]"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>Assigned to me</Checkbox.Label>
        </Checkbox.Root>
      </form>

      <ErrorMessage error={tickets.error} />
      {problems.map((problem) => (
        <div
          key={problem.sourceId}
          role="alert"
          aria-label={`Problem with ${problem.label}`}
          className="flex flex-col gap-0.5 rounded-[10px] border border-danger-line bg-danger-soft px-3.5 py-3 text-[13px] text-danger-text"
        >
          <span className="font-semibold">
            {problem.kind === 'auth_failed'
              ? `${problem.label} rejected its sign-in`
              : `${problem.label} can't be reached`}
          </span>
          <span>{problem.message} Tickets from the other sources are still listed.</span>
        </div>
      ))}
      {everyone.length > 0 && (
        <Notice tone="info">
          {everyone.join(', ')} can't limit its list to you, so all of its tickets are shown.
        </Notice>
      )}

      {tickets.data && (
        <div className="relative overflow-x-auto rounded-xl border border-line bg-white">
          <Table.Root unstyled className="w-full border-collapse">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader className={TABLE_HEAD}>Ticket</Table.ColumnHeader>
                <Table.ColumnHeader className={TABLE_HEAD}>Source</Table.ColumnHeader>
                <Table.ColumnHeader className={TABLE_HEAD}>Status</Table.ColumnHeader>
                <Table.ColumnHeader className={TABLE_HEAD}>Phases</Table.ColumnHeader>
                <Table.ColumnHeader className={TABLE_HEAD}>Last session</Table.ColumnHeader>
                <Table.ColumnHeader className={TABLE_HEAD}>Sessions</Table.ColumnHeader>
                <Table.ColumnHeader className={TABLE_HEAD}>
                  <span className="sr-only">Actions</span>
                </Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {items.map((ticket) => (
                <TicketRow
                  key={`${ticket.sourceId}:${ticket.key}`}
                  workspaceId={workspaceId}
                  ticket={ticket}
                  sourceLabel={labelOf(ticket.sourceId)}
                />
              ))}
              {items.length === 0 && (
                <Table.Row>
                  <Table.Cell colSpan={7} className="p-6 text-center text-muted">
                    No tickets match.
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-[1_1_320px] text-[12px] text-muted">
          Phase bars: investigation, planning, implementation, automated testing, e2e testing, code
          review. Solid = artifact produced · pulsing = running · amber = ended without its
          artifact. Testing phases arrive in a later release.
        </p>
        <AppButton
          disabled={!tickets.hasNextPage || tickets.isFetchingNextPage}
          onClick={() => void tickets.fetchNextPage()}
        >
          {tickets.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </AppButton>
      </div>
    </>
  );
}

function TicketRow({
  workspaceId,
  ticket,
  sourceLabel,
}: {
  workspaceId: string;
  ticket: TicketSummary;
  sourceLabel: string;
}) {
  const sessions = useQuery({
    queryKey: keys.ticketSessions(workspaceId, ticket.sourceId, ticket.key),
    queryFn: () => api.listTicketSessions(workspaceId, ticket.sourceId, ticket.key),
  });
  const list = sessions.data ?? [];
  const latest = list[0];
  const live = list.find(isActive);
  const now = useNow(Boolean(live));

  return (
    <Table.Row>
      <Table.Cell className={cx(TABLE_CELL, 'min-w-[240px]')}>
        <Link
          to="/w/$workspaceId/sources/$sourceId/tickets/$ticketKey"
          params={{ workspaceId, sourceId: ticket.sourceId, ticketKey: ticket.key }}
          className="flex flex-col gap-0.5 text-ink no-underline hover:text-accent"
        >
          <span className="font-medium">{ticket.title}</span>
          <Mono className="text-muted">
            {ticket.key} · updated {formatMoment(ticket.updatedAt, now)}
          </Mono>
        </Link>
      </Table.Cell>
      <Table.Cell className={cx(TABLE_CELL, 'text-[13px] whitespace-nowrap text-ink-soft')}>
        {sourceLabel}
      </Table.Cell>
      <Table.Cell className={TABLE_CELL}>
        <TicketStatus status={ticket.status} category={ticket.statusCategory} />
      </Table.Cell>
      <Table.Cell className={cx(TABLE_CELL, 'min-w-[150px]')}>
        <PhaseBars sessions={list} />
        {live && (
          <div className="mt-1 text-[12px]">
            <StatusDot
              tone="ok"
              label={`${phaseLabel(live.phase)} running · ${formatDuration(live.startedAt, null, now)}`}
            />
          </div>
        )}
        {!live && latest?.artifactStatus === 'incomplete' && (
          <div className="mt-1 text-[12px] font-medium text-warn-text">
            {phaseLabel(latest.phase)} incomplete
          </div>
        )}
      </Table.Cell>
      <Table.Cell className={TABLE_CELL}>
        {latest ? (
          <>
            <div className="text-[13px]">
              <SessionOutcome session={latest} />
            </div>
            <div className="text-[12px] text-muted">
              {phaseLabel(latest.phase)} · {formatMoment(latest.startedAt, now)}
            </div>
          </>
        ) : (
          <span className="text-muted">No sessions yet</span>
        )}
      </Table.Cell>
      <Table.Cell className={TABLE_CELL}>{sessions.data ? list.length : '—'}</Table.Cell>
      <Table.Cell className={cx(TABLE_CELL, 'text-right whitespace-nowrap')}>
        <TicketAction
          workspaceId={workspaceId}
          sourceId={ticket.sourceId}
          ticketKey={ticket.key}
          sessions={list}
        />
      </Table.Cell>
    </Table.Row>
  );
}

function TicketStatus({
  status,
  category,
}: {
  status: string;
  category: TicketSummary['statusCategory'];
}) {
  return (
    <span
      className={cx(
        'rounded-full px-[9px] py-0.5 text-[12px] font-medium whitespace-nowrap capitalize',
        category === 'open' && 'bg-[#e6eefb] text-[#1a4fa3]',
        category === 'in_progress' && 'bg-[#fbeedd] text-[#8f4700]',
        category === 'done' && 'bg-paper text-ink-soft',
      )}
    >
      {status.replaceAll('_', ' ')}
    </span>
  );
}

function PhaseBars({ sessions }: { sessions: Parameters<typeof phaseState>[0] }) {
  const states = PHASES.map((phase) => ({ phase, state: phaseState(sessions, phase) }));
  const summary = states
    .map(({ phase, state }) => `${phaseLabel(phase)}: ${state === 'idle' ? 'not started' : state}`)
    .join(', ');

  return (
    <div role="img" aria-label={summary} className="flex items-center gap-[3px]">
      {states.map(({ phase, state }) => (
        <span
          key={phase}
          className={cx(
            'h-2 w-[18px] rounded',
            state === 'done' && phaseColors(phase).solid,
            state === 'running' && cx(phaseColors(phase).solid, 'animate-pulse'),
            state === 'incomplete' && 'bg-warn-line',
            state === 'idle' && 'bg-line',
          )}
        />
      ))}
    </div>
  );
}

function TicketAction({
  workspaceId,
  sourceId,
  ticketKey,
  sessions,
}: {
  workspaceId: string;
  sourceId: string;
  ticketKey: string;
  sessions: Parameters<typeof phaseState>[0];
}) {
  const live = sessions.find(isActive);
  const latest = sessions[0];

  if (live || latest?.artifactStatus === 'incomplete') {
    const target = live ?? latest!;
    return (
      <AppButton asChild compact tone={live ? 'secondary' : 'warn'}>
        <Link
          to="/w/$workspaceId/sessions/$sessionId"
          params={{ workspaceId, sessionId: target.id }}
          title={live ? undefined : `${sessionArtifactPath(target) ?? 'Its artifact'} is missing`}
        >
          {live ? 'Watch' : 'Continue'}
        </Link>
      </AppButton>
    );
  }

  return (
    <AppButton asChild compact tone={latest ? 'secondary' : 'primary'} className="font-medium">
      <Link
        to="/w/$workspaceId/sources/$sourceId/tickets/$ticketKey"
        params={{ workspaceId, sourceId, ticketKey }}
      >
        {latest ? (
          'Open'
        ) : (
          <>
            <PlayIcon />
            Start
          </>
        )}
      </Link>
    </AppButton>
  );
}
