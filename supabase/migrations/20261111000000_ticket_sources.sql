-- Ticket sources and the built-in tracker (ADR-0003). A ticket is addressed by source and key,
-- and a session's repo no longer comes from its ticket's key.

create table ticket_source (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace (id),
  type text not null check (type in ('built_in', 'github_issues', 'jira')),
  -- `built_in` or `github:<owner>/<repo>`, lowercased, so a reconnect finds the same row.
  scope_key text not null,
  github_owner text,
  github_repo text,
  default_linked_repo_id uuid references linked_repo (id),
  -- Built-in ticket numbers are handed out from here and never reused.
  next_ticket_number integer not null default 1,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, scope_key)
);

create table built_in_ticket (
  id uuid primary key default gen_random_uuid(),
  ticket_source_id uuid not null references ticket_source (id),
  number integer not null,
  title text not null check (length(trim(title)) > 0),
  body text not null default '',
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'in_review', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticket_source_id, number)
);

create index built_in_ticket_updated_idx on built_in_ticket (ticket_source_id, updated_at desc);

create table built_in_ticket_comment (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references built_in_ticket (id),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index built_in_ticket_comment_ticket_idx on built_in_ticket_comment (ticket_id, created_at);

alter table ticket_source enable row level security;
alter table built_in_ticket enable row level security;
alter table built_in_ticket_comment enable row level security;

insert into ticket_source (workspace_id, type, scope_key)
select id, 'built_in', 'built_in' from workspace;

-- One GitHub Issues source per distinct repo, so two clones of one repo share a source.
-- Its default repo is the oldest clone.
insert into ticket_source (workspace_id, type, scope_key, github_owner, github_repo, default_linked_repo_id)
select distinct on (workspace_id, lower(github_owner), lower(github_repo))
  workspace_id,
  'github_issues',
  'github:' || lower(github_owner) || '/' || lower(github_repo),
  github_owner,
  github_repo,
  id
from linked_repo
order by workspace_id, lower(github_owner), lower(github_repo), created_at, id;

alter table session add column ticket_source_id uuid references ticket_source (id);
alter table session add column ticket_title text;

update session s
set ticket_source_id = ts.id
from linked_repo r, ticket_source ts
where r.id = s.linked_repo_id
  and ts.workspace_id = s.workspace_id
  and ts.scope_key = 'github:' || lower(r.github_owner) || '/' || lower(r.github_repo);

-- A Sprint 1 brief starts with the ticket's title.
update session set ticket_title = split_part(brief, E'\n', 1);

alter table session alter column ticket_source_id set not null;
alter table session alter column ticket_title set not null;

drop index session_ticket_idx;
create index session_ticket_idx
  on session (workspace_id, ticket_source_id, ticket_key, started_at desc);
