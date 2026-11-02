import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { ErrorMessage } from '../components/common';
import { api } from '../lib/app-api';
import { keys } from '../lib/session-cache';

export function WorkspaceSelectorPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const workspaces = useQuery({ queryKey: keys.workspaces(), queryFn: api.listWorkspaces });

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
    <main className="narrow">
      <h1>Choose a workspace</h1>
      <ErrorMessage error={workspaces.error} />
      {workspaces.data?.length === 0 && <p>Create a workspace to start working on tickets.</p>}
      <ul className="list">
        {workspaces.data?.map((workspace) => (
          <li key={workspace.id}>
            <Link to="/w/$workspaceId" params={{ workspaceId: workspace.id }}>
              {workspace.name}
            </Link>
          </li>
        ))}
      </ul>

      <h2>New workspace</h2>
      <form className="row" onSubmit={submit}>
        <input
          aria-label="Workspace name"
          placeholder="Name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={create.isPending}>
          Create
        </button>
      </form>
      <ErrorMessage error={create.error} />
    </main>
  );
}
