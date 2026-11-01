---
title: "Requirements — Slop Control"
summary: "Functional and non-functional requirements for Slop Control."
---

# Functional Requirements

## Workspaces & linked sources

- **FR-1** The app must open with a workspace selector and must not allow sessions until a workspace exists.
- **FR-2** A workspace must have at least one linked GitHub repository; ticket tracker, Slack channels, and wiki must be optional.
- **FR-3** Each workspace must keep its own linked sources, agent/skill configuration, project knowledge, and session history, isolated from other workspaces.

## Tickets (adapter only)

- **FR-4** The workspace must not store tickets as its own source of truth; it must read and write tickets through a tracker adapter.
- **FR-5** The MVP must ship adapters for **Jira** and **GitHub Issues**.
- **FR-6** The adapter must support: list/search tickets, read ticket details, add a comment, and transition status (the latter two only via approved drafted actions, see FR-27).

## Sessions

- **FR-7** Sessions must be launched by the workspace; only workspace-launched sessions are tracked in the MVP (importing manually started sessions is out of scope).
- **FR-8** The MVP must support **Claude Code** as the only session runtime, behind a runtime interface that allows other tools later.
- **FR-9** Sessions must run headless (Claude Agent SDK / `claude -p` style) and stream their output live into the dashboard.
- **FR-10** Each session must record: ticket, plan (if any, see FR-10b), phase, agent/skill setup used, working copy (worktree) path, start/end time, status, transcript, and a summary of findings/decisions.
- **FR-11** A **ticket-level session** (no plan) must run in its own git worktree of the linked repository, created by the workspace. A session that belongs to a plan must run in that **plan's worktree** (FR-10d).

## Plans

- **FR-10a** A ticket must be able to have zero or more **plans**. Each plan is a separately shippable part of the ticket. Splitting a ticket into several plans is optional.
- **FR-10b** Every session must link to exactly one ticket and may also link to one plan of that ticket. Sessions in any phase may be ticket-level (no plan).
- **FR-10c** A planning session is linked to the ticket, and its plan document may define one or more plans, each made of **plan items**. The workspace must create a plan record for each one.
- **FR-10d** Each plan must own one branch and one worktree. All sessions linked to the plan share them, and only one session may run on a plan at a time.
- **FR-10e** A plan is always **revised**, never replaced. Changes go through correction rounds (FR-35) of the planning session that defined it.
- **FR-10f** The ticket view must show the ticket's plans, each plan's plan items and sessions, and the ticket-level sessions.

## Session interaction

- **FR-12** From the dashboard, the user must be able to send follow-up messages to a session and answer permission prompts it raises.
- **FR-13** Each session must expose a copyable command to continue it manually in a terminal (e.g. `claude --resume <id>` in the worktree), including an SSH-prefixed variant when the workspace runs on a remote host.

## Phases & orchestration

- **FR-14** A **phase setup** must define: main agent, sub-agents, skills, MCP servers, a **scope** (what the phase may and may not do), and a **stop condition** (the explicit state at which the phase ends).
- **FR-15** Sessions must run in Claude Code's **auto** permission mode by default; safety comes from the phase's pre-defined scope and stop condition, not from per-step prompts.
- **FR-16** A session must stop when its phase's stop condition is reached and must not continue into the next phase on its own; moving to the next phase is a separate session started by the user.
- **FR-17** The orchestrator must suggest the next phase for a ticket (default order: investigation → planning → implementation → automated testing → e2e testing → code review), and the user must be able to start any phase in any order, any number of times.
- **FR-18** Before launch, the user must see the resolved setup (agents, sub-agents, skills, MCP servers) and may adjust it for that session.

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
- **FR-48** The session transcript on disk is the source of truth for usage. Usage must be reconciled from it when a session ends and when the dashboard next opens the session, so turns continued in a terminal (FR-13) are counted. Live streaming only provides a running total until then.
- **FR-49** Token counts must be the main usage figure. Dollar cost is shown only as a secondary "API-equivalent" figure (see A-1).

# Non-Functional Requirements

## Scale & performance

- **NFR-1** The app must support **1–5 concurrent sessions** and a handful of workspaces on a single developer machine.
- **NFR-2** Session output must appear in the dashboard within ~1 s of being emitted by the runtime.

## Security

- **NFR-3** The dashboard must require sign-in via **Supabase Auth**.
- **NFR-4** Tracker, GitHub, inspection hook, and other integration credentials must never be written into worktrees, transcripts, test reports, or drafted-action payloads.

## Platforms

- **NFR-5** The app must run on the developer's machine (macOS first) and be deployable to a remote host; the dashboard is a web UI used from a desktop browser.
- **NFR-6** The app must work with any git repository regardless of language or framework; project-specific behavior comes only from project knowledge and agent/skill configuration.

## Data

- **NFR-7** Workspaces, sessions, project knowledge, phase setups, and drafted actions must be stored in **Supabase Postgres** (local Supabase or cloud); agent/skill files live in the app directory (FR-19).

## Out of scope for MVP

- Slack agents, per-agent Slack users, and Slack reply approvals.
- Bug investigator with prod-like data replication.
- AI coding runtimes other than Claude Code.
- Importing sessions not launched by the workspace.
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
- **A-5** The developer supplies GitHub and tracker credentials per workspace. *Open:* storage location for these secrets (Supabase vault, OS keychain, env file).
- **A-6** Built solo, part-time, with flexible MVP scope and no fixed deadline.
- **A-7** Phase artifacts are written to fixed, phase-configured paths in the worktree so the workspace can detect them (FR-22) and derive actions (FR-28a).
- **A-8** Claude Code sessions can be resumed headlessly with new input (FR-35), so a correction round continues the original session's context. *If wrong:* a correction round starts a fresh session that is given the previous transcript summary and the annotations.
- **A-9** Each plan produces one PR (open PR is drafted per plan, from the plan's branch). *If wrong:* a plan may ship as several PRs or several plans may share one.

- **A-10** Claude Code keeps writing per-message usage and model to its on-disk transcripts, with each sub-agent in its own file next to a small file naming the agent type. This layout is undocumented and may change. *If wrong:* fall back to the session's end-of-run totals, losing the per-sub-agent breakdown and the turns continued in a terminal.
- **A-11** Switching off the user-level source (FR-41) removes user-level `CLAUDE.md`, agents, skills, commands, plugins, settings and hooks. It does **not** remove auto memory or claude.ai connectors, which need their own switches (OQ-8).

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
