import type { LinkedRepo, TicketSource } from '@slop-control/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import {
  AppButton,
  ErrorMessage,
  LabeledInput,
  LabeledSelect,
  StatusDot,
} from '../components/common';
import { api } from '../lib/app-api';
import { keys } from '../lib/session-cache';
import { formatMoment } from '../lib/session-view';

const NO_REPO = '';

const TYPE_LABELS: Record<TicketSource['type'], string> = {
  built_in: 'Built-in tracker',
  github_issues: 'GitHub Issues',
  jira: 'Jira',
};

const repoName = (repo: LinkedRepo) => `${repo.githubOwner}/${repo.githubRepo}`;

function useSourcesChanged(workspaceId: string) {
  const client = useQueryClient();
  return async () => {
    await client.invalidateQueries({ queryKey: keys.sources(workspaceId) });
    await client.invalidateQueries({ queryKey: keys.ticketLists(workspaceId) });
  };
}

export function SourcesPage() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId/sources' });
  const sources = useQuery({
    queryKey: keys.sources(workspaceId),
    queryFn: () => api.listSources(workspaceId),
  });
  const repos = useQuery({
    queryKey: keys.repos(workspaceId),
    queryFn: () => api.listRepos(workspaceId),
  });

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Ticket sources</h1>
        <p className="max-w-[720px] text-[13px] text-muted">
          Where this workspace's tickets come from. The built-in tracker is always there; while
          another source is connected, new tickets are created in that tracker instead.
        </p>
      </div>

      <ErrorMessage error={sources.error} />
      <ErrorMessage error={repos.error} />

      <section aria-label="Sources" className="flex flex-col gap-3">
        {sources.data?.map((source) => (
          <SourceCard
            key={source.id}
            workspaceId={workspaceId}
            source={source}
            repos={repos.data ?? []}
          />
        ))}
      </section>

      <ConnectSourceForm workspaceId={workspaceId} repos={repos.data ?? []} />
    </>
  );
}

function SourceCard({
  workspaceId,
  source,
  repos,
}: {
  workspaceId: string;
  source: TicketSource;
  repos: LinkedRepo[];
}) {
  const changed = useSourcesChanged(workspaceId);
  const builtIn = source.type === 'built_in';
  const disconnected = source.disconnectedAt !== null;

  const setDefault = useMutation({
    mutationFn: (defaultLinkedRepoId: string | null) =>
      api.updateSource(workspaceId, source.id, { defaultLinkedRepoId }),
    onSuccess: changed,
  });
  const disconnect = useMutation({
    mutationFn: () => api.disconnectSource(workspaceId, source.id),
    onSuccess: changed,
  });
  const reconnect = useMutation({
    mutationFn: () => {
      if (!source.scope || !('githubOwner' in source.scope)) {
        throw new Error("This kind of source can't be reconnected from here yet.");
      }
      return api.connectSource(workspaceId, {
        type: 'github_issues',
        githubOwner: source.scope.githubOwner,
        githubRepo: source.scope.githubRepo,
        defaultLinkedRepoId: source.defaultLinkedRepoId ?? undefined,
      });
    },
    onSuccess: changed,
  });

  return (
    <article
      aria-label={`Source ${source.label}`}
      className="flex flex-col gap-3 rounded-xl border border-line bg-white px-[18px] py-4"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="font-semibold">{source.label}</h2>
        <span className="rounded-full border border-line px-2 py-0.5 text-[12px] text-ink-soft">
          {TYPE_LABELS[source.type]}
        </span>
        <span className="ml-auto text-[13px]">
          {disconnected ? (
            <StatusDot tone="neutral" label="Disconnected" />
          ) : (
            <StatusDot tone="ok" label="Connected" />
          )}
        </span>
      </div>

      {builtIn ? (
        <p className="text-[13px] text-ink-soft">
          {source.canCreateTickets
            ? 'New tickets can be created here.'
            : 'New tickets are off while another source is connected. Existing ones stay workable.'}{' '}
          It can't be changed or disconnected.
        </p>
      ) : disconnected ? (
        <p className="text-[13px] text-ink-soft">
          Disconnected {source.disconnectedAt && formatMoment(source.disconnectedAt)}. Its sessions
          and results are kept, and new sessions on its tickets are blocked until it's reconnected.
        </p>
      ) : (
        <p className="text-[13px] text-ink-soft">
          Read with the server's GitHub token, or anonymously without one. No credential is stored
          here.
        </p>
      )}

      {!builtIn && !disconnected && (
        <div className="flex flex-wrap items-end gap-2">
          <LabeledSelect
            label={`Default repo for ${source.label}`}
            className="min-w-[240px]"
            value={source.defaultLinkedRepoId ?? NO_REPO}
            disabled={setDefault.isPending}
            onChange={(event) => setDefault.mutate(event.target.value || null)}
          >
            <option value={NO_REPO}>No default</option>
            {repos.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repoName(repo)}
              </option>
            ))}
          </LabeledSelect>
          <AppButton
            tone="danger"
            className="ml-auto"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate()}
          >
            Disconnect
          </AppButton>
        </div>
      )}
      {!builtIn && disconnected && (
        <AppButton
          className="self-end"
          disabled={reconnect.isPending}
          onClick={() => reconnect.mutate()}
        >
          Reconnect
        </AppButton>
      )}

      <ErrorMessage error={setDefault.error} />
      <ErrorMessage error={disconnect.error} />
      <ErrorMessage error={reconnect.error} />
    </article>
  );
}

function ConnectSourceForm({ workspaceId, repos }: { workspaceId: string; repos: LinkedRepo[] }) {
  const changed = useSourcesChanged(workspaceId);
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [defaultRepoId, setDefaultRepoId] = useState(NO_REPO);
  const connect = useMutation({
    mutationFn: () =>
      api.connectSource(workspaceId, {
        type: 'github_issues',
        githubOwner: owner.trim(),
        githubRepo: repo.trim(),
        defaultLinkedRepoId: defaultRepoId || undefined,
      }),
    onSuccess: async () => {
      setOwner('');
      setRepo('');
      setDefaultRepoId(NO_REPO);
      await changed();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    connect.mutate();
  };

  return (
    <section aria-label="Connect a source">
      <form
        onSubmit={submit}
        className="flex flex-col gap-3 rounded-xl border border-line bg-white px-[18px] py-4"
      >
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Connect GitHub Issues</h2>
          <p className="text-[13px] text-ink-soft">
            Any repo's Issues, linked here or not. It's checked before it's saved. Connecting a
            source turns off new tickets in the built-in tracker.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <LabeledInput
            label="Owner"
            placeholder="acme"
            mono
            required
            className="min-w-0 flex-[1_1_160px]"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          />
          <LabeledInput
            label="Repository"
            placeholder="widgets"
            mono
            required
            className="min-w-0 flex-[1_1_160px]"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
          />
          <LabeledSelect
            label="Default repo for sessions (optional)"
            className="min-w-0 flex-[1_1_220px]"
            value={defaultRepoId}
            onChange={(event) => setDefaultRepoId(event.target.value)}
          >
            <option value={NO_REPO}>No default</option>
            {repos.map((item) => (
              <option key={item.id} value={item.id}>
                {repoName(item)}
              </option>
            ))}
          </LabeledSelect>
          <AppButton tone="primary" type="submit" disabled={connect.isPending}>
            Connect source
          </AppButton>
        </div>
        <ErrorMessage error={connect.error} />
      </form>
    </section>
  );
}
