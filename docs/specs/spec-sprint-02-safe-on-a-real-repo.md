---
title: "Spec — Sprint 2: safe on a real repo"
summary: "Cut every session off from the host's logins, store phase setups per workspace, and carry a ticket from investigation to a reviewed implementation with follow-up messages, passed artifacts, and a next-phase suggestion."
---

# Spec: Sprint 2, safe on a real repo

Source: [Sprint 2 plan](../../sprints/sprint-02/) (S2-01 to S2-12, with S2-13 to S2-15 as stretch). Builds on the [Sprint 1 spec](../spec-sprint-01-walking-skeleton/).

Ticket sources (S2-05 to S2-07) already have their own spec, [Ticket sources and the built-in tracker](../spec-ticket-sources/). This spec doesn't repeat it. It says which part of it this sprint builds, and specifies everything else.

The enforcement mechanism in this spec is provisional until the S2-01 spike reports, in the same way the Sprint 1 runtime contract waited for S1-04.

## Problem Statement

As a developer, I can start a tracked Claude Code session from the dashboard, but I can't point it at a repo I care about. A session runs in auto mode with my own `git`, `gh`, and SSH logins within reach, and auto mode approved a `git push --force` in the S1-04 spike. The phase a session runs in is only a sentence in its brief, so nothing stops an investigation from changing code, and nothing tells me when it did. Every session also inherits whatever is in my `~/.claude`.

Working a ticket past its first session is also manual. A planning session can't see what the investigation found. A code review session starts from the default branch, so it can't see the implementation. To continue a finished or incomplete session I have to copy a command into a terminal, and I have to remember which phase comes next.

The browser runs that found most of Sprint 1's bugs were throwaway scripts, so nothing repeats them.

## Solution

Every session, in every phase, is cut off from the host's logins. It can commit locally and install dependencies, but it can't push, use `gh`, or open an SSH connection as the developer. If that can't be enforced on the host, the session doesn't run.

Each workspace stores a phase setup per phase: the instruction, the scope, the stop condition, and whether the developer's `~/.claude` is loaded, which is off by default. A session records the setup it ran with. When a read-only phase changes code, the session is flagged.

Before starting a session, the developer sees the repo it will run in, the phase setup, the branch it starts from, and the earlier artifacts it will be given. The dashboard suggests the next phase. A new session gets the latest result of the ticket's other phases, and a code review starts from the implementation's branch.

The developer can send a follow-up message to a finished session from the dashboard, which resumes it as a new round. The same action continues a session that ended without its required artifact.

Tickets come from ticket sources, and every workspace has a built-in tracker, as the ticket sources spec describes.

An opt-in browser run in the repo repeats the demo script against the real stack.

## User Stories

### Cut off from the host's logins

1. As the developer, I want a session to be unable to `git push`, so that nothing reaches a remote without me.
2. As the developer, I want a session to be unable to use my `gh` login, so that it can't comment, open pull requests, or read private data as me.
3. As the developer, I want a session to be unable to use my SSH keys or agent, so that it can't reach any host as me.
4. As the developer, I want a session to be unable to act through connectors on my Claude account, such as a GitHub connector, so that blocking `git` and `gh` isn't bypassed.
5. As the developer, I want this to hold in every phase and not be a setting, so that no phase setup can switch it off by mistake.
6. As the developer, I want a session to still commit to its own branch, so that an implementation's work is kept.
7. As the developer, I want a session to still install dependencies, so that it can build and run the code.
8. As the developer, I want a session to fail with a clear reason when its scope can't be enforced on this host, so that it never runs open without my knowing.
9. As the developer, I want the agent told in its brief that it can't push or reach GitHub, so that it doesn't waste turns trying.
10. As the developer, I want a blocked command not to fail or stall the session, so that the agent carries on and reports what it couldn't do.
11. As the developer, I want a test that proves a real session can't push or use `gh` through the host's logins, so that the claim rests on evidence.
12. As the developer, I want the README's warning about throwaway repos replaced once this holds, so that the docs match the app.
13. As the developer, I want a clear verdict from the scope enforcement spike, so that I know whether real repos are safe before the rest is built.

### Phase setups

14. As the developer, I want each workspace to have a phase setup for investigation, planning, implementation, and code review from the start, so that I can launch without configuring anything.
15. As the developer, I want existing workspaces to get the same default phase setups on upgrade, so that they keep working.
16. As the developer, I want a phase setup to state its scope, so that I can see what the phase may do.
17. As the developer, I want a phase setup to state its stop condition, so that I know which artifact ends the phase.
18. As the developer, I want to edit a phase's instruction, so that I can adapt what its sessions are told to my project.
19. As the developer, I want one workspace's phase setups to be separate from another's, so that projects don't affect each other.
20. As the developer, I want each session to record the setup it ran with, so that the history still shows it after I change the phase setup.
21. As the developer, I want a session to end once its phase's work is done and never start the next phase itself, so that I decide when to move on.

### Read-only phases

22. As the developer, I want a session flagged when an investigation, planning, or code review session changed code, so that I notice a phase that went beyond its scope.
23. As the developer, I want commits made by a read-only phase flagged as well as uncommitted changes, so that a commit doesn't hide the change.
24. As the developer, I want writing the required artifact and other files under `.slop/` not to count as a code change, so that normal sessions aren't flagged.
25. As the developer, I want the flag shown on the session and in the ticket's history, so that I see it without opening the worktree.
26. As the developer, I want a flagged session to keep its result and status, so that the flag adds information and loses none.

### User-level source

27. As the developer, I want sessions to stop loading my `~/.claude` by default, so that my personal agents, skills, hooks, and instructions don't shape tracked work.
28. As the developer, I want a switch per phase setup to load it again, so that I can opt in where I need it.
29. As the developer, I want the repo's own `.claude/` and `CLAUDE.md` still loaded, so that project conventions apply.
30. As the developer, I want Claude Code's sign-in to keep working with the user-level source off, so that turning it off doesn't break sessions.
31. As the developer, I want each session to record whether the user-level source was on, so that I can explain a difference between two runs.

### Before launch

32. As the developer, I want to see the repo a session will run in before I start it, so that it doesn't run in the wrong place.
33. As the developer, I want to change that repo before launch, so that I can work a ticket in any linked repo.
34. As the developer, I want to see the phase's instruction, scope, and required artifact before launch, so that I know what the session will be told and allowed.
35. As the developer, I want to see whether the user-level source is on before launch, so that there are no surprises in what gets loaded.
36. As the developer, I want to see which earlier artifacts the session will be given, so that I know what context it starts with.
37. As the developer, I want to see the branch the session will start from, so that I know which code it will see.
38. As the developer, I want the view to match what the launch then does, so that I can trust it.
39. As the developer, I want the view to be read-only apart from the repo and the phase, so that changing setups stays in one place.

### Next phase

40. As the developer, I want the dashboard to suggest the next phase for a ticket, so that I don't have to remember where it stands.
41. As the developer, I want the suggestion to follow investigation, planning, implementation, then code review, so that it matches the default order.
42. As the developer, I want the testing phases skipped in the suggestion until they can be launched, so that I'm never pointed at something I can't start.
43. As the developer, I want the suggested phase preselected in the launch controls, so that following it is one click.
44. As the developer, I want to pick any other phase anyway, so that the suggestion never limits me.
45. As the developer, I want no suggestion once code review is complete, so that a finished ticket isn't pushed further.
46. As the developer, I want the suggestion to update when a session ends, without a reload, so that it's current when I look.
47. As the developer, I want a phase to count as done only when a session in it produced its required artifact, so that an incomplete session doesn't move the ticket on.

### Earlier artifacts

48. As the developer, I want a planning session to be given the investigation's result, so that it builds on the findings.
49. As the developer, I want an implementation session to be given the plan, so that it implements what was planned.
50. As the developer, I want a code review session to be given the implementation report, so that it knows what was meant to change.
51. As the developer, I want an implementation session started after a review to be given the review report, so that it can address the review.
52. As the developer, I want only the latest complete result of each other phase passed in, so that the session isn't given stale or empty results.
53. As the developer, I want those files kept out of git, so that they never show in a diff or a commit.
54. As the developer, I want each session to record which artifacts it was given, so that the history shows what it knew.
55. As the developer, I want a code review session to start from the implementation's branch, so that it reviews the actual changes.
56. As the developer, I want the code review told which branch to compare against, so that it reviews only this ticket's changes.

### Follow-up messages

57. As the developer, I want to send a follow-up message to a finished session from the dashboard, so that I can continue it without a terminal.
58. As the developer, I want the follow-up to resume the same session with its context kept, so that I don't have to explain everything again.
59. As the developer, I want the follow-up to run as a new round, so that each round's result is kept.
60. As the developer, I want an incomplete session to offer **Continue**, so that I can ask it to finish its required artifact.
61. As the developer, I want a follow-up to work after the session's worktree was removed, so that cleaning up doesn't end the session for good.
62. As the developer, I want a follow-up to run with the setup the session started with, so that a later round can't gain scope.
63. As the developer, I want the session's status to update live during a follow-up, so that I know when the new result is ready.
64. As the developer, I want a follow-up rejected while the session is running, so that two rounds never overlap.
65. As the developer, I want a clear message when a session can't be resumed because Claude Code never started it, so that I start a new session instead.
66. As the developer, I want the previous round's result to stay readable while a new round runs, so that I can refer to it.
67. As the developer, I want a round that didn't change the artifact marked incomplete, so that an old file isn't taken for a new result.
68. As the developer, I want to stop a follow-up round like any running session, so that I can end one that has gone wrong.
69. As the developer, I want a round interrupted by a server restart marked failed, so that it doesn't appear to run forever.
70. As the developer, I want a read-only session checked for code changes after every round, so that a follow-up can't change code unnoticed.

### Tickets and sources

71. As the developer, I want to create a ticket in the built-in tracker and start a session on it with no setup, so that I can work without connecting a tracker.
72. As the developer, I want to connect a repo's GitHub Issues as a ticket source and see its tickets beside the built-in ones, so that all my work is in one list.
73. As the developer, I want my existing workspaces, tickets, and sessions to keep working after the upgrade, so that I lose nothing.
74. As the developer, I want a session's history to show its ticket's source and its repo, so that the record makes sense once tickets and repos are separate.

### Confidence

75. As the developer, I want the browser run kept in the repo, so that the checks that found Sprint 1's bugs can be repeated.
76. As the developer, I want the browser run to be opt-in, so that the normal test run stays fast.
77. As the developer, I want the browser run to need no Claude Code session and no GitHub access, so that it's repeatable and costs no quota.
78. As the developer, I want the browser run to sign in through real Supabase Auth, so that a broken sign-in can't pass unnoticed again.
79. As the developer, I want no credential to appear in a worktree, session record, transcript copy, or log line, so that NFR-4 still holds with the new features.

### Stretch

80. As the developer, I want to keep question and answer pairs about my project in the dashboard and have every session able to read them, so that I stop repeating project facts.
81. As the developer, I want per-session token totals in the history, so that I can see what each session consumed.
82. As the developer, I want dependencies installed in a new worktree, so that a session can run the code straight away.

## Implementation Decisions

### Modules

- **phase-setups (new):** stores each workspace's phase setups and creates the defaults. It replaces the hard-coded phase definitions.
- **sessions (changed):** takes the phase setup into the launch, records it on the session, passes earlier artifacts in, resumes sessions for follow-up messages, checks read-only phases for code changes, and builds the launch preview and the next-phase suggestion.
- **Claude Code runtime (changed):** applies the baseline scope and the user-level source switch to every start and resume.
- **worktrees (changed):** reports the commit a worktree started from, tells whether code changed since then, and restores a removed worktree from its branch. It still knows nothing about sessions.
- **tickets (changed):** as the ticket sources spec describes, limited to the part listed under [Ticket sources this sprint](#ticket-sources-this-sprint).
- **web app (changed):** launch controls with the pre-launch view and the suggested phase, a follow-up form on the session page, the scope flag, and a phase setups screen.
- **e2e (new):** the opt-in browser run and the scripted runtime it uses.

### Scope enforcement spike (S2-01)

S2-01 runs first and ends in a note under `docs/spikes/` with a **confirmed / disproved / partly** verdict. It has to answer:

- What stops `git push`, `gh`, and outbound SSH from using the host's logins inside a session, when the agent is actively trying to get around it. Auto mode's classifier doesn't count as an answer.
- Whether local commits still work. A worktree's commits write into the linked clone's git folder, outside the worktree, so a rule that limits writes to the worktree would break them.
- Whether dependency installs still work with the same settings, including packages fetched from a registry.
- Whether a session can still reach connectors on the developer's Claude account. A-11 says switching off the user-level source doesn't remove them, and a GitHub connector has push and pull request tools that never go through `git` or `gh`.
- Whether a repo's own settings, hooks, or `.mcp.json` can loosen what the runtime applied.
- How the runtime can tell that enforcement isn't available on the host, and whether that can be reported by `checkReady` before a worktree is created.
- Whether enforcement holds on resume as well as on start.
- How a test can plant fake logins and a recording remote without touching the developer's real ones.
- Whether writes can cheaply be limited to `.slop/` for read-only phases.

Candidates to test, in the order they look most likely to hold:

1. The Agent SDK's sandbox, with its network and credential restrictions. The pinned SDK exposes them, and it's the only candidate that restricts the process itself.
2. Environment changes, such as pointing `gh` and git's credential and SSH settings at nothing. An agent can undo these from its shell, so they can only add to another layer.
3. A pre-tool hook that denies matching commands. It's readable and gives the agent a clear denial, but a command can be disguised, so it's also only a second layer.

If the verdict is *disproved*, real repos stay off limits and the sprint is re-planned, as the sprint plan says. The rest of this spec doesn't depend on which candidate wins.

### Baseline scope (S2-03)

- The baseline scope applies to every session in every phase: no pushing, no `gh`, no outbound SSH, and no connectors from the developer's Claude account. It isn't stored and can't be changed, because FR-27 forbids outward-facing actions in all phases.
- The runtime applies it on `start` and on `resume`. Only the Claude Code runtime knows how.
- Enforcement fails closed. If the runtime can't apply the baseline scope, the session ends as `failed` with a reason that says so. If the spike shows this can be known in advance, `checkReady` reports it instead and no worktree is created.
- A blocked command is a denial like any other: the agent is told, carries on, and the session doesn't fail.
- The brief gains one fixed sentence saying the session can't push or reach GitHub, and that anything needing to happen outside the repo belongs in its report.
- The copyable terminal resume command isn't covered. A session continued in a terminal runs with the developer's own permissions and setup, with the developer present.
- When this holds, the README's warning is replaced with a description of what sessions can and can't do.

### Phase setups v0 (S2-02)

- A new `phase_setup` table has one row per workspace and launchable phase. Each row holds the instruction, the scope, the stop condition, and the user-level source switch.
- The four rows are created with the workspace. A migration adds them to existing workspaces, using the instructions and artifact paths that are hard-coded today.
- The scope in v0 is one field, `mayChangeCode`: true for implementation, false for the other three.
- The stop condition in v0 is the required artifact path (FR-22), unchanged from Sprint 1.
- The developer can edit the instruction and the user-level source switch. The scope and the stop condition are stored and shown, but read-only for now, because loosening them safely needs the manager's validation.
- The testing phases have no phase setup and still can't be launched.
- Agents, sub-agents, skills, and MCP servers from FR-14 aren't part of v0.
- A session stores a snapshot of the setup it started with. Changing a phase setup later affects only new sessions.
- The required artifact path is read from the session's snapshot, and still never from the client.
- Existing sessions are backfilled with the old hard-coded values, and with the user-level source recorded as on, since they did load it.
- A session still ends when the agent finishes its turn, and the workspace then checks the stop condition. Nothing starts the next phase (FR-16).

### Code changes by read-only phases (S2-03)

- A session records the commit its worktree started from.
- When a round of a session whose scope has `mayChangeCode: false` reaches a terminal status, the workspace checks the worktree for uncommitted changes and for commits made since that starting commit. If it finds either, the session gets the `code_changed` scope flag.
- Files under `.slop/` are already excluded from git, so they never count.
- The flag doesn't change `status` or `artifactStatus`. It's shown on the session page and in the ticket's history.
- Once set, the flag stays for later rounds.
- Sessions from before this sprint have no starting commit and are never flagged.
- If the spike finds a cheap way to block these writes, the runtime also applies it, and the flag stays as a second check.

### User-level source (S2-04)

- With the switch off, the runtime loads only the project and local setting sources, so nothing from `~/.claude` reaches the session. With it on, the user source is loaded as well.
- The default is off for every new and migrated phase setup (FR-41).
- The project source is always on, so the repo's `.claude/` and `CLAUDE.md` still load.
- Sign-in doesn't depend on the user source, and the opt-in smoke test confirms that a session still starts with it off.
- Auto memory and connectors on the developer's account aren't covered by this switch (A-11). The baseline scope handles the connectors.

### Ticket sources this sprint

The ticket sources spec governs S2-05 to S2-07. This sprint builds all of it except the following, which the sprint plan defers:

- **The Jira adapter.** Connecting a source with type `jira` is rejected as a validation error.
- **Stored per-source credentials.** There's no `SecretBox`, no `SLOP_SECRET_KEY`, no `Redactor.add`, and no `SECRETS_NOT_CONFIGURED`. Connecting or updating with a `token` is rejected as a validation error, and `hasCredential` is always false. GitHub Issues sources use the server's `GITHUB_TOKEN`, then anonymous access.
- **The disconnected tickets list.** Disconnecting a source is included, because FR-6g needs it to turn built-in ticket creation back on, and it blocks new sessions with `SOURCE_DISCONNECTED`. The endpoint and screen that list tickets on disconnected sources wait for FR-6h.

Two changes to that spec's contracts:

- Its `repo-preselection` endpoint is replaced by the launch preview below, which returns the same preselected repo along with the rest of what a launch would use.
- Its validation errors use status 422, as the existing API does, not 400.

Its open decisions are still unconfirmed, and the sprint plan asks for them to be confirmed before S2-05 starts.

### Session launch

`POST` on a ticket's sessions now does the following, in order:

1. Check that the server isn't shutting down, the workspace and source exist, the source is connected, the workspace has a linked repo, the phase is launchable, and the runtime is ready.
2. Resolve the repo using the order in the ticket sources spec, and read the ticket.
3. Load the phase setup, choose the starting point, and collect the earlier artifacts.
4. Generate the session ID and create the worktree. Write the earlier artifacts into it.
5. Insert the session as `starting`, with its setup snapshot, starting point, and the artifacts it was given.
6. Start the runtime without waiting for it, and return 201.

A failure in step 4 leaves no session row, as before.

The brief is the ticket's title and body, the phase setup's instruction, the baseline scope sentence, and a list of the earlier artifacts by path and phase. For a code review that starts from an implementation branch, it also names the ref to compare against.

### Earlier artifacts (S2-09)

- A new session is given the latest stored artifact of each other launchable phase, taken from the same ticket's sessions whose result is `complete`. "Same ticket" means the same source and key, in any repo.
- The session's own phase is left out. Starting a phase again is a fresh attempt, and continuing an attempt is what follow-up messages are for.
- Each one is written to `.slop/context/<phase>.md` in the new worktree. `/.slop/` is already excluded from git, so they never appear in a diff or a commit.
- They're files and not part of the brief, so the stored brief stays short and the agent reads them when it needs them.
- The session records which artifacts it was given, by source session, round, and phase.
- Code isn't passed between sessions, except through the starting point below.

### Starting point

- A session's worktree starts from `origin/<defaultBranch>`, as before, with one exception.
- A code review session starts from the branch of the ticket's most recent implementation session in the same repo, if there is one. Without this, a review would see none of the code it's meant to review.
- That session's branch is used whether or not its worktree still exists, because removal keeps the branch.
- The session records the ref it started from and the commit that ref pointed to.
- Only committed work is on the branch. The implementation instruction already tells the agent to commit.
- The review still gets its own worktree and its own `slop/` branch.

### Follow-up messages (S2-08)

This follows the stretch contract in the Sprint 1 spec, with these details settled:

- A follow-up is accepted when the session is `ended`, `failed`, or `stopped`, and Claude Code has reported a session ID for it. Without that ID there's nothing to resume, and the request fails with `SESSION_NOT_RESUMABLE`.
- Accepting one increments the session's round, sets the status to `running`, and clears `statusReason`, `endedAt`, and `artifactStatus`. The change from a terminal status to `running` is made in one database statement, so two requests at once can't both win, and the loser gets `SESSION_ACTIVE`.
- If the worktree was removed, it's first restored from the session's branch at the same path, the latest stored artifact is written back to its path, and the earlier artifacts the session was given are written back too. `worktreeRemovedAt` becomes null again.
- The runtime resumes with the setup snapshot stored on the session, never the phase setup as it is now.
- When the round ends, the artifact is checked again. It counts for this round only if its content differs from the previous round's stored copy, and it's then stored under the new round number. Content is compared rather than file times, because a restored file would look new.
- The artifact endpoint keeps returning the latest stored copy, so the previous result stays readable while a round runs and after a round that produced nothing new.
- The follow-up doesn't read the ticket, so it works when the ticket's source is disconnected or unreachable.
- A session with `artifactStatus: incomplete` shows **Continue**, which opens the same form prefilled with a request to write the required artifact (FR-23).
- Stop, shutdown, and the restart recovery treat a follow-up round like any running session.

### Launch preview and next-phase suggestion (S2-10, S2-11)

- One read endpoint returns what a launch on a ticket would use: the suggested phase, the phase being previewed, the resolved repo, the starting point, the setup snapshot, and the earlier artifacts.
- The launch and the preview run the same resolution code, so they can't disagree.
- With no `phase` in the query, the preview uses the suggested phase, or investigation when there's no suggestion.
- With no repo resolved, the preview returns null for the repo and the starting point, and the web app asks the developer to choose.
- The suggestion is a rule over the ticket's sessions. A phase is done when one of its sessions has `artifactStatus: complete`. The suggestion is the next launchable phase after the furthest done phase in the default order, investigation when nothing is done, and nothing once code review is done.
- The testing phases are skipped, so implementation is followed by code review until they can be launched.
- The suggestion doesn't wait on anything. A running session doesn't hide it, and the developer can start any phase at any time (FR-17).
- It isn't a drafted action yet. It preselects the phase in the launch controls and shows one line saying why.
- The web app refetches the preview when a `session_updated` frame arrives for the ticket.
- The pre-launch view is read-only apart from the phase and the repo. It doesn't list ambient items or context cost (FR-39, FR-40).

### Data

- New table `phase_setup`, keyed by workspace and phase, with row level security on and no policies, like the existing tables.
- `session` gains the round, the setup snapshot, the starting ref and commit, the artifacts it was given, and its scope flags.
- The ticket sources spec's migration runs in the same release. Both must leave existing sessions readable.
- Nothing new holds a credential.

### Browser run (S2-12)

- The run uses Playwright and lives in its own workspace package. It's started by its own npm script and isn't part of `npm test`.
- It drives the real web app, the real Nest server, real Supabase Auth and Postgres, and real git on temporary clones.
- Claude Code is replaced by a scripted runtime: a `SessionRuntime` that reports a start, writes the phase's required artifact, and ends. Markers in a ticket's body make it fail, end without an artifact, change code, or keep running, so the run can reach every state from the browser.
- The scripted runtime lives with the server's test support and is wired in by a test-only server entry point. The production build can't select it.
- GitHub is replaced by a local stub, through the existing `GITHUB_API_URL` setting. The built-in tracker runs for real.
- The run creates its own user through Supabase's admin API and signs in through the real sign-in page.
- It covers the demo script's steps 1 to 4 and 6. Step 5, the block on `gh` and `git push`, belongs to the smoke test, because only a real session can prove it.

### Stretch

Each stretch item starts only when every must item is done, and each needs its own short spec first:

- **S2-13, project knowledge MCP.** It adds an MCP server to every session, so it must be checked against the baseline scope.
- **S2-14, usage v0.** The Sprint 1 spec's stretch contract for `tokenUsage` still applies.
- **S2-15, dependency install in a new worktree.** No requirement covers it yet, so one is added first.

## Contracts

These types live in the shared package. The project documents no docstring convention, so this spec uses the same one as the Sprint 1 spec.

### Types

```ts
/** What a phase may do beyond the baseline scope, which applies to every session and isn't stored. */
interface PhaseScope {
  /** False for read-only phases; a session that changes code anyway gets the `code_changed` flag. */
  mayChangeCode: boolean;
}

interface StopCondition {
  /** Relative to the worktree root and always under `.slop/`, e.g. `.slop/plan.md`. */
  requiredArtifactPath: string;
}

interface PhaseSetup {
  workspaceId: string;
  phase: LaunchablePhase;
  /** The sentence added to the brief of every session in this phase. */
  instruction: string;
  scope: PhaseScope;
  stopCondition: StopCondition;
  /** Whether sessions load `~/.claude`; off by default (FR-41). */
  userLevelSource: boolean;
  updatedAt: string;
}

interface UpdatePhaseSetupBody {
  instruction?: string;
  userLevelSource?: boolean;
}

/** The phase setup as it was when a session started. */
interface SessionSetup {
  instruction: string;
  scope: PhaseScope;
  stopCondition: StopCondition;
  userLevelSource: boolean;
}

type ScopeFlag = 'code_changed';

/** An earlier phase's artifact given to a session. */
interface InputArtifact {
  /** The session that produced it. */
  sessionId: string;
  round: number;
  phase: LaunchablePhase;
  /** Where it's written in the new worktree, e.g. `.slop/context/investigation.md`. */
  path: string;
}

interface NextPhaseSuggestion {
  /** Null once code review is done. */
  phase: LaunchablePhase | null;
  /** One line for the dashboard, e.g. "Investigation is complete." */
  reason: string;
}

interface LaunchPreview {
  suggestion: NextPhaseSuggestion;
  /** The phase previewed: the one asked for, else the suggested one, else investigation. */
  phase: LaunchablePhase;
  /** Null when the developer must choose a repo. */
  linkedRepoId: string | null;
  /** Null when no repo is resolved. E.g. `origin/main`, or an implementation session's branch. */
  baseRef: string | null;
  /** For a code review starting from an implementation branch, the ref to compare against; else null. */
  compareRef: string | null;
  setup: SessionSetup;
  inputArtifacts: InputArtifact[];
}

interface SendMessageBody {
  message: string;
}
```

**(changed)** `ApiErrorCode`: adds `SESSION_NOT_RESUMABLE`. The codes from the ticket sources spec are also added, except `SECRETS_NOT_CONFIGURED`. Existing codes are unchanged and aren't repeated here.

**(changed)** `Session`: adds `ticketSourceId` and `ticketTitle` from the ticket sources spec, and `round`, `setup`, `baseRef`, `baseCommit`, `inputArtifacts`, and `scopeFlags`.

```ts
interface Session {
  id: string;
  workspaceId: string;
  linkedRepoId: string;
  ticketSourceId: string;
  ticketKey: string;
  /** The ticket's title when the session started. */
  ticketTitle: string;
  phase: Phase;
  /** Starts at 1; each accepted follow-up message adds one. */
  round: number;
  status: SessionStatus;
  /** Why the session failed; null otherwise. */
  statusReason: string | null;
  brief: string;
  /** The phase setup this session started with. */
  setup: SessionSetup;
  worktreePath: string;
  branch: string;
  /** The ref the worktree started from. */
  baseRef: string;
  /** The commit `baseRef` pointed to; null for sessions from before this field existed. */
  baseCommit: string | null;
  inputArtifacts: InputArtifact[];
  /** Empty unless the session went beyond its scope. */
  scopeFlags: ScopeFlag[];
  /** Null again once a follow-up restores the worktree. */
  worktreeRemovedAt: string | null;
  /** Set once the runtime reports it. */
  runtimeSessionId: string | null;
  transcriptPath: string | null;
  /** Null while the session is active, once its worktree is removed, or with no runtime session ID. */
  resumeCommand: string | null;
  /** Null while a round is running; otherwise whether the latest round produced the required artifact. */
  artifactStatus: ArtifactStatus | null;
  startedAt: string;
  /** Null while a round is running. */
  endedAt: string | null;
}
```

**(changed)** `RuntimeSetup`: adds `scope` and `userLevelSource`. The baseline scope has no field, because the runtime always applies it.

```ts
interface RuntimeSetup {
  permissionMode: 'auto';
  scope: PhaseScope;
  userLevelSource: boolean;
}
```

**(changed)** `WorktreeInfo`: adds `baseCommit`.

```ts
interface WorktreeInfo {
  path: string;
  branch: string;
  /** The commit the worktree started from. */
  baseCommit: string;
}
```

### Endpoints

Every endpoint needs a Supabase JWT in the `Authorization` header and returns `401: UNAUTHENTICATED` without a valid one. Every error body is an `ApiError`. `404: NOT_FOUND` also covers a resource that belongs to another workspace.

```
GET /workspaces/:workspaceId/phase-setups
Responses:
  200: PhaseSetup[], one per launchable phase, in the default order
  404: NOT_FOUND, when the workspace does not exist
```

```
PATCH /workspaces/:workspaceId/phase-setups/:phase
Path params: workspaceId, phase (a launchable phase)
Body: UpdatePhaseSetupBody
Responses:
  200: PhaseSetup
  404: NOT_FOUND, when the workspace does not exist or the phase is not launchable
  422: VALIDATION_FAILED, when the instruction is blank, or the body sets a field other than instruction and userLevelSource
```

```
GET /workspaces/:workspaceId/sources/:sourceId/tickets/:ticketKey/launch-preview
Path params: ticketKey is URL-encoded
Query: { phase?: LaunchablePhase; linkedRepoId?: string }
Responses:
  200: LaunchPreview
  404: NOT_FOUND, when the workspace, source, or linkedRepoId does not exist
  422: VALIDATION_FAILED, when the phase is unknown or is a testing phase
```

**(changed)** The route and body come from the ticket sources spec. The session it returns has the new fields, validation failures use 422, and a missing phase setup can't occur because every workspace has all four.

```
POST /workspaces/:workspaceId/sources/:sourceId/tickets/:ticketKey/sessions
Body: StartSessionBody
Responses:
  201: Session, with status `starting` and round 1
  404: NOT_FOUND, when the workspace, source, ticket, or linkedRepoId does not exist
  409: NO_LINKED_REPO, when the workspace has no linked repo
  409: REPO_CHOICE_REQUIRED, when no linkedRepoId is given and none can be preselected
  409: SOURCE_DISCONNECTED, when the source is disconnected
  422: VALIDATION_FAILED, when the phase is unknown or is a testing phase
  500: WORKTREE_CREATE_FAILED, when git cannot create the worktree; no session is recorded
  502: TRACKER_AUTH_FAILED, when the tracker rejects the credential
  502: TRACKER_UNAVAILABLE, when the tracker cannot be reached or returns a server error
  503: RUNTIME_NOT_READY, when the runtime is not ready or the server is shutting down; no session or worktree is created
```

```
POST /workspaces/:workspaceId/sessions/:sessionId/messages
Path params: workspaceId, sessionId
Body: SendMessageBody
Responses:
  202: Session, with status `running` and the round increased by one
  404: NOT_FOUND, when the session does not exist in this workspace
  409: SESSION_ACTIVE, when the session is `starting` or `running`
  409: SESSION_NOT_RESUMABLE, when the runtime never reported a session ID for it
  422: VALIDATION_FAILED, when the message is blank
  500: WORKTREE_CREATE_FAILED, when a removed worktree cannot be restored from its branch; the session is left as it was
  503: RUNTIME_NOT_READY, when the runtime is not ready or the server is shutting down
```

### Functions & Methods

`SessionRuntime` keeps its four methods. `start` and `resume` now receive the changed `RuntimeSetup` and must apply the baseline scope before the agent can act.

```ts
abstract class SessionRuntime {
  /**
   * @params input: the brief, the worktree to run in, and the runtime setup
   * @return a handle for the new session's events and for stopping it
   * Starts a new headless session under the baseline scope and the given setup. If the scope can't be enforced, the events end with outcome `error` and a reason saying so.
   */
  abstract start(input: RuntimeStartInput): RuntimeHandle;

  /**
   * @params input: the session to continue, the new message, its worktree, and the setup it started with
   * @return a handle for the resumed session's events and for stopping it
   * Continues an existing session with its context kept, under the same scope rules as `start`.
   */
  abstract resume(input: RuntimeResumeInput): RuntimeHandle;
}
```

```ts
class PhaseSetupsService {
  /**
   * @params workspaceId: the workspace
   * @return its phase setups, one per launchable phase, in the default order
   * Lists a workspace's phase setups.
   */
  list(workspaceId: string): Promise<PhaseSetup[]>;

  /**
   * @params workspaceId: the workspace; phase: a launchable phase
   * @return that phase's setup, or throws NOT_FOUND
   * Reads one phase setup, for a launch or a preview.
   */
  get(workspaceId: string, phase: LaunchablePhase): Promise<PhaseSetup>;

  /**
   * @params workspaceId: the workspace; phase: a launchable phase; body: the instruction and the user-level source switch
   * @return the updated setup, or throws an ApiException listed under the update endpoint
   * Changes the editable fields. Scope and stop condition can't be changed in v0.
   */
  update(workspaceId: string, phase: LaunchablePhase, body: UpdatePhaseSetupBody): Promise<PhaseSetup>;

  /**
   * @params workspaceId: a workspace that was just created
   * @return nothing
   * Creates the four default phase setups.
   */
  createDefaults(workspaceId: string): Promise<void>;
}
```

**(changed)** `SessionsService`: `start` records the setup, starting point, and earlier artifacts. `preselectRepo` from the ticket sources spec is replaced by `launchPreview`. `sendMessage` is new.

```ts
class SessionsService {
  /**
   * @params workspaceId: the workspace; sourceId: the ticket's source; ticketKey: the ticket; body: the phase and optional repo
   * @return the session, or throws an ApiException listed under the start endpoint
   * Resolves the repo, phase setup, starting point, and earlier artifacts, creates the worktree, and starts the runtime without waiting for it.
   */
  start(workspaceId: string, sourceId: string, ticketKey: string, body: StartSessionBody): Promise<Session>;

  /**
   * @params workspaceId: the workspace; sourceId: the ticket's source; ticketKey: the ticket; phase: the phase to preview, if chosen; linkedRepoId: the repo to preview, if chosen
   * @return what a launch would use, with a null repo if the developer must choose
   * Applies the same resolution as `start` without creating anything.
   */
  launchPreview(
    workspaceId: string,
    sourceId: string,
    ticketKey: string,
    phase?: LaunchablePhase,
    linkedRepoId?: string,
  ): Promise<LaunchPreview>;

  /**
   * @params workspaceId: the workspace; sessionId: a session that has ended; body: the follow-up message
   * @return the session as `running` in its next round, or throws an ApiException listed under the messages endpoint
   * Restores the worktree if it was removed, then resumes the session with its stored setup, without waiting for it.
   */
  sendMessage(workspaceId: string, sessionId: string, body: SendMessageBody): Promise<Session>;
}
```

```ts
/**
 * @params sessions: all of one ticket's sessions
 * @return the phase to suggest and why, with a null phase once code review is done
 * Applies the default order, skipping phases that can't be launched. Pure: reads nothing else.
 */
function suggestNextPhase(sessions: Session[]): NextPhaseSuggestion;
```

**(changed)** `WorktreeManager`: `create` also returns the starting commit, and `restore` and `hasCodeChanges` are new. `remove` is unchanged.

```ts
abstract class WorktreeManager {
  /**
   * @params input: the clone, base ref, and the IDs that name the worktree and its branch
   * @return the path, branch, and starting commit of the new worktree, or throws WorktreeCreateError if git fails
   * Creates a worktree on a new `slop/<ticketSlug>/<shortSessionId>` branch, with `/.slop/` excluded from git.
   */
  create(input: CreateWorktreeInput): Promise<WorktreeInfo>;

  /**
   * @params repoPath: root of the linked clone; worktreePath: where the worktree was; branch: the branch it was on
   * @return nothing, or throws WorktreeCreateError if the branch is gone or git fails
   * Recreates a removed worktree at the same path on its existing branch. Does nothing if it is already there.
   */
  restore(repoPath: string, worktreePath: string, branch: string): Promise<void>;

  /**
   * @params worktreePath: the worktree to check; baseCommit: the commit it started from
   * @return true if it has uncommitted changes or commits since `baseCommit`, ignoring `/.slop/`
   * Tells whether code changed, for flagging read-only phases.
   */
  hasCodeChanges(worktreePath: string, baseCommit: string): Promise<boolean>;
}
```

## Testing Decisions

**A good test** checks behavior a caller can see through a public interface. It doesn't assert on private methods, internal calls, or table shapes the API doesn't expose, so it survives refactoring.

**Seams** (confirmed with the developer) are the existing ones, plus the browser run that S2-12 adds.

### Main seam: HTTP API

Tests run against the real Nest app, a real local Supabase Postgres, and real JWT checks, with real git on temporary clones. `SessionRuntime` and connected trackers are faked, and the built-in tracker runs for real. They extend the existing `session-launch`, `session-lifecycle`, and `session-stream` suites and their `test-app` and `session-harness` support.

These tests cover:

- **Phase setups:** a new workspace has four with the defaults, and the user-level source is off. Editing the instruction changes the next session's brief and leaves earlier sessions' recorded setup alone. Scope and stop condition can't be edited. One workspace's edits don't show in another.
- **Recorded setup:** a session returns the setup it started with, and its artifact is found at the path in that setup.
- **Code change flag:** a read-only session is flagged for an uncommitted change and for a commit, and isn't flagged for files under `.slop/`. An implementation session is never flagged. The flag leaves `status` and `artifactStatus` alone.
- **Earlier artifacts:** a planning session's worktree holds the investigation's latest complete result, and the session lists it. An incomplete result, the session's own phase, and another ticket's results are left out. The files don't show in `git status`.
- **Starting point:** a code review's worktree contains the commits of the latest implementation session and records that branch as its base. Without an implementation session, and for every other phase, the base is the default branch.
- **Follow-up:** the round increases, the fake runtime's `resume` is called, and status changes appear on the stream. A new artifact is stored under the new round, and an unchanged one leaves the round `incomplete` with the earlier copy still readable. A removed worktree is restored with its artifact and context files. Covers the active, not-resumable, blank message, not-ready, and shutting-down cases, two requests at once, stop during a round, and restart recovery.
- **Launch preview:** it agrees with what a launch then records, for the repo, starting point, setup, and earlier artifacts. Covers an explicit phase and repo, no resolvable repo, and a testing phase.
- **Next phase:** the suggestion after each phase completes, after a phase is skipped, with only incomplete sessions, and once code review is done.
- **Migration:** a database at the Sprint 1 schema, with sessions, upgrades so that every workspace has phase setups, every session has a recorded setup and source, and all of them still read through the API.
- **Ticket sources:** as the ticket sources spec lists, without its Jira and stored-credential cases, and with `jira` and `token` rejected.
- **NFR-4:** the canary GitHub token doesn't appear in a session's recorded setup, brief, context files, status reason, or captured logs.

`suggestNextPhase` is pure, so its rule also gets a small table-driven test of its own.

### Contract seams

- **`SessionRuntime`:** the shared contract suite still runs against the fake and the Claude Code runtime's mapping. The existing `session-runtime` suite, which runs the Claude Code runtime over a stubbed SDK, adds that the user-level source is left out by default and loaded when the switch is on, and that `resume` gets the same scope handling as `start`.
- **Opt-in smoke test:** the proof the sprint's Definition of Done asks for lives here, because only a real session can show it. On a throwaway clone with planted logins and a recording remote, a real session told to push, use `gh`, and open an SSH connection reaches nothing: the remote's refs are unchanged and nothing received the planted credentials. The same session can commit locally and install a dependency. Another case confirms that a session starts with the user-level source off and doesn't see a planted user-level instruction. The spike decides how the logins are planted.
- **`WorktreeManager`:** real git on temporary repos, following the existing suite. Covers the starting commit, `hasCodeChanges` for uncommitted changes, commits, and `.slop/` files, and `restore` for a removed worktree, one that's still there, and a deleted branch.
- **`TrackerAdapter`:** as the ticket sources spec describes, without Jira.

### Browser run

The opt-in Playwright run, described under [Browser run](#browser-run-s2-12), is the end-to-end check. It passes when the demo script's steps 1 to 4 and 6 pass against the scripted runtime. It also covers what only a browser shows: the suggested phase preselected, the pre-launch view matching the started session, the follow-up form and **Continue**, the scope flag, and sign-in through the real page.

### Web app

Light Vitest tests for logic worth protecting, following `apps/web/test`: how a session's round, flag, and artifact status are described, and the preview being refetched on a session update.

### Done means

Lint, typecheck, and tests pass, the opt-in browser run passes, the smoke test's scope cases pass, and the spike note ends with a verdict.

## Out of Scope

From the sprint plan:

- The Jira adapter and stored per-source credentials. A-5 stays open.
- The test environment (FR-64 to FR-67) and the testing phases.
- Plans, and with them a worktree shared between sessions.
- Drafted actions and approvals, including the next-phase suggestion as a drafted action.
- The code editor and annotations.
- Inspection hooks.
- The agents and skills manager, and with it agents, sub-agents, skills, and MCP servers in a phase setup.
- The full ambient setup view (FR-39, FR-40, FR-42, FR-43).
- Remote-host deployment.

Also out for this sprint:

- Editing a phase setup's scope or stop condition.
- Adjusting the setup for one session in the pre-launch view (the rest of FR-18).
- Blocking a read-only phase's code changes, unless the spike finds it's cheap. They're flagged.
- Checking for writes outside the worktree after a session, beyond what the baseline scope prevents.
- Enforcing scope on a session continued in a terminal.
- Switches for auto memory and connectors (OQ-8). Connectors are blocked for every session.
- Reading an earlier round's artifact. Each round's copy is stored, and the API returns the latest.
- Sending annotations with a follow-up (FR-35). A follow-up is free text.
- A follow-up to a running session, and answering permission prompts.
- Passing code between sessions other than a code review's starting point.
- The list of tickets on disconnected sources (FR-6h).
- Fetching the remote before creating a worktree.
- Real Claude Code sessions or real GitHub in the browser run.
- Linux. Enforcement is built and tested on macOS first (NFR-5).

## Further Notes

- **Order of work.** S2-01 comes first and can change S2-03. The ticket sources work (S2-05 to S2-07) changes the session routes, so the launch preview and follow-up are easier to build after it.
- **Decided while writing this spec, not discussed.** Each is cheap to change now:

| Decision | Why |
|---|---|
| A code review starts from the latest implementation session's branch | Plans aren't built yet, and without this a review can't see the code it reviews. |
| Phase setups v0 allow editing only the instruction and the user-level source switch | The sprint plan says adjusting setups waits for the manager, but S2-04's "off by default" needs a switch. |
| Scope v0 is the single field `mayChangeCode` | It's the only per-phase difference this sprint enforces or flags. |
| The baseline scope isn't configurable | FR-27 applies to every phase, and a setting would be a way to turn it off. |
| Connectors on the developer's Claude account are part of the baseline scope | A GitHub connector would bypass a block on `git` and `gh`. This was found while writing the spec and isn't in the sprint plan. |
| Earlier artifacts are written as files under `.slop/context/` | It keeps the brief short and the files out of git. |
| A session's own phase isn't passed in as an earlier artifact | A rerun is a fresh attempt. |
| One launch preview endpoint replaces `repo-preselection` | The preview and the launch then share one resolution. |
| Disconnecting a source is in, and the disconnected tickets list is out | FR-6g needs the first. FR-6h isn't in the sprint's references. |
| The browser run uses a scripted runtime wired in by a test-only entry point | It keeps test code out of the production build. |

- **A round that doesn't touch the artifact shows as incomplete.** This comes from the Sprint 1 contract. A follow-up such as "also commit your work" will end as `incomplete` even when it did what was asked. If that proves confusing in use, a follow-up round may need its own wording in the dashboard.
- **A code review sees only committed work.** If an implementation session left its changes uncommitted, the review starts from a branch without them. The pre-launch view shows the starting branch, but not whether it's missing uncommitted work.
- **The user-level source record is honest about the past.** Sessions from Sprint 1 are backfilled as having loaded `~/.claude`, because they did.
- **Worktrees may still start behind.** The base isn't fetched, as in Sprint 1.
- **Requirements to update once this holds:** FR-14 and FR-41 to note what v0 covers, A-11 and OQ-8 with what the spike finds about connectors and auto memory, and a new requirement for dependency installs before S2-15 starts.
- **The ticket sources spec is still uncommitted and has unconfirmed decisions.** If any of them change, the affected parts here are the launch route, the repo resolution in the preview, and the `Session` fields.
