import { Menu, Portal } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { api } from '../lib/app-api';
import { inboxActions } from '../lib/drafted-actions';
import { keys } from '../lib/session-cache';
import { initials } from '../lib/session-view';
import { supabase } from '../lib/supabase';
import {
  StreamStateContext,
  useSessionUpdates,
  type StreamState,
} from '../lib/use-session-updates';
import { cx } from './common';

const STREAM_STATUS: Record<StreamState, { dot: string; label: string }> = {
  connecting: { dot: 'bg-nav-muted', label: 'Local · connecting' },
  connected: { dot: 'bg-ok-bright', label: 'Local · live status on' },
  reconnecting: { dot: 'bg-[#ffd166]', label: 'Local · reconnecting' },
};

const NAV_LINK =
  'flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2.5 no-underline hover:text-white';

const NAV_ACTIVE = 'bg-nav-active font-medium text-white';
const NAV_IDLE = 'text-nav-soft';

/** Every view inside a workspace shares this frame and its one status stream. */
export function WorkspaceLayout() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId' });
  const streamState = useSessionUpdates(workspaceId);

  return (
    <StreamStateContext.Provider value={streamState}>
      <div className="flex min-h-screen w-full flex-wrap">
        <WorkspaceNav workspaceId={workspaceId} streamState={streamState} />
        <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-5 px-4 pt-7 pb-10 md:px-9">
          <Outlet />
        </main>
      </div>
    </StreamStateContext.Provider>
  );
}

function WorkspaceNav({
  workspaceId,
  streamState,
}: {
  workspaceId: string;
  streamState: StreamState;
}) {
  const status = STREAM_STATUS[streamState];
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const section = pathname.endsWith('/phase-setups')
    ? 'phase-setups'
    : pathname.endsWith('/sources')
      ? 'sources'
      : pathname.endsWith('/approvals')
        ? 'approvals'
        : 'tickets';
  // The same read as the inbox itself, so the stream's action frames keep the count live.
  const inbox = useQuery({
    queryKey: keys.inbox(workspaceId),
    queryFn: () => api.listDraftedActions(workspaceId),
  });
  const waiting = inboxActions(inbox.data ?? []).length;
  return (
    <nav
      aria-label="Main"
      className="flex max-w-full min-w-0 flex-[1_1_232px] flex-col gap-1.5 bg-nav px-3.5 py-5 text-nav-text"
    >
      <WorkspaceSwitcher workspaceId={workspaceId} />
      <div className="h-3" />
      <Link
        to="/w/$workspaceId"
        params={{ workspaceId }}
        aria-current={section === 'tickets' ? 'page' : undefined}
        className={cx(NAV_LINK, section === 'tickets' ? NAV_ACTIVE : NAV_IDLE)}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="2" y="3" width="12" height="10" rx="2" />
          <path d="M5 7h6M5 10h4" />
        </svg>
        Tickets
      </Link>
      <Link
        to="/w/$workspaceId/approvals"
        params={{ workspaceId }}
        aria-current={section === 'approvals' ? 'page' : undefined}
        className={cx(NAV_LINK, section === 'approvals' ? NAV_ACTIVE : NAV_IDLE)}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M2 9l2-6h8l2 6v4H2z" />
          <path d="M2 9h4l1 2h2l1-2h4" />
        </svg>
        Approvals
        {waiting > 0 && (
          <span
            data-testid="approvals-count"
            className="ml-auto rounded-full bg-accent px-2 py-px text-[12px] font-semibold text-white"
          >
            {waiting}
            <span className="sr-only"> waiting</span>
          </span>
        )}
      </Link>
      <Link
        to="/w/$workspaceId/sources"
        params={{ workspaceId }}
        aria-current={section === 'sources' ? 'page' : undefined}
        className={cx(NAV_LINK, section === 'sources' ? NAV_ACTIVE : NAV_IDLE)}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="4" cy="8" r="2" />
          <circle cx="12" cy="4" r="2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M6 7l4-2M6 9l4 2" />
        </svg>
        Ticket sources
      </Link>
      <Link
        to="/w/$workspaceId/phase-setups"
        params={{ workspaceId }}
        aria-current={section === 'phase-setups' ? 'page' : undefined}
        className={cx(NAV_LINK, section === 'phase-setups' ? NAV_ACTIVE : NAV_IDLE)}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M3 4h10M3 8h10M3 12h10" />
          <circle cx="6" cy="4" r="1.5" fill="currentColor" />
          <circle cx="10" cy="8" r="1.5" fill="currentColor" />
          <circle cx="5" cy="12" r="1.5" fill="currentColor" />
        </svg>
        Phase setups
      </Link>
      <div className="grow" />
      <Link to="/" className={cx(NAV_LINK, 'text-[13px] text-nav-muted')}>
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
        All workspaces
      </Link>
      <button
        type="button"
        onClick={() => void supabase.auth.signOut()}
        className={cx(NAV_LINK, 'cursor-pointer text-left text-[13px] text-nav-muted')}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M6 2H3v12h3M10 5l3 3-3 3M13 8H6" />
        </svg>
        Sign out
      </button>
      <div role="status" className="flex items-center gap-2.5 px-3 py-2 text-[12px] text-nav-muted">
        <span className={cx('size-2 rounded-full', status.dot)} />
        {status.label}
      </div>
    </nav>
  );
}

function WorkspaceSwitcher({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const workspaces = useQuery({ queryKey: keys.workspaces(), queryFn: api.listWorkspaces });
  const repos = useQuery({
    queryKey: keys.repos(workspaceId),
    queryFn: () => api.listRepos(workspaceId),
  });
  const current = workspaces.data?.find((item) => item.id === workspaceId);
  const repo = repos.data?.[0];

  return (
    <Menu.Root
      onSelect={({ value }) =>
        void navigate({ to: '/w/$workspaceId', params: { workspaceId: value } })
      }
    >
      <Menu.Trigger className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[10px] border border-nav-active bg-nav-raised px-3 py-2.5 text-left text-nav-text">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-[13px] font-semibold text-white">
          {initials(current?.name ?? '')}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-semibold">{current?.name ?? 'Workspace'}</span>
          <span className="truncate text-[12px] text-nav-muted">
            {repo ? `${repo.githubOwner}/${repo.githubRepo}` : 'No repo linked'}
          </span>
        </span>
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="#9a9d96"
          strokeWidth="1.5"
          className="ml-auto shrink-0"
        >
          <path d="M5 6l3-3 3 3M5 10l3 3 3-3" />
        </svg>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content className="min-w-56">
            {workspaces.data?.map((workspace) => (
              <Menu.Item key={workspace.id} value={workspace.id} className="min-h-10">
                {workspace.name}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
