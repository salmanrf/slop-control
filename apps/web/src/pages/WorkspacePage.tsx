import { NativeSelect, Table, Tabs } from '@chakra-ui/react';
import type { LinkedRepo, TicketSummary } from '@slop-control/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import {
  AppButton,
  ErrorMessage,
  LabeledInput,
  Mono,
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
  requiredArtifact,
} from '../lib/session-view';

type TicketState = 'open' | 'closed' | 'all';

const TICKET_STATES: { value: TicketState; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All tickets' },
];

const TABLE_HEAD =
  'border-b border-line px-3 py-2.5 text-left text-[12px] font-semibold text-muted';
const TABLE_CELL = 'border-b border-line-soft p-3 align-top';

export function WorkspacePage() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId/' });
  const repos = useQuery({
    queryKey: keys.repos(workspaceId),
    queryFn: () => api.listRepos(workspaceId),
  });
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const repo = repos.data?.find((item) => item.id === selectedRepoId) ?? repos.data?.[0];

  if (repos.data?.length === 0) {
    return (
      <>
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Tickets</h1>
          <p className="text-[13px] text-muted">
            Link a repository to read its tickets and start sessions.
          </p>
        </div>
        <LinkRepoCard workspaceId={workspaceId} />
      </>
    );
  }

  return (
    <>
      <ErrorMessage error={repos.error} />
      {repo && (
        <TicketList
          key={repo.id}
          workspaceId={workspaceId}
          repo={repo}
          repos={repos.data ?? []}
          onSelectRepo={setSelectedRepoId}
          linking={linking}
          onToggleLinking={() => setLinking((value) => !value)}
          onLinked={() => setLinking(false)}
        />
      )}
    </>
  );
}

function LinkRepoCard({ workspaceId, onLinked }: { workspaceId: string; onLinked?: () => void }) {
  const client = useQueryClient();
  const [localPath, setLocalPath] = useState('');
  const link = useMutation({
    mutationFn: () => api.linkRepo(workspaceId, localPath),
    onSuccess: async () => {
      setLocalPath('');
      await client.invalidateQueries({ queryKey: keys.repos(workspaceId) });
      await client.invalidateQueries({ queryKey: keys.workspaces() });
      onLinked?.();
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
        <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger-text">
          Required
        </span>
      </div>
      <p className="text-[13px] text-ink-soft">
        A local clone of a GitHub repository. Each session gets its own worktree of it, and its
        tickets come from the repo's GitHub Issues.
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

function TicketList({
  workspaceId,
  repo,
  repos,
  onSelectRepo,
  linking,
  onToggleLinking,
  onLinked,
}: {
  workspaceId: string;
  repo: LinkedRepo;
  repos: LinkedRepo[];
  onSelectRepo: (id: string) => void;
  linking: boolean;
  onToggleLinking: () => void;
  onLinked: () => void;
}) {
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<TicketState>('open');
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);

  useEffect(() => setCursors([]), [search, state]);

  const tickets = useQuery({
    queryKey: [...keys.tickets(workspaceId, repo.id, search, state), cursor ?? ''],
    queryFn: () =>
      api.listTickets(workspaceId, {
        linkedRepoId: repo.id,
        search: search || undefined,
        state,
        cursor,
      }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Tickets</h1>
          <p className="text-[13px] text-muted">
            Read live from GitHub Issues · {repo.githubOwner}/{repo.githubRepo} · never stored here
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AppButton disabled={tickets.isFetching} onClick={() => void tickets.refetch()}>
            {tickets.isFetching ? 'Syncing…' : 'Sync now'}
          </AppButton>
          <AppButton aria-expanded={linking} onClick={onToggleLinking}>
            Link another repo
          </AppButton>
        </div>
      </div>

      {linking && <LinkRepoCard workspaceId={workspaceId} onLinked={onLinked} />}

      <div className="flex flex-wrap items-center gap-1.5 border-b border-line">
        <Tabs.Root
          unstyled
          value={state}
          onValueChange={({ value }) => setState(value as TicketState)}
        >
          <Tabs.List aria-label="Ticket state" className="flex flex-wrap gap-1.5">
            {TICKET_STATES.map((item) => (
              <Tabs.Trigger
                key={item.value}
                value={item.value}
                className={cx(
                  'min-h-11 cursor-pointer border-b-2 px-3.5 py-2.5',
                  item.value === state
                    ? 'border-ink font-semibold text-ink'
                    : 'border-transparent text-ink-soft',
                )}
              >
                {item.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
        <div className="mb-1 ml-auto flex items-center gap-1.5">
          <label htmlFor="repo-select" className="text-[12px] text-muted">
            Repo
          </label>
          <NativeSelect.Root unstyled className="w-auto">
            <NativeSelect.Field
              id="repo-select"
              value={repo.id}
              onChange={(event) => onSelectRepo(event.target.value)}
              className="min-h-10 cursor-pointer rounded-lg border border-field bg-white px-2.5 py-2 text-[13px]"
            >
              {repos.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.githubOwner}/{item.githubRepo}
                </option>
              ))}
            </NativeSelect.Field>
          </NativeSelect.Root>
        </div>
      </div>

      <form
        role="search"
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(searchText.trim());
        }}
      >
        <TextInput
          type="search"
          aria-label="Search tickets"
          placeholder="Search tickets"
          className="min-w-0 flex-[1_1_240px]"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <AppButton type="submit">Search</AppButton>
      </form>

      <ErrorMessage error={tickets.error} />

      {tickets.data && (
        <div className="relative overflow-x-auto rounded-xl border border-line bg-white">
          <Table.Root unstyled className="w-full border-collapse">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader className={TABLE_HEAD}>Ticket</Table.ColumnHeader>
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
              {tickets.data.items.map((ticket) => (
                <TicketRow key={ticket.key} workspaceId={workspaceId} ticket={ticket} />
              ))}
              {tickets.data.items.length === 0 && (
                <Table.Row>
                  <Table.Cell colSpan={6} className="p-6 text-center text-muted">
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
          disabled={cursors.length === 0}
          onClick={() => setCursors((list) => list.slice(0, -1))}
        >
          Previous
        </AppButton>
        <AppButton
          disabled={!tickets.data?.nextCursor}
          onClick={() => {
            const next = tickets.data?.nextCursor;
            if (next) setCursors((list) => [...list, next]);
          }}
        >
          Next
        </AppButton>
      </div>
    </>
  );
}

function TicketRow({ workspaceId, ticket }: { workspaceId: string; ticket: TicketSummary }) {
  const sessions = useQuery({
    queryKey: keys.ticketSessions(workspaceId, ticket.key),
    queryFn: () => api.listTicketSessions(workspaceId, ticket.key),
  });
  const list = sessions.data ?? [];
  const latest = list[0];
  const live = list.find(isActive);
  const now = useNow(Boolean(live));

  return (
    <Table.Row>
      <Table.Cell className={cx(TABLE_CELL, 'min-w-[240px]')}>
        <Link
          to="/w/$workspaceId/tickets/$ticketKey"
          params={{ workspaceId, ticketKey: ticket.key }}
          className="flex flex-col gap-0.5 text-ink no-underline hover:text-accent"
        >
          <span className="font-medium">{ticket.title}</span>
          <Mono className="text-muted">
            {ticket.key} · updated {formatMoment(ticket.updatedAt, now)}
          </Mono>
        </Link>
      </Table.Cell>
      <Table.Cell className={TABLE_CELL}>
        <TicketStatus status={ticket.status} />
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
        <TicketAction workspaceId={workspaceId} ticketKey={ticket.key} sessions={list} />
      </Table.Cell>
    </Table.Row>
  );
}

function TicketStatus({ status }: { status: string }) {
  const open = status.toLowerCase() === 'open';
  return (
    <span
      className={cx(
        'rounded-full px-[9px] py-0.5 text-[12px] font-medium whitespace-nowrap capitalize',
        open ? 'bg-[#e6eefb] text-[#1a4fa3]' : 'bg-paper text-ink-soft',
      )}
    >
      {status}
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
  ticketKey,
  sessions,
}: {
  workspaceId: string;
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
          title={
            live ? undefined : `${requiredArtifact(target.phase) ?? 'Its artifact'} is missing`
          }
        >
          {live ? 'Watch' : 'Continue'}
        </Link>
      </AppButton>
    );
  }

  return (
    <AppButton asChild compact tone={latest ? 'secondary' : 'primary'} className="font-medium">
      <Link to="/w/$workspaceId/tickets/$ticketKey" params={{ workspaceId, ticketKey }}>
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
