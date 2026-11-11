-- Phase setups v0: one row per workspace and launchable phase, replacing the hard-coded phase
-- table. A session records the setup it started with, where it started from, and what it was given.

create table phase_setup (
  workspace_id uuid not null references workspace (id),
  phase text not null
    check (phase in ('investigation', 'planning', 'implementation', 'code_review')),
  instruction text not null check (length(trim(instruction)) > 0),
  may_change_code boolean not null,
  required_artifact_path text not null,
  user_level_source boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, phase)
);

alter table phase_setup enable row level security;

-- The same defaults as `phase-defaults.ts`, which new workspaces get.
create temporary table phase_default (
  phase text primary key,
  instruction text not null,
  may_change_code boolean not null,
  required_artifact_path text not null
);

insert into phase_default values
  ('investigation',
   'Investigate this ticket without changing code, and write your findings as markdown to `.slop/investigation.md`.',
   false, '.slop/investigation.md'),
  ('planning',
   'Plan the work for this ticket without changing code, and write the plan as markdown to `.slop/plan.md`.',
   false, '.slop/plan.md'),
  ('implementation',
   'Implement this ticket, commit your work, and write a report as markdown to `.slop/implementation-report.md`.',
   true, '.slop/implementation-report.md'),
  ('code_review',
   'Review the code for this ticket without changing it, and write your review as markdown to `.slop/review-report.md`.',
   false, '.slop/review-report.md');

insert into phase_setup (workspace_id, phase, instruction, may_change_code, required_artifact_path)
select w.id, d.phase, d.instruction, d.may_change_code, d.required_artifact_path
from workspace w cross join phase_default d;

alter table session add column round integer not null default 1;
alter table session add column setup jsonb;
alter table session add column base_ref text;
-- Null for sessions from before this column existed, which are never checked for code changes.
alter table session add column base_commit text;
alter table session add column input_artifacts jsonb not null default '[]';
alter table session add column scope_flags text[] not null default '{}';

-- Existing sessions ran with the hard-coded values, and did load `~/.claude`.
update session s
set setup = jsonb_build_object(
      'instruction', d.instruction,
      'scope', jsonb_build_object('mayChangeCode', d.may_change_code),
      'stopCondition', jsonb_build_object('requiredArtifactPath', d.required_artifact_path),
      'userLevelSource', true
    ),
    base_ref = 'origin/' || r.default_branch
from linked_repo r, phase_default d
where r.id = s.linked_repo_id and d.phase = s.phase;

-- A session in a phase with no default, which Sprint 1 could not launch, still needs a setup.
update session s
set setup = jsonb_build_object(
      'instruction', '',
      'scope', jsonb_build_object('mayChangeCode', false),
      'stopCondition', jsonb_build_object('requiredArtifactPath', ''),
      'userLevelSource', true
    ),
    base_ref = 'origin/' || r.default_branch
from linked_repo r
where r.id = s.linked_repo_id and s.setup is null;

alter table session alter column setup set not null;
alter table session alter column base_ref set not null;

drop table phase_default;
