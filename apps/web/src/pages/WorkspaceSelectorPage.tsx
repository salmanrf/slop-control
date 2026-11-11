import type { Workspace } from '@slop-control/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AppButton, ErrorMessage, LabeledInput, cx } from '../components/common';
import { api } from '../lib/app-api';
import { keys } from '../lib/session-cache';
import { formatMoment, initials } from '../lib/session-view';
import { supabase } from '../lib/supabase';

export function WorkspaceSelectorPage() {
  const workspaces = useQuery({ queryKey: keys.workspaces(), queryFn: api.listWorkspaces });
  const [creating, setCreating] = useState(false);
  const showForm = creating || workspaces.data?.length === 0;

  return (
    <div className="flex min-h-screen w-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-4 md:px-9">
        <span className="flex size-7 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white">
          SC
        </span>
        <span className="font-semibold">Slop Control</span>
        <span className="text-[13px] text-muted">· local · signed in as you</span>
        <AppButton className="ml-auto" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </AppButton>
      </header>

      <main className="mx-auto flex w-full max-w-[1180px] grow flex-col gap-7 px-4 py-9 md:px-9">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold tracking-[-0.01em]">Choose a workspace</h1>
          <p className="max-w-[640px] text-ink-soft">
            One workspace per project. Each keeps its own linked repos, ticket sources, and session
            history. Nothing runs until a workspace has at least one repository.
          </p>
        </div>

        <ErrorMessage error={workspaces.error} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workspaces.data?.map((workspace) => (
            <WorkspaceCard key={workspace.id} workspace={workspace} />
          ))}
          <button
            type="button"
            aria-expanded={showForm}
            onClick={() => setCreating(true)}
            className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2.5 rounded-[14px] border-2 border-dashed border-[#c9cbc4] p-5 text-ink-soft hover:bg-white"
          >
            <span className="flex size-10 items-center justify-center rounded-full border border-[#c9cbc4]">
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M8 3v10M3 8h10" />
              </svg>
            </span>
            <span className="font-semibold text-ink">New workspace</span>
            <span className="text-[12px]">Name it, then point it at a local clone</span>
          </button>
        </div>

        {showForm && (
          <NewWorkspaceForm
            canCancel={(workspaces.data?.length ?? 0) > 0}
            onCancel={() => setCreating(false)}
          />
        )}
      </main>
    </div>
  );
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const repos = useQuery({
    queryKey: keys.repos(workspace.id),
    queryFn: () => api.listRepos(workspace.id),
    enabled: workspace.hasLinkedRepo,
  });
  const repoNames = repos.data?.map((repo) => `${repo.githubOwner}/${repo.githubRepo}`).join(', ');

  return (
    <Link
      to="/w/$workspaceId"
      params={{ workspaceId: workspace.id }}
      className="flex min-h-[180px] flex-col gap-3.5 rounded-[14px] border border-line bg-white p-5 text-ink no-underline hover:border-field hover:text-ink"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-accent font-semibold text-white">
          {initials(workspace.name)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[16px] font-semibold">{workspace.name}</span>
          <span className="text-[12px] text-muted">
            Created {formatMoment(workspace.createdAt)}
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-1.5 text-[13px] text-ink-soft">
        <SourceLine linked={workspace.hasLinkedRepo}>
          {workspace.hasLinkedRepo ? (repoNames ?? 'Repo linked') : 'No repo linked yet'}
        </SourceLine>
        <SourceLine linked>Built-in tracker</SourceLine>
      </div>
    </Link>
  );
}

function SourceLine({ linked, children }: { linked: boolean; children: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cx('size-1.5 shrink-0 rounded-full', linked ? 'bg-ok' : 'bg-field')} />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

function NewWorkspaceForm({ canCancel, onCancel }: { canCancel: boolean; onCancel: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.createWorkspace(name),
    onSuccess: async (workspace) => {
      await client.invalidateQueries({ queryKey: keys.workspaces() });
      await navigate({ to: '/w/$workspaceId', params: { workspaceId: workspace.id } });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <section aria-label="New workspace">
      <form
        onSubmit={submit}
        className="flex flex-col gap-5 rounded-[14px] border border-line bg-white px-7 py-6"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-[18px] font-semibold">New workspace</h2>
          <p className="text-[13px] text-muted">
            Sessions stay blocked until you link a local clone, which is the next step.
          </p>
        </div>
        <LabeledInput
          label="Workspace name"
          placeholder="e.g. Orbit CRM"
          required
          className="max-w-[520px]"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <ErrorMessage error={create.error} />
        <div className="flex flex-wrap justify-end gap-2">
          {canCancel && <AppButton onClick={onCancel}>Cancel</AppButton>}
          <AppButton tone="primary" type="submit" disabled={create.isPending}>
            Create and link a repo
          </AppButton>
        </div>
      </form>
    </section>
  );
}
