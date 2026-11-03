---
title: "Requirements — Slop Control"
summary: "Functional and non-functional requirements for Slop Control."
---

# Functional Requirements

## Workspaces & linked sources

- **FR-1** The app must open with a workspace selector and must not allow sessions until a workspace exists.
- **FR-2** A workspace must have at least one linked GitHub repository and may link several; ticket sources (FR-6a), Slack channels, and wiki must be optional.
- **FR-3** Each workspace must keep its own linked sources, agent/skill configuration, project knowledge, and session history, isolated from other workspaces.

## Tickets & ticket sources

- **FR-4** The workspace must read and write every ticket through a tracker adapter. Tickets from a connected source must not be stored as rows: that tracker stays their source of truth. Only the built-in tracker (FR-6e) stores tickets, and the workspace is their source of truth.
- **FR-5** The MVP must ship adapters for **Jira**, **GitHub Issues**, and the **built-in tracker**.
- **FR-6** Every adapter must support: list/search tickets, read ticket details, add a comment, and transition status (the latter two only via approved drafted actions, see FR-27).
- **FR-6a** A workspace must be able to connect **zero or more ticket sources**, in any mix and including several of one type. A ticket source is one scope in one tracker: a Jira project or one repository's GitHub Issues.
- **FR-6b** Connecting a ticket source must be a separate step from linking a repository. Linking a repository must not connect its GitHub Issues, though the linking flow may offer to. A GitHub Issues source need not be a linked repository. Each source has its own credentials (A-5).
- **FR-6c** The ticket view must list and search the tickets of all the workspace's sources together, show each ticket's source, and allow filtering by source. A source that fails must show its own error (auth or unreachable) while the other sources' tickets still list.
- **FR-6d** A ticket must be identified by its source and its key, since keys are only unique within a source. Sessions, plans, annotations, and drafted actions must record both, and ticket comments and status transitions must be dispatched to the ticket's own source.
- **FR-6e** Every workspace must have a **built-in tracker** that needs no setup. While a workspace has no connected source, the built-in tracker is its only ticket source, and the developer can create tickets in the dashboard. A built-in ticket has a title, a markdown body, comments, a per-workspace key (e.g. `T-12`), and one of the fixed statuses *To do*, *In progress*, *In review*, *Done*, or *Cancelled*.
- **FR-6f** The developer may edit built-in tickets directly in the dashboard. Sessions may not: they change a built-in ticket only through approved drafted actions, as with any other source (FR-27).
- **FR-6g** When a workspace connects its first source, its built-in tickets must stay listed and workable, with their sessions and plans, but creating new built-in tickets must be turned off. They are not moved to the connected tracker. Disconnecting the last source turns creation back on.
- **FR-6h** Disconnecting a source must keep the sessions, plans, and artifacts of its tickets. Those tickets show as *source disconnected*, with the brief stored on each session as their remaining context, and new sessions cannot start on them.

## Sessions

- **FR-7** Sessions must be launched by the workspace; only workspace-launched sessions are tracked in the MVP (importing manually started sessions is out of scope).
- **FR-8** The MVP must support **Claude Code** as the only session runtime, behind a runtime interface that allows other tools later.
- **FR-9** Sessions must run headless (Claude Agent SDK / `claude -p` style), and their status must update live in the dashboard without polling. Live streaming of agent output is not required.
- **FR-10** Each session must record: ticket and its source (FR-6d), plan (if any, see FR-10b), phase, repository, agent/skill setup used, working copy (worktree) path, start/end time, status, transcript, and a summary of findings/decisions.
- **FR-11** A **ticket-level session** (no plan) must run in its own git worktree of the linked repository chosen for it (FR-11a), created by the workspace. A session that belongs to a plan must run in that **plan's worktree** (FR-10d).
- **FR-11a** A ticket must not determine its repository, since a Jira or built-in ticket names none. A session runs in exactly one linked repository, shown and changeable before launch (FR-18). The workspace must preselect the workspace's only repository, or the repository of a GitHub Issues ticket when that repository is linked; otherwise the developer must choose. The repository of a session on a plan is the plan's and cannot be changed.

## Plans

- **FR-10a** A ticket must be able to have zero or more **plans**. Each plan is a separately shippable part of the ticket. Splitting a ticket into several plans is optional.
- **FR-10b** Every session must link to exactly one ticket and may also link to one plan of that ticket. Sessions in any phase may be ticket-level (no plan).
- **FR-10c** A planning session is linked to the ticket, and its plan document may define one or more plans, each made of **plan items**. The workspace must create a plan record for each one.
- **FR-10d** Each plan must target one linked repository and own one branch and one worktree in it. All sessions linked to the plan share them, and only one session may run on a plan at a time. A ticket whose work spans several repositories gets one plan per repository.
- **FR-10e** A plan is always **revised**, never replaced. Changes go through correction rounds (FR-35) of the planning session that defined it.
- **FR-10f** The ticket view must show the ticket's plans, each plan's plan items and sessions, and the ticket-level sessions.

## Session interaction

- **FR-12** From the dashboard, the user must be able to stop a running session and, once it has ended, send it a follow-up message that resumes the same session in its worktree. A running session never waits for input: permission prompts are off in auto mode (FR-15), a call nothing approves is denied and the agent carries on, and the denial is visible only in the transcript.
- **FR-13** Each session must expose a copyable command to continue it manually in a terminal (e.g. `claude --resume <id>` in the worktree), including an SSH-prefixed variant when the workspace runs on a remote host.

## Phases & orchestration

- **FR-14** A **phase setup** must define: main agent, sub-agents, skills, MCP servers, a **scope** (what the phase may and may not do), and a **stop condition** (the explicit state at which the phase ends).
- **FR-15** Sessions must run in Claude Code's **auto** permission mode by default; safety comes from the phase's pre-defined scope and stop condition, not from per-step prompts.
- **FR-16** A session must stop when its phase's stop condition is reached and must not continue into the next phase on its own; moving to the next phase is a separate session started by the user.
- **FR-17** The orchestrator must suggest the next phase for a ticket (default order: investigation → planning → implementation → automated testing → e2e testing → code review), and the user must be able to start any phase in any order, any number of times.
- **FR-18** Before launch, the user must see the resolved repository (FR-11a) and setup (agents, sub-agents, skills, MCP servers) and may adjust them for that session.

## Agents & skills manager

- **FR-19** Agents, sub-agents, and skills must be stored in the app's own directory (per workspace) and loaded/routed into the session at launch — either passed via runtime config or copied into the session's worktree.
- **FR-20** The manager must list, per phase, which agents/sub-agents/skills will be used, and allow enabling/disabling each.
- **FR-21** The manager must allow installing agents/skills by download (URL / git repo) and from a catalog.
- **FR-22** A phase's stop condition must be a **required artifact** (e.g. `investigation.md`, `plan.md`, test report, review report); the workspace must mark the phase complete only when the artifact exists in the session's worktree.
- **FR-23** If a session ends without producing its required artifact, the workspace must mark it *incomplete* and offer to continue it.

## Built-in project knowledge (MCP)

- **FR-24** The app must ship a built-in MCP server, attached to every session, that exposes the workspace's project knowledge.
- **FR-25** Project knowledge must be developer-authored question/answer pairs, created, edited, and deleted in the dashboard; the MCP must expose **Q&A only** (no ticket context or action tools).
- **FR-26** Changes to project knowledge must be visible to the next session launched, without restarting the app.

## Drafted actions & approvals

- **FR-27** Sessions must not perform outward-facing actions directly; instead, the workspace must produce **drafted actions** for the user to review.
- **FR-28** MVP action types: **open PR** (push branch + create PR with drafted title/body), **ticket comment**, **ticket status transition**, **docs update** (repo file or wiki page), **test strategy update** (FR-54), and **next-phase suggestion** (start a session for the suggested phase).
- **FR-28a** Drafted actions must be **derived by the workspace from phase artifacts** (e.g. worktree diff → open PR, review report → ticket comment, completed phase → next-phase suggestion), optionally supplemented by an actions file the agent writes in the worktree.
- **FR-29** Every drafted action must be editable before approval and must be approved or rejected individually; only approved actions are dispatched.
- **FR-30** Dispatch results (success, failure + error) must be recorded on the session and visible in the dashboard.
- **FR-30a** An **open PR** action must have access to every artifact produced by the ticket's sessions in **all phases** (investigation and planning notes, implementation report, test report with its evidence files such as screenshots and video recordings, review report, data outputs), not only the artifacts of the phase that drafted it. The approval view must list them grouped by phase and session, with the kind filters *media*, *reports*, and *data*.
- **FR-30b** The user must be able to select any of those artifacts, individually or in one pass, and choose per artifact how it enters the PR: **embed** (media), **link only**, **summary + link** or **full text, collapsed** (reports). The workspace must render the selection into an *Evidence* section of the drafted PR body, which stays editable like the rest of the body (FR-29) and can be updated or removed as the selection changes.
- **FR-30c** When dispatched, media attachments (screenshots, recordings) must be uploaded to the PR itself so they remain viewable after the worktree is gone; reports and data files must be committed to the plan's branch under a per-ticket folder (default `.slop/<ticket>/<phase>/`) and linked from the body, with an option to link them from the workspace's artifact store instead of committing them.

## Review UI

- **FR-31** The dashboard must include a web code editor showing the session's diff against its base branch, with in-place editing saved back to the worktree.
- **FR-32** The dashboard must include a markdown viewer for session artifacts (plans, investigation notes, test reports with their evidence, review reports) and for the workspace's test strategy.

## Annotations & correction rounds

- **FR-33** The user must be able to **annotate** a phase artifact (markdown viewer, FR-32) and a session's diff (code editor, FR-31): each annotation is anchored to a paragraph or line, carries free text, and has a status of *new*, *open*, *addressed*, or *resolved*.
- **FR-34** Annotations must be stored per ticket, plan (if any), phase, and artifact, and shown on the ticket's session history, so earlier rounds of feedback remain visible.
- **FR-35** The user must be able to **send back** the unresolved annotations to the phase's agent. Sending back starts a new **round** in the same phase by **resuming** the session that produced the artifact (not a fresh session), with the annotations as its brief; only *new* and *open* annotations are sent.
- **FR-36** A correction round's stop condition is the phase's required artifact (FR-22) **plus** a reply to every annotation sent; an annotation the agent answers is marked *addressed*, and only the user may mark it *resolved* or reopen it.
- **FR-37** Annotating and editing in place must be distinct actions: an annotation goes back to the agent, while an in-place edit (FR-31) changes the worktree directly and becomes part of the drafted PR.
- **FR-38** In the MVP, annotations apply to the **planning** and **implementation** phases (plan.md and the implementation diff), to **test reports**, and to the **test strategy**; the same mechanism may be extended to investigation notes and review reports later.

## Testing

- **FR-50** There must be two testing phases, **automated testing** and **e2e testing**, each with its own phase setup, scope, stop condition and sessions. Either can be started on its own, any number of times (FR-17).
- **FR-51** The planning phase must write **test cases** into the plan document under each plan item. Each test case states what it checks, its expected result, and whether it is *automated* or *e2e*. Every plan item must have at least one test case or a stated reason why it has none; the plan document does not satisfy its stop condition (FR-22) otherwise. Test cases are revised through the plan's correction rounds like the rest of the plan document.
- **FR-52** A testing session's brief is the plan's test cases of its kind. Its required artifact is a **test report** giving, per test case, *passed*, *failed* or *blocked* (could not run), with **evidence**: command output, log excerpts, database queries with their results, and screenshots or recordings where taken.
- **FR-52a** A test report may carry **test artifacts**: files the session saved while testing and links from the report or from a test case's evidence. MVP artifact kinds: **markdown** notes, **JSON** and plain **text** output files (test runner output, API responses, query results too long to inline), **screenshots** (PNG, JPEG), and **video recordings** (MP4, WebM) of a browser or terminal run. Each artifact records which test case it belongs to, when it was captured, its size, and, where it came from a hook, the hook's name and environment (FR-61).
- **FR-52b** Test artifacts must be stored in the workspace's own storage next to the report, never in the session's worktree, so they are not committed and do not reach a PR. The session writes them to a capture folder the workspace provides and mounts; the workspace moves them into storage when the report is produced. Per-session limits (total size, recording length) are workspace settings with safe defaults; a session that exceeds them keeps the artifact out and says so in the report.
- **FR-52c** The markdown viewer (FR-32) must render test artifacts inline: markdown as a document, JSON pretty-printed with collapsible nodes, text with line numbers, images at natural size with zoom, and video with a player and a timeline. Each artifact must be openable on its own, downloadable, and annotatable (FR-33), and an annotation on an image or a video frame anchors to the pixel region or the timestamp.
- **FR-52d** The test strategy (FR-54) may say which artifacts to capture for which kinds of test case (e.g. record the browser for UI flows, save the full runner output as JSON for automated cases); the tester follows it and may propose changes through a test strategy update (FR-56).
- **FR-53** Testing phases must not change product code. When a test case fails, the session records it and stops; the next-phase suggestion is an **implementation correction round** with the failed test cases and their evidence as its brief. The automated testing phase may add or change **test files** so that its test cases are coded; these changes stay in the plan's worktree and become part of its PR.
- **FR-54** Each workspace must have one **test strategy**: how to test its project end to end (what to start and how, e.g. run the service, set env vars and invoke a single lambda, run frontend and backend together; how to exercise it; and what to inspect afterwards, e.g. logs, database rows, queues). Repos with different stacks get their own section.
- **FR-55** When an e2e testing session starts and the workspace has no approved test strategy, the session must first **discover** one by studying the codebase (and project knowledge), and stop with the draft as its required artifact. The draft reaches the user as a drafted **test strategy update** action. Once approved, the session is resumed to run its test cases.
- **FR-56** Later e2e sessions must follow the approved test strategy. When they find it wrong or incomplete (e.g. a blocked test case), they may propose changes as a drafted test strategy update. The user may also edit the strategy directly or annotate it and send it back (FR-35).
- **FR-57** E2E testing must run only against the session's own worktree and local services (local databases, local emulators, containers, direct handler calls). Touching a shared or remote environment (deployed functions, staging databases, third-party sandboxes) is out of scope unless the workspace's test strategy explicitly allows that environment.

## Test environment

- **FR-64** Each workspace must keep a **test environment**: the environment variables its e2e and manual test cases need, with workspace defaults and per-ticket overrides. Testing sessions receive them as process environment; other phases never see them.
- **FR-65** The developer must be able to fill the test environment three ways: type variables by hand, import a `.env` file, or run **inference**, a read-only session that scans the worktree (`.env.example` files, `process.env` and `import.meta.env` reads, docker-compose services, CI workflow env) and the approved test strategy, and proposes names, where each is used, and non-secret defaults. Inference must never guess secrets, read the developer's shell, or overwrite a value the developer typed; every proposal stays editable.
- **FR-66** Each variable has a value, a required flag, a *not needed* switch, and the test cases that use it, mapped from the strategy. A testing session must not start or resume while a required variable has no value and is not marked not needed; the strategy approval and the ticket must show which cases are blocked by which variable. Approving a strategy is allowed regardless.
- **FR-67** Values are stored in the workspace, encrypted at rest, never written to the worktree, and secret values are redacted wherever a status reason, log, test report or drafted action would show them (NFR-4). The tester may request a new variable through a test strategy update (FR-56); it appears as a missing row.

## Inspection hooks

- **FR-58** A workspace must let the developer register **inspection hooks**: read-only connections to systems the project writes to, so testing sessions can gather evidence from them. MVP hook types: **SQL database** (Postgres, MySQL), **object store** (S3 and S3-compatible emulators), **log service** (CloudWatch Logs and serverless function logs, plus local log files), **queue** (SQS and local equivalents), and **HTTP endpoint** (health and status URLs). Each hook has a name, a type, connection details, credentials, and an **environment** label: *local*, *staging* or *production*.
- **FR-59** Hooks must be exposed to sessions through a built-in **inspection MCP server** that offers read-only tools only: run a query, list objects and read an object or its metadata, search or tail logs for a time window, peek a queue without consuming, and fetch a URL. It must offer no tool that writes, deletes, consumes or invokes. Where the target system supports it, the hook's credential must itself be read-only; the workspace must verify this where it can (e.g. a database role check) and mark a hook *unverified* where it cannot.
- **FR-60** A session gets only the hooks its phase and the test strategy allow: *local* hooks are mounted into every testing session; *staging* and *production* hooks only when the test strategy names them under allowed environments (FR-57), per hook. *Production* hooks are off by default, must be enabled per hook by the developer, and are never mounted into implementation sessions.
- **FR-61** Every hook call a session makes must be recorded on the session (hook, tool, parameters, duration, result size) and must be attachable to a test report as evidence; the report cites the hook by name and environment next to each piece of evidence that came from it (FR-52).
- **FR-62** During test strategy discovery (FR-55) and later e2e sessions (FR-56), the tester may include **hook requests** in a drafted test strategy update: the hook type, what it would be used to inspect, and which test cases it would unblock. The developer creates the hook with its credentials in the dashboard; credentials are stored in the workspace's secret store (A-5) and never reach a session, a worktree, a transcript or a report (NFR-4).
- **FR-63** The test strategy's "what to inspect afterwards" section (FR-54) must name the hook to use for each kind of inspection, so that evidence gathering is repeatable across sessions.

## Ambient setup

- **FR-39** Whenever a launch is resolved, and on demand in the manager, the workspace must detect the **ambient** items the runtime will load into the session. It must check the session's worktree (or the base branch, before the worktree exists) and the host. The sources are: project `.claude/` agents, skills, commands, `CLAUDE.md` and rules, and `.mcp.json`; their user-level `~/.claude` equivalents; enabled plugins; and auto memory.
- **FR-40** The manager and the pre-launch view (FR-18) must list each ambient item with its source and an estimated context cost, plus a total for the session.
- **FR-41** Each phase setup must have a switch for the **user-level source** (`~/.claude`), **off by default**. The project source is always on in the MVP. The pre-launch view may override the switch for one session. Ambient choices are saved per phase setup and matched to items by source + name.
- **FR-42** The pre-launch view must flag ambient items that are new since the phase's last launch.
- **FR-43** When a managed item and an ambient item share a name, the managed item must win. The ambient one is shown as **shadowed** and kept out of the session.

## Token usage

- **FR-44** The workspace must record **token usage** per round: input, output, cache-read and cache-write tokens for each model, plus **peak context fill**.
- **FR-45** Usage must add up from round to session, plan, phase and ticket, and must be shown in the ticket view and the session history.
- **FR-46** Each session must record its **baseline context**, meaning the context in use at its first request, before the agent does any work. Each phase setup must show the baselines of its recent sessions.
- **FR-47** Sub-agent usage must count toward its session's totals, with a breakdown per sub-agent (type and description).
- **FR-48** The session transcript on disk is the source of truth for usage. Usage must be reconciled from it when a session ends and when the dashboard next opens the session, so turns continued in a terminal (FR-13) are counted. While a session runs, the dashboard may show a running total read from the transcript on disk at intervals, clearly marked as not reconciled; no agent output is streamed for it (FR-9).
- **FR-49** Token counts must be the main usage figure. Dollar cost is shown only as a secondary "API-equivalent" figure (see A-1).

# Non-Functional Requirements

## Scale & performance

- **NFR-1** The app must support **1–5 concurrent sessions** and a handful of workspaces on a single developer machine.
- **NFR-2** Session status changes must appear in the dashboard within ~1 s of being reported by the runtime.

## Security

- **NFR-3** The dashboard must require sign-in via **Supabase Auth**.
- **NFR-4** Tracker, GitHub, inspection hook, and other integration credentials must never be written into worktrees, transcripts, test reports, or drafted-action payloads.

## Platforms

- **NFR-5** The app must run on the developer's machine (macOS first) and be deployable to a remote host; the dashboard is a web UI used from a desktop browser.
- **NFR-6** The app must work with any git repository regardless of language or framework; project-specific behavior comes only from project knowledge and agent/skill configuration.

## Data

- **NFR-7** Workspaces, ticket source settings, built-in tickets, sessions, project knowledge, phase setups, and drafted actions must be stored in **Supabase Postgres** (local Supabase or cloud); agent/skill files live in the app directory (FR-19).

## Out of scope for MVP

- Slack agents, per-agent Slack users, and Slack reply approvals.
- Bug investigator with prod-like data replication.
- AI coding runtimes other than Claude Code.
- Importing sessions not launched by the workspace.
- Built-in tracker features beyond FR-6e and FR-6f, such as boards, assignees, sprints, custom statuses, and attachments.
- Moving tickets between sources.
- A session working across several repositories at once.
- Switches for ambient sources other than the user-level source (project, plugins) and for individual ambient items (skills, sub-agents, `CLAUDE.md` files). These move to Later if baseline context (FR-46) shows they matter.
- Token budgets and alerts.
- Automatic browser driving for frontend flows; MVP recordings (FR-52a) come from whatever the session itself runs, such as a headless browser the test strategy already uses or a terminal recorder.
- Test strategy allowances for shared or remote environments (FR-57).
- Write-capable hooks (seeding, resetting or invoking remote systems through a hook), and hooks for non-testing phases such as investigation.

# Assumptions

## Confirmed

- **A-1** Claude Code is installed and logged in on the host; the app uses the developer's own Claude Code install/subscription and does not manage Anthropic API keys. *If wrong:* the app needs its own API key management and billing visibility.
- **A-2** There is one user per deployment (the developer); teammates never sign in to the dashboard. *If wrong:* multi-user roles, per-user data isolation, and sharing are needed.
- **A-3** Supabase is available to the deployment (local or cloud). *If wrong:* auth and storage need a fallback (e.g. local SQLite + token auth).

## Unconfirmed (to revisit)

- **A-4** Repositories are cloned by the developer, and the workspace points at local clones to create worktrees. *Alternative:* the workspace clones linked GitHub repos itself.
- **A-5** The developer supplies GitHub credentials per workspace and tracker credentials per ticket source. *Open:* storage location for these secrets (Supabase vault, OS keychain, env file).
- **A-6** Built solo, part-time, with flexible MVP scope and no fixed deadline.
- **A-7** Phase artifacts are written to fixed, phase-configured paths in the worktree so the workspace can detect them (FR-22) and derive actions (FR-28a).
- **A-8** Claude Code sessions can be resumed headlessly with new input (FR-35), so a correction round continues the original session's context. *If wrong:* a correction round starts a fresh session that is given the previous transcript summary and the annotations. **Confirmed** by the [S1-04 spike](../spikes/s1-04-headless-resume/).
- **A-9** Each plan produces one PR (open PR is drafted per plan, from the plan's branch). *If wrong:* a plan may ship as several PRs or several plans may share one.

- **A-10** Claude Code keeps writing per-message usage and model to its on-disk transcripts, with each sub-agent in its own file next to a small file naming the agent type. This layout is undocumented and may change. *If wrong:* fall back to the session's end-of-run totals, losing the per-sub-agent breakdown and the turns continued in a terminal. **Partly confirmed** by the [S1-05 spike](../spikes/s1-05-transcript-usage/): the layout and per-message usage hold, but transcripts leave out the tool's small background model calls, so their totals run slightly below the SDK's.
- **A-11** Switching off the user-level source (FR-41) removes user-level `CLAUDE.md`, agents, skills, commands, plugins, settings and hooks. It does **not** remove auto memory or claude.ai connectors, which need their own switches (OQ-8).

## Open questions (tickets)

- **OQ-16** Should built-in tickets be movable into a connected tracker later, keeping their sessions and plans? *TBD*
- **OQ-17** Should a workspace with connected sources be able to keep creating built-in tickets, for example as a private backlog, instead of FR-6g turning creation off? *TBD*
- **OQ-18** Should a session be able to read other linked repositories while working in its own, so that planning can cover work spanning several? *TBD*

## Open questions (plans)

- **OQ-1** Can sessions also link to a single **plan item**, or only to a plan? *TBD*
- **OQ-2** Can plans of the same ticket depend on each other (ordering, stacked branches)? *TBD*
- **OQ-3** If a ticket-level implementation session writes code and a plan is created afterwards, can that work be moved into the plan's branch? *TBD*
- **OQ-4** If an implementation session finds its plan is wrong, can it hand back to the planning session's correction round on its own, or does the developer always trigger it? *TBD*

## Open questions (ambient setup & usage)

- **OQ-5** How should individual sub-agents be switched off? A deny rule only blocks one from running, and its description may stay in context. Removing it means excluding the whole project source and passing the enabled agents back in. *TBD*
- **OQ-6** Can individual `CLAUDE.md` files be excluded for one session? A per-session settings overlay looks like it should work but isn't documented. *TBD*
- **OQ-7** Should there be token budgets and alerts per phase or ticket? Revisit once there is real usage data. *TBD*
- **OQ-8** Should auto memory and claude.ai connectors get their own switches alongside the user-level source? *TBD*

## Open questions (testing)

- **OQ-9** Where does the test strategy live: in the workspace's own storage, or as a file committed to the repo (so the team shares it)? *TBD*
- **OQ-10** Where do a ticket-level testing session's test cases come from when there is no plan document? *TBD*
- **OQ-11** How are local services and test data reset between e2e runs, and should this share the mechanism of the later bug investigator's prod-like reproduction? *TBD*
- **OQ-12** Should test strategy discovery be its own session (and phase setup) instead of the first round of an e2e testing session (FR-55)? *TBD*
- **OQ-13** Should a passing test report be required before the code review phase is suggested, or only shown as a warning? *TBD*
- **OQ-14** Should inspection hooks also be mounted into investigation sessions (and later the bug investigator), given they are read-only? *TBD*
- **OQ-15** Does evidence read through a *production* hook need masking before it is stored in a test report, and who decides the masking rules? *TBD*
