import type { LinkedRepo } from '@slop-control/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { ErrorMessage, formatTime } from '../components/common';
import { api } from '../lib/app-api';
import { keys } from '../lib/session-cache';

type TicketState = 'open' | 'closed' | 'all';

export function WorkspacePage() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId' });
  const workspace = useQuery({
    queryKey: keys.workspace(workspaceId),
    queryFn: () => api.getWorkspace(workspaceId),
  });
  const repos = useQuery({
    queryKey: keys.repos(workspaceId),
    queryFn: () => api.listRepos(workspaceId),
  });
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const repo = repos.data?.find((item) => item.id === selectedRepoId) ?? repos.data?.[0];

  return (
    <main>
      <p>
        <Link to="/">All workspaces</Link>
      </p>
      <h1>{workspace.data?.name ?? 'Workspace'}</h1>
      <ErrorMessage error={workspace.error ?? repos.error} />

      {repos.data?.length === 0 && (
        <p className="notice">Link a local clone of a GitHub repo before starting a session.</p>
      )}
      {repos.data && repos.data.length > 0 && (
        <section>
          <h2>Linked repos</h2>
          <ul className="list">
            {repos.data.map((item) => (
              <li key={item.id}>
                <label className="row">
                  <input
                    type="radio"
                    name="repo"
                    checked={item.id === repo?.id}
                    onChange={() => setSelectedRepoId(item.id)}
                  />
                  <span>
                    {item.githubOwner}/{item.githubRepo} <small>{item.localPath}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
      <LinkRepoForm workspaceId={workspaceId} />
      {repo && <TicketList key={repo.id} workspaceId={workspaceId} repo={repo} />}
    </main>
  );
}

function LinkRepoForm({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const [localPath, setLocalPath] = useState('');
  const link = useMutation({
    mutationFn: () => api.linkRepo(workspaceId, localPath),
    onSuccess: async () => {
      setLocalPath('');
      await client.invalidateQueries({ queryKey: keys.repos(workspaceId) });
      await client.invalidateQueries({ queryKey: keys.workspace(workspaceId) });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    link.mutate();
  };

  return (
    <section>
      <h2>Link a repo</h2>
      <form className="row" onSubmit={submit}>
        <input
          aria-label="Path to a local clone"
          placeholder="/absolute/path/to/clone"
          required
          value={localPath}
          onChange={(event) => setLocalPath(event.target.value)}
        />
        <button type="submit" disabled={link.isPending}>
          Link
        </button>
      </form>
      <ErrorMessage error={link.error} />
    </section>
  );
}

function TicketList({ workspaceId, repo }: { workspaceId: string; repo: LinkedRepo }) {
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
    <section>
      <h2>Tickets</h2>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(searchText.trim());
        }}
      >
        <input
          aria-label="Search tickets"
          placeholder="Search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <button type="submit">Search</button>
        <select
          aria-label="Ticket state"
          value={state}
          onChange={(event) => setState(event.target.value as TicketState)}
        >
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
      </form>

      <ErrorMessage error={tickets.error} />
      {tickets.data?.items.length === 0 && <p>No tickets match.</p>}
      <ul className="list">
        {tickets.data?.items.map((ticket) => (
          <li key={ticket.key}>
            <Link
              to="/w/$workspaceId/tickets/$ticketKey"
              params={{ workspaceId, ticketKey: ticket.key }}
            >
              {ticket.title}
            </Link>{' '}
            <small>
              {ticket.key} · {ticket.status} · updated {formatTime(ticket.updatedAt)}
            </small>
          </li>
        ))}
      </ul>

      <div className="row">
        <button
          type="button"
          disabled={cursors.length === 0}
          onClick={() => setCursors((list) => list.slice(0, -1))}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!tickets.data?.nextCursor}
          onClick={() => {
            const next = tickets.data?.nextCursor;
            if (next) setCursors((list) => [...list, next]);
          }}
        >
          Next
        </button>
      </div>
    </section>
  );
}
