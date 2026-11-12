-- Sprint 3: stored credentials (ADR-0004), drafted actions, and whether a session's base was fetched.
-- No source or workspace is given a credential here: the retired GITHUB_TOKEN setting isn't copied.

-- A secret is sealed by the server before it gets here, with a key that isn't in the database.
create table secret (
  owner_kind text not null check (owner_kind in ('workspace_github', 'ticket_source')),
  owner_id uuid not null,
  sealed text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_kind, owner_id)
);

alter table secret enable row level security;

-- The last known state of each credential. A null state means none is stored.
alter table workspace
  add column github_credential_state text
    check (github_credential_state in ('ok', 'auth_failed', 'unavailable')),
  add column github_credential_login text,
  add column github_credential_message text,
  add column github_credential_checked_at timestamptz,
  -- The last push check per linked repo: [{ "linkedRepoId": ..., "canPush": ... }].
  add column github_push_access jsonb not null default '[]';

alter table ticket_source
  add column credential_state text
    check (credential_state in ('ok', 'auth_failed', 'unavailable')),
  add column credential_login text,
  add column credential_message text,
  add column credential_checked_at timestamptz;

-- Existing sessions started before the base was ever fetched, and none of them failed to.
alter table session add column base_fetch_failed boolean not null default false;

create table drafted_action (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references session (id),
  workspace_id uuid not null references workspace (id),
  ticket_source_id uuid not null references ticket_source (id),
  ticket_key text not null,
  -- The session round that drafted it, or last redrafted it.
  round integer not null,
  type text not null check (type in ('open_pr', 'ticket_comment', 'ticket_transition')),
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'rejected', 'dispatching', 'succeeded', 'failed')),
  edited boolean not null default false,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  dispatched_at timestamptz
);

create index drafted_action_session_idx on drafted_action (session_id, created_at);
create index drafted_action_inbox_idx on drafted_action (workspace_id, status, created_at desc);
-- A session has at most one action of each type still waiting on the developer or on a dispatch.
create unique index drafted_action_open_idx on drafted_action (session_id, type)
  where status in ('pending', 'failed', 'dispatching');

alter table drafted_action enable row level security;
