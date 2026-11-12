import type { LinkedRepo, WorkspaceCredentialStatus } from '@slop-control/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/app-api';
import { credentialWording, repoPushWording } from '../lib/credential-view';
import { keys } from '../lib/session-cache';
import { formatMoment } from '../lib/session-view';
import { AppButton, ErrorMessage, LabeledInput, StatusDot } from './common';

export function useGithubCredential(workspaceId: string) {
  return useQuery({
    queryKey: keys.githubCredential(workspaceId),
    queryFn: () => api.getGithubCredential(workspaceId),
  });
}

/** The credential the workspace pushes and opens PRs with. Its value is never shown again. */
export function GithubCredentialPanel({
  workspaceId,
  repos,
}: {
  workspaceId: string;
  repos: LinkedRepo[];
}) {
  const client = useQueryClient();
  const credential = useGithubCredential(workspaceId);
  const [token, setToken] = useState('');
  const store = (status: WorkspaceCredentialStatus) =>
    client.setQueryData(keys.githubCredential(workspaceId), status);

  const save = useMutation({
    mutationFn: () => api.setGithubCredential(workspaceId, { token: token.trim() }),
    onSuccess: (status) => {
      setToken('');
      store(status);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.removeGithubCredential(workspaceId),
    onSuccess: store,
  });
  const check = useMutation({
    mutationFn: () => api.checkGithubCredential(workspaceId),
    onSuccess: store,
  });
  const busy = save.isPending || remove.isPending || check.isPending;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const status = credential.data;
  const wording = status && credentialWording(status);
  const access = status ? repoPushWording(status.repos, repos) : [];

  return (
    <section
      aria-label="GitHub credential"
      className="flex flex-col gap-2.5 rounded-xl border border-line bg-white px-[18px] py-4"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="font-semibold">GitHub credential</h2>
        {wording && (
          <span data-testid="github-credential-state" className="text-[13px]">
            <StatusDot tone={wording.tone} label={wording.label} />
          </span>
        )}
        {status?.checkedAt && (
          <span className="ml-auto text-[12px] text-muted">
            Last checked {formatMoment(status.checkedAt)}
          </span>
        )}
      </div>
      <p className="text-[13px] text-ink-soft">
        A GitHub token this workspace uses to push a session's branch and open its pull request,
        only when you approve one. It's checked before it's saved, and never shown again.
      </p>
      <ErrorMessage error={credential.error} />
      {status?.message && (
        <p role="status" className="text-[13px] text-danger-text">
          {status.message}
        </p>
      )}

      {access.length > 0 && (
        <ul aria-label="Push access" className="flex flex-col gap-1 text-[13px]">
          {access.map((repo) => (
            <li key={repo.linkedRepoId} className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-[12px] break-all">{repo.name}</span>
              <StatusDot
                tone={repo.canPush ? 'ok' : 'danger'}
                label={repo.canPush ? 'Can push' : "Can't push"}
              />
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <LabeledInput
          label={status?.isSet ? 'Replace the GitHub token' : 'GitHub token'}
          type="password"
          autoComplete="off"
          mono
          required
          className="min-w-0 flex-[1_1_320px]"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <AppButton tone="primary" type="submit" disabled={busy}>
          Save credential
        </AppButton>
        {status?.isSet && (
          <>
            <AppButton disabled={busy} onClick={() => check.mutate()}>
              Check again
            </AppButton>
            <AppButton tone="danger" disabled={busy} onClick={() => remove.mutate()}>
              Remove credential
            </AppButton>
          </>
        )}
      </form>
      <ErrorMessage error={save.error} />
      <ErrorMessage error={check.error} />
      <ErrorMessage error={remove.error} />
    </section>
  );
}
