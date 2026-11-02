-- The browser only uses Supabase for Auth. All data goes through the Nest API, so
-- row level security is on with no policies: the anon and authenticated roles get nothing.

create table workspace (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table linked_repo (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace (id),
  local_path text not null,
  github_owner text not null,
  github_repo text not null,
  default_branch text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, local_path)
);

create table session (
  id uuid primary key,
  workspace_id uuid not null references workspace (id),
  linked_repo_id uuid not null references linked_repo (id),
  ticket_key text not null,
  phase text not null,
  status text not null check (status in ('starting', 'running', 'ended', 'failed', 'stopped')),
  status_reason text,
  brief text not null,
  worktree_path text not null,
  branch text not null,
  worktree_removed_at timestamptz,
  runtime_session_id text,
  transcript_path text,
  artifact_status text check (artifact_status in ('complete', 'incomplete')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index session_ticket_idx on session (workspace_id, ticket_key, started_at desc);
create index session_active_idx on session (status) where status in ('starting', 'running');

create table session_artifact (
  session_id uuid not null references session (id),
  round integer not null default 1,
  path text not null,
  markdown text not null,
  created_at timestamptz not null default now(),
  primary key (session_id, round)
);

alter table workspace enable row level security;
alter table linked_repo enable row level security;
alter table session enable row level security;
alter table session_artifact enable row level security;
