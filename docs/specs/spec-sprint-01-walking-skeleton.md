---
title: "Spec — Sprint 1 walking skeleton"
summary: "Start a tracked Claude Code session for a GitHub ticket from the dashboard, in its own worktree, with live status, a readable markdown result, and session history."
---

# Spec: Sprint 1 walking skeleton

Source: [Sprint 1 plan](../sprints/sprint-01/) (S1-02 to S1-17). Stack: [ADR-0001](../adr/0001-tech-stack/).

## Problem Statement

As a developer working tickets with Claude Code, I set up each session by hand: I create a working copy, paste in the ticket, and start the tool. Once a session ends, nothing links it to its ticket, so its findings and its resume command are hard to find again.

Slop Control doesn't exist yet, only its docs. Two assumptions behind the MVP are also unproven: that a headless session can be resumed with new input (A-8), and that per-message usage can be read from transcripts on disk (A-10). If either is false, the design has to change, and that is cheapest to learn now.

## Solution

The developer signs in, creates a workspace, links a local clone of a GitHub repo, and opens a ticket from that repo's GitHub Issues. They pick a phase and click **Start session**.

The workspace creates a dedicated git worktree and starts Claude Code headless in it. The session's status updates in the browser within about a second, without polling. The agent's output isn't streamed, because the developer works from the result rather than watching the session.

When the session ends, the developer reads its markdown result in the dashboard. The session stays in the ticket's session history with its phase, status, times, worktree, and a copyable command to continue it in a terminal.

This is the thinnest path through the system: **workspace → repo → ticket → session → history**. Two time-boxed spikes settle A-8 and A-10 early enough to change the runtime design.

## User Stories

### Access

1. As the developer, I want to sign in before I can see the dashboard, so that nobody else can start sessions on my machine.
2. As the developer, I want public sign-up to be disabled, so that having a Supabase project URL doesn't give someone an account.
3. As the developer, I want every API request and status stream to be rejected without a valid token, so that the backend is protected as well as the UI.
4. As the developer, I want an expired sign-in to send me back to the sign-in page, so that I don't face a broken dashboard.

### Workspaces and repos

5. As the developer, I want the app to open on a workspace selector, so that I choose my project first.
6. As the developer, I want to create a workspace by name, so that each project has its own home.
7. As the developer, I want duplicate workspace names rejected, so that the selector stays unambiguous.
8. As the developer, I want sessions blocked until a workspace exists, so that no session is left without a home.
9. As the developer, I want to link a workspace to a local clone by path, so that sessions work on code I already have.
10. As the developer, I want a clear error if the path doesn't exist, isn't a git repo, or has no GitHub remote, so that I can correct it immediately.
11. As the developer, I want linking a path inside a clone to resolve to the clone's root, so that it doesn't matter which folder I pasted.
12. As the developer, I want linking the same clone twice rejected, so that the workspace has no duplicate repos.
13. As the developer, I want a workspace with no linked repo to direct me to link one, so that I know why I can't start a session yet.
14. As the developer, I want each workspace's repos and sessions isolated from other workspaces, so that projects don't mix.

### Tickets

15. As the developer, I want to list the tickets of a linked repo, so that I can pick one to work on.
16. As the developer, I want to search tickets by text, so that I can find one in a long list.
17. As the developer, I want to filter tickets by open or closed, so that finished work doesn't get in the way.
18. As the developer, I want long ticket lists paginated, so that large repos stay usable.
19. As the developer, I want pull requests left out of the ticket list, so that I only see tickets.
20. As the developer, I want to open a ticket and read its title, body, status, and tracker link, so that I have its context before starting a session.
21. As the developer, I want tickets read live from the tracker and never stored as rows, so that the tracker stays the source of truth.
22. As the developer, I want a clear message when GitHub rejects the token or can't be reached, so that I can tell a tracker problem from an app problem.

### Starting and watching a session

23. As the developer, I want to pick a phase and click **Start session** on a ticket, so that starting a session takes one action.
24. As the developer, I want the brief built from the ticket's title and body plus a fixed instruction for the phase, so that I don't paste anything.
25. As the developer, I want each session in its own worktree on its own `slop/<ticket>/<session>` branch, so that sessions can't overwrite each other or my checkout.
26. As the developer, I want to start several sessions on one ticket, so that I can run any phase any number of times.
27. As the developer, I want to run a few sessions at once, so that I can work several tickets in parallel.
28. As the developer, I want sessions to run headless in auto permission mode, so that they don't stop for per-step prompts. If Claude Code isn't installed or signed in, I want a clear error when I start a session, so that I know what to fix on the host.
29. As the developer, I want a session's status change in the browser within about a second, so that I know right away when its result is ready.
30. As the developer, I want the ticket's session list and the session view to update without a reload, so that I can leave either one open while I wait.
31. As the developer, I want a dropped connection to recover the current status on its own, so that the dashboard never shows a stale status.
32. As the developer, I want status updates pushed by the server rather than polled, so that the dashboard makes no needless requests.
33. As the developer, I want to stop a running session, so that I can end one that has gone wrong.

### History and continuing by hand

34. As the developer, I want each ticket to list its sessions with phase, status, start and end times, and worktree, so that I can see what work has happened on it.
35. As the developer, I want a session's failure reason recorded, so that I can see why it ended.
36. As the developer, I want a copyable `cd <worktree> && claude --resume <id>` command on a finished session, so that I can continue it in a terminal.
37. As the developer, I want sessions interrupted by a server restart to be marked failed, so that none appear to run forever.
38. As the developer, I want to remove a finished session's worktree, so that old copies don't fill my disk.
39. As the developer, I want a warning before removing a worktree with uncommitted code changes, so that I don't lose work by accident.
40. As the developer, I want the session's branch kept after its worktree is removed, so that its commits survive.
41. As the developer, I want the resume command hidden once the worktree is gone, so that the app never shows a command that can't work.

### Safety and project confidence

42. As the developer, I want my GitHub token kept out of the session's environment, worktrees, session records, and logs, so that an agent can't read or leak it.
43. As the developer, I want a clear verdict on headless resume, so that correction rounds are designed on facts.
44. As the developer, I want a clear verdict on transcript usage, so that token usage is designed on facts.
45. As the developer, I want one `npm run dev` that starts the server and web app, so that getting started is a single command.

### Results

46. As the developer, I want a finished session marked complete or incomplete by whether its required artifact exists, so that I can tell at a glance whether it produced its result.
47. As the developer, I want to read a session's markdown artifact in the dashboard, even after its worktree is removed, so that cleaning up worktrees never costs me a result.
48. As the developer, I want a session never to wait for input nobody can give, so that it doesn't look like it's running forever.

### Stretch

49. As the developer, I want to send a follow-up message to a finished session from the dashboard, so that I can continue it without a terminal.
50. As the developer, I want per-session token totals in the history, reconciled from the transcript, so that I can see what each session consumed.

## Implementation Decisions

### Modules

The repo follows ADR-0001: npm workspaces with a server app, a web app, and a shared package for DTOs.

- **auth**: Nest guard, applied globally, that verifies the Supabase JWT's signature, expiry, and audience.
- **workspaces**: workspaces and linked repos, including validation of local clones.
- **tickets**: the tracker adapter interface and the read-only GitHub Issues adapter.
- **worktrees**: creates and removes worktrees. Deep module with no knowledge of sessions or the database.
- **sessions**: the runtime interface, the Claude Code runtime, session records, the status stream, and required-artifact checks.
- **web**: sign-in, workspace selector, link-repo form, ticket list and detail, and a session view with live status and the rendered markdown artifact.

### Data

- Tables are `workspace`, `linked_repo`, `session`, and `session_artifact`, managed by checked-in Supabase CLI migrations. There is no `session_event` table, because the transcript on disk is the full record of a session.
- There is no ticket table (FR-4). A session stores an opaque `ticketKey`.
- The browser uses Supabase only for Auth. All data goes through the Nest API, and the server alone holds database credentials.
- Rows have no per-user ownership, because each deployment has one user (A-2).
- Every workspace-owned lookup is scoped by `workspaceId`. A resource from another workspace returns 404 (FR-3).
- The data-access library is still chosen in S1-03. Nothing outside the server's data layer depends on that choice.

### Auth

- Sign-up is disabled in Supabase config, and the one user is created out of band. This matters because a valid sign-in can start auto-mode sessions on the host.
- The web app sends the token in the `Authorization` header on all requests, including the status stream.
- The stream is read with `fetch`, not `EventSource`, because `EventSource` can't set headers and a token in the URL would end up in logs.
- The guard checks the token when a stream connects. The client reconnects with a fresh token.
- The server binds to `127.0.0.1` by default, since remote deployment isn't in this sprint.

### Tickets

- Linking a repo reads `origin` and resolves any SSH host alias with `ssh -G` before checking for GitHub, so a remote like `git@my-alias:owner/repo.git` counts when the alias points to `github.com`.
- A GitHub ticket's key is `owner/repo#number`, URL-encoded in routes.
- Each linked repo is one ticket source this sprint, so listing requires `linkedRepoId`. The Jira adapter can relax this in Sprint 2.
- Starting a session resolves its linked repo from the ticket key. A key that matches no linked repo returns 404.
- The adapter filters pull requests out of GitHub's issue results. A search query uses GitHub's search API, scoped to the repo and to issues.
- Pagination cursors are opaque to callers.
- The GitHub token comes from server env or config. Its permanent home stays open under A-5.

### Session launch

`POST` on a ticket's sessions does the following, in order:

1. Check that the workspace has a linked repo, validate the phase, check that the runtime is ready, and read the ticket from the tracker.
2. Generate the session ID and create the worktree. On failure, return an error and keep no session row.
3. Insert the session as `starting`.
4. Start the runtime without waiting for it, and return 201.

If the runtime isn't ready, the request fails with `RUNTIME_NOT_READY` before anything is created, and the web app shows its message on the ticket. If the runtime passes that check but then fails to start, or its sign-in stops working mid-session, the session becomes `failed` with a reason. Its worktree is kept for inspection and can be removed on request.

Further launch rules:

- The API and phase picker accept investigation, planning, implementation, and code review. The testing phases exist in the `Phase` type but are rejected, because they aren't in this sprint.
- The brief is the ticket's title and body plus one fixed sentence per phase. It is stored on the session, so the history shows what the agent was told.
- Each phase's fixed sentence tells the agent to write its result to that phase's required artifact (A-7):

| Phase | Required artifact |
|---|---|
| Investigation | `.slop/investigation.md` |
| Planning | `.slop/plan.md` |
| Implementation | `.slop/implementation-report.md` |
| Code review | `.slop/review-report.md` |

### Required artifact and result view

- The brief is the only thing that directs where an agent writes this sprint. No hook or sandbox enforces it, and nothing checks for other files the agent changed.
- When a session reaches a terminal status, the server checks for its phase's required artifact and sets `artifactStatus` to `complete` or `incomplete` (FR-22, FR-23). This is separate from `status`: a session can end normally and still be incomplete.
- Only a non-empty, valid UTF-8 regular file counts, and anything else is `incomplete`. A symlink doesn't count, so a session can't make the dashboard serve a file from outside its worktree.
- When the artifact exists, the server copies it into `session_artifact`, keyed by session and round, before publishing the final status. Worktrees are disposable, so everything reads the artifact from this table and never from the worktree.
- The path to copy from comes from the phase, never from the client.
- The web app renders the markdown read-only and doesn't render raw HTML from it, since agent output is untrusted.

### Session status

| Status | Meaning |
|---|---|
| `starting` | Row created; the runtime hasn't reported its session ID yet. |
| `running` | The runtime has reported its session ID. |
| `ended` | The runtime finished normally. |
| `failed` | The runtime errored, its stream closed early, or the server restarted. |
| `stopped` | The developer stopped it. |

- `ended` deliberately avoids the word "complete", which FR-22 and FR-23 reserve for whether the required artifact exists.
- If the event stream closes without `session_ended`, the session becomes `failed` with a reason.
- On boot, the server marks any `starting` or `running` session as `failed` with reason `server_restarted`. The server owns the child processes, so it assumes they did not survive. Re-attaching is out of scope.

### Runtime

- The runtime interface is neutral about the tool. Only the Claude Code runtime knows about the Agent SDK (FR-8).
- The app uses whatever Claude Code setup the host already has, and never manages Anthropic credentials (A-1). The readiness check runs on every launch and isn't cached, so fixing the host takes effect without a restart.
- The check runs `claude auth status --json` and reads only `loggedIn`. If it's `false`, as it is with exit code 1 when signed out, the message says to run `claude auth login`. If the command is missing, the message says to install Claude Code. Any other failure, such as output that can't be parsed, is also not ready, with a message saying the status couldn't be read. The output also includes the account's email and organization, so it's never stored or logged.
- The runtime reports lifecycle only, through `RuntimeEvent`. The agent's messages and tool calls aren't stored or forwarded, and the transcript remains the full record.
- A session must never wait for input, since nobody is watching it. `AskUserQuestion` is disabled and `permissionPrompts` is set to `'none'`, so a call that nothing approves is denied and the agent carries on. A denial doesn't fail the session.
- The runtime runs with `cwd` set to the worktree and in auto permission mode (FR-15).
- If auto mode isn't available, Claude Code silently starts the session in manual mode instead, where the artifact write itself could be denied. The runtime must detect this and end the session with outcome `error` and a reason saying so, rather than let it finish as a confusing `incomplete`.
- The child gets an allowlisted environment, enough for Claude Code to run with the host's existing setup (A-1) and nothing holding the workspace's credentials.
- `resume` takes `cwd` in addition to the sprint plan's `resume(id, msg)`, because a session is tied to the directory it ran in. This is subject to the S1-04 result.

### Status stream

- There is no polling. One SSE connection per workspace carries every session's status changes, so the ticket view and session view share it.
- Each change is saved first and published second, so anything a client sees is durable. Each `session_updated` frame carries the full `Session`, which the web app writes straight into its TanStack Query cache.
- Status is current state rather than a log, so nothing is replayed. On every connect or reconnect, the client subscribes first and then refetches its session queries, so a change made in between can't be missed.
- The server sends a heartbeat comment every 30 seconds, so a dead connection is noticed and the client reconnects.
- Publishing is in-process, since one Nest process owns all sessions (ADR-0001).

### Worktrees

- The location is `<dataDir>/worktrees/<workspaceId>/<ticketSlug>-<shortSessionId>`. The data directory comes from server config and defaults to `~/.slop-control`, which keeps worktrees out of the linked clone.
- The branch is `slop/<ticketSlug>/<shortSessionId>`, where `ticketSlug` is the ticket key made safe for git refs and paths (`owner/repo#123` becomes `owner-repo-123`).
- The base is `origin/<defaultBranch>` as the local clone currently knows it, with no fetch. The default branch is detected when the repo is linked.
- Creating a worktree makes sure `/.slop/` is listed in the clone's local `info/exclude`, which all its worktrees share. Artifacts then stay out of diffs, commits, and `git status`, and nothing committed to the repo changes.
- Removal keeps the branch, so a worktree can be recreated from it. It's refused while the session is active, and when the worktree has uncommitted code changes unless forced, because those exist nowhere else.

### Credentials (NFR-4)

- The GitHub token is kept out of the child's environment, so it can't reach a worktree or transcript through the workspace.
- Before a status reason is stored or anything is logged, a redaction step replaces any known configured secret value. This is a second line of defense.
- The transcript stays where Claude Code writes it. The workspace records its path and makes no copy.

### Spikes

- S1-04 and S1-05 run first and each end in a note with a **confirmed / disproved / partly** verdict. The matching assumption in the requirements is then updated.
- S1-04 is the most important spike, because the annotate-and-send-back loop (FR-35) depends on resume.
- S1-04 must also confirm that `permissionMode: 'auto'` is available on the developer's model and plan, how the runtime can tell a session fell back to manual mode, that a denied call doesn't stall a session, and that the SDK runs with the host's existing Claude Code setup.
- If S1-04 disproves A-8, `SessionRuntime.resume` is redesigned around the documented fallback: a fresh session given a summary of the earlier one. The rest of the contract should survive.
- S1-05 determines how `transcriptPath` is found, starting from the `projectsDirectory` that `claude auth status --json` reports. It stays nullable until then.

## Contracts

These types live in the shared package. The project documents no docstring convention, so the spec uses the default one.

### Types

```ts
type Phase =
  | 'investigation'
  | 'planning'
  | 'implementation'
  | 'automated_testing'
  | 'e2e_testing'
  | 'code_review';

type LaunchablePhase = Exclude<Phase, 'automated_testing' | 'e2e_testing'>;

type SessionStatus = 'starting' | 'running' | 'ended' | 'failed' | 'stopped';

/** Whether the session's required artifact exists; separate from SessionStatus. */
type ArtifactStatus = 'complete' | 'incomplete';

type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'WORKSPACE_NAME_TAKEN'
  | 'PATH_NOT_FOUND'
  | 'NOT_A_GIT_REPO'
  | 'NO_GITHUB_REMOTE'
  | 'REPO_ALREADY_LINKED'
  | 'NO_LINKED_REPO'
  | 'RUNTIME_NOT_READY'
  | 'TRACKER_AUTH_FAILED'
  | 'TRACKER_UNAVAILABLE'
  | 'WORKTREE_CREATE_FAILED'
  | 'WORKTREE_DIRTY'
  | 'SESSION_ACTIVE';

interface ApiError {
  code: ApiErrorCode;
  message: string;
}

interface Workspace {
  id: string;
  name: string;
  /** False until a repo is linked; the UI then directs the developer to link one (FR-2). */
  hasLinkedRepo: boolean;
  createdAt: string;
}

interface CreateWorkspaceBody {
  name: string;
}

interface LinkedRepo {
  id: string;
  workspaceId: string;
  /** Absolute path of the clone's root. */
  localPath: string;
  githubOwner: string;
  githubRepo: string;
  defaultBranch: string;
  createdAt: string;
}

interface LinkRepoBody {
  /** Absolute path to, or inside, a local clone. */
  localPath: string;
}

interface TicketSummary {
  /** Opaque to everything but its adapter, e.g. `owner/repo#123`. */
  key: string;
  title: string;
  /** The tracker's own status name. */
  status: string;
  url: string;
  updatedAt: string;
}

interface Ticket extends TicketSummary {
  body: string;
}

interface TicketQuery {
  search?: string;
  state?: 'open' | 'closed' | 'all';
  cursor?: string;
}

interface TicketPage {
  items: TicketSummary[];
  nextCursor: string | null;
}

interface StartSessionBody {
  phase: LaunchablePhase;
}

interface Session {
  id: string;
  workspaceId: string;
  linkedRepoId: string;
  ticketKey: string;
  phase: Phase;
  status: SessionStatus;
  /** Why the session failed; null otherwise. */
  statusReason: string | null;
  brief: string;
  worktreePath: string;
  branch: string;
  worktreeRemovedAt: string | null;
  /** Set once the runtime reports it. */
  runtimeSessionId: string | null;
  /** Null until known; see S1-05. */
  transcriptPath: string | null;
  /** Null while the session is active, once its worktree is removed, or with no runtime session ID. */
  resumeCommand: string | null;
  /** Null until the session reaches a terminal status. */
  artifactStatus: ArtifactStatus | null;
  startedAt: string;
  endedAt: string | null;
}

interface SessionArtifact {
  sessionId: string;
  /** Starts at 1; a later round adds a new copy rather than replacing this one. */
  round: number;
  /** Where the agent wrote it, relative to the worktree root, e.g. `.slop/investigation.md`. */
  path: string;
  markdown: string;
  createdAt: string;
}

type RuntimeEvent =
  | { type: 'session_started'; runtimeSessionId: string; transcriptPath: string | null }
  | { type: 'session_ended'; outcome: 'success' | 'error' | 'stopped'; message: string | null };

interface RuntimeSetup {
  permissionMode: 'auto';
}

type RuntimeReadiness =
  | { ready: true }
  /** `message` says what to fix on the host, e.g. "Claude Code isn't signed in. Run `claude auth login`." */
  | { ready: false; message: string };

interface RuntimeStartInput {
  brief: string;
  /** The worktree path. */
  cwd: string;
  setup: RuntimeSetup;
}

interface RuntimeResumeInput {
  runtimeSessionId: string;
  message: string;
  cwd: string;
  setup: RuntimeSetup;
}

interface RuntimeHandle {
  /** Ends after `session_ended`, or early if the runtime dies. */
  events: AsyncIterable<RuntimeEvent>;
  /**
   * @return resolves once the runtime has been asked to stop; safe to call more than once
   * Stops the underlying process. `events` then yields `session_ended` with outcome `stopped`.
   */
  stop(): Promise<void>;
}

interface WorktreeInfo {
  path: string;
  branch: string;
}

interface CreateWorktreeInput {
  /** Root of the linked clone. */
  repoPath: string;
  /** e.g. `origin/main`. */
  baseRef: string;
  workspaceId: string;
  ticketKey: string;
  sessionId: string;
}
```

### Endpoints

Every endpoint needs a Supabase JWT in the `Authorization` header. Every error body is an `ApiError`.

```
GET /workspaces
Auth: signed-in user
Responses:
  200: Workspace[]
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
```

```
POST /workspaces
Auth: signed-in user
Body: CreateWorkspaceBody
Responses:
  201: Workspace
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  409: WORKSPACE_NAME_TAKEN, when the name is already in use
  422: VALIDATION_FAILED, when the name is empty
```

```
GET /workspaces/:workspaceId
Auth: signed-in user
Path params: workspaceId
Responses:
  200: Workspace
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the workspace does not exist
```

```
GET /workspaces/:workspaceId/repos
Auth: signed-in user
Path params: workspaceId
Responses:
  200: LinkedRepo[]
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the workspace does not exist
```

```
POST /workspaces/:workspaceId/repos
Auth: signed-in user
Path params: workspaceId
Body: LinkRepoBody
Responses:
  201: LinkedRepo
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the workspace does not exist
  409: REPO_ALREADY_LINKED, when this clone is already linked to the workspace
  422: VALIDATION_FAILED, when the path is not absolute
  422: PATH_NOT_FOUND, when the path does not exist on the host
  422: NOT_A_GIT_REPO, when the path is not inside a git repo
  422: NO_GITHUB_REMOTE, when the repo has no GitHub remote named origin
```

```
GET /workspaces/:workspaceId/tickets
Auth: signed-in user
Path params: workspaceId
Query: { linkedRepoId: string; search?: string; state?: 'open' | 'closed' | 'all'; cursor?: string }
Responses:
  200: TicketPage
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the workspace or linked repo does not exist in this workspace
  502: TRACKER_AUTH_FAILED, when the tracker rejects the configured token
  502: TRACKER_UNAVAILABLE, when the tracker cannot be reached or returns a server error
```

```
GET /workspaces/:workspaceId/tickets/:ticketKey
Auth: signed-in user
Path params: workspaceId, ticketKey (URL-encoded)
Responses:
  200: Ticket
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the workspace or ticket does not exist, or the key matches no linked repo
  502: TRACKER_AUTH_FAILED, when the tracker rejects the configured token
  502: TRACKER_UNAVAILABLE, when the tracker cannot be reached or returns a server error
```

```
GET /workspaces/:workspaceId/tickets/:ticketKey/sessions
Auth: signed-in user
Path params: workspaceId, ticketKey (URL-encoded)
Responses:
  200: Session[], newest first; empty when the ticket has no sessions
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the workspace does not exist
```

```
POST /workspaces/:workspaceId/tickets/:ticketKey/sessions
Auth: signed-in user
Path params: workspaceId, ticketKey (URL-encoded)
Body: StartSessionBody
Responses:
  201: Session, with status `starting`
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the workspace or ticket does not exist, or the key matches no linked repo
  409: NO_LINKED_REPO, when the workspace has no linked repo
  422: VALIDATION_FAILED, when the phase is unknown or is a testing phase
  500: WORKTREE_CREATE_FAILED, when git cannot create the worktree; no session is recorded
  502: TRACKER_AUTH_FAILED, when the tracker rejects the configured token
  502: TRACKER_UNAVAILABLE, when the tracker cannot be reached or returns a server error
  503: RUNTIME_NOT_READY, when Claude Code is missing or not signed in on the host; no session or worktree is created
```

```
GET /workspaces/:workspaceId/sessions/:sessionId
Auth: signed-in user
Path params: workspaceId, sessionId
Responses:
  200: Session
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the session does not exist in this workspace
```

```
GET /workspaces/:workspaceId/session-updates
Auth: signed-in user
Path params: workspaceId
Responses:
  200: text/event-stream, open until the client disconnects
       `session_updated` frames: data is Session, sent on every change to a session in this workspace
       heartbeat comments every 30 seconds
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the workspace does not exist
```

```
GET /workspaces/:workspaceId/sessions/:sessionId/artifact
Auth: signed-in user
Path params: workspaceId, sessionId
Responses:
  200: SessionArtifact, the latest round's copy
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the session does not exist in this workspace or has no stored artifact
```

```
POST /workspaces/:workspaceId/sessions/:sessionId/stop
Auth: signed-in user
Path params: workspaceId, sessionId
Responses:
  200: Session; has no effect if the session has already ended
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the session does not exist in this workspace
```

```
DELETE /workspaces/:workspaceId/sessions/:sessionId/worktree
Auth: signed-in user
Path params: workspaceId, sessionId
Query: { force?: boolean }
Responses:
  200: Session; has no effect if the worktree is already removed
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the session does not exist in this workspace
  409: SESSION_ACTIVE, when the session is `starting` or `running`
  409: WORKTREE_DIRTY, when the worktree has uncommitted changes and force is not set
```

### Functions & Methods

```ts
interface SessionRuntime {
  /**
   * @return whether a session can start now, with a message saying what to fix if not
   * Checks the host's setup without starting a session. Never throws for a missing or signed-out tool.
   */
  checkReady(): Promise<RuntimeReadiness>;

  /**
   * @params input: the brief, the worktree to run in, and the runtime setup
   * @return a handle for the new session's events and for stopping it
   * Starts a new headless session. Start failures surface through the returned events.
   */
  start(input: RuntimeStartInput): RuntimeHandle;

  /**
   * @params input: the session to continue, the new message, and its original worktree
   * @return a handle for the resumed session's events and for stopping it
   * Continues an existing session with its context kept. Provisional until S1-04 reports.
   */
  resume(input: RuntimeResumeInput): RuntimeHandle;
}

interface WorktreeManager {
  /**
   * @params input: the clone, base ref, and the IDs that name the worktree and its branch
   * @return the path and branch of the new worktree, or throws WorktreeCreateError if git fails
   * Creates a worktree on a new `slop/<ticketSlug>/<shortSessionId>` branch, with `/.slop/` excluded from git.
   */
  create(input: CreateWorktreeInput): Promise<WorktreeInfo>;

  /**
   * @params repoPath: root of the linked clone; worktreePath: the worktree to remove; force: discard uncommitted changes
   * @return nothing, or throws WorktreeDirtyError if the worktree is dirty and force is false
   * Removes the worktree and keeps its branch. Does nothing if it is already gone.
   */
  remove(repoPath: string, worktreePath: string, force: boolean): Promise<void>;
}

interface TrackerAdapter {
  /**
   * @params query: optional search text, state filter, and page cursor
   * @return one page of tickets, or throws TrackerAuthError or TrackerUnavailableError
   * Lists and searches tickets. Items that are not tickets, such as pull requests, are excluded.
   */
  list(query: TicketQuery): Promise<TicketPage>;

  /**
   * @params key: the ticket key
   * @return the ticket, or throws TicketNotFoundError, TrackerAuthError, or TrackerUnavailableError
   * Reads one ticket's details from the tracker.
   */
  get(key: string): Promise<Ticket>;
}

interface TrackerAdapterFactory {
  /**
   * @params repo: the linked repo whose tickets are wanted
   * @return the adapter for that repo's ticket source
   * Resolves the adapter. Sprint 1 always returns a GitHub Issues adapter.
   */
  forRepo(repo: LinkedRepo): TrackerAdapter;
}
```

### Stretch contracts

These apply only if the stretch items start, and each depends on its spike.

**S1-14: follow-up message (FR-12).** The session returns to `running` as a new round, and its artifact is checked and copied again when it ends. If its worktree was removed, it's first recreated from the session's branch at the same path, and the latest stored artifact is restored to its `.slop/` path. A file left over from the previous round doesn't count as the new round's result unless it changed during that round. Status changes appear on the same status stream.

```ts
interface SendMessageBody {
  message: string;
}
```

```
POST /workspaces/:workspaceId/sessions/:sessionId/messages
Auth: signed-in user
Path params: workspaceId, sessionId
Body: SendMessageBody
Responses:
  202: Session
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the session does not exist in this workspace
  409: SESSION_ACTIVE, when the session is `starting` or `running`
  422: VALIDATION_FAILED, when the message is empty
  503: RUNTIME_NOT_READY, when Claude Code is missing or not signed in on the host
```

**S1-15: `Session` (changed).** Adds one nullable field: token totals per model.

```ts
interface SessionTokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface Session {
  id: string;
  workspaceId: string;
  linkedRepoId: string;
  ticketKey: string;
  phase: Phase;
  status: SessionStatus;
  statusReason: string | null;
  brief: string;
  worktreePath: string;
  branch: string;
  worktreeRemovedAt: string | null;
  runtimeSessionId: string | null;
  transcriptPath: string | null;
  resumeCommand: string | null;
  artifactStatus: ArtifactStatus | null;
  startedAt: string;
  endedAt: string | null;
  /** Reconciled from the transcript when the session ends; null until then. */
  tokenUsage: SessionTokenUsage[] | null;
}
```

## Testing Decisions

**A good test** checks behavior a caller can see through a public interface. It doesn't assert on private methods, internal calls, or table shapes the API doesn't expose, so it survives refactoring.

**Prior art:** none, since this is the repo's first code. The tests written this sprint set the patterns. Per the sprint plan, the server uses Jest and the web app uses Vitest.

### Main seam: HTTP API

Tests run against the real Nest app, a real local Supabase Postgres, and real JWT checks. Worktrees use real git on a temporary repo. `SessionRuntime` and `TrackerAdapter` are replaced by fakes through Nest's dependency injection. The scripted fake runtime can emit chosen events, pause, fail, or close early.

These tests cover:

- **Auth:** missing, invalid, and expired tokens are rejected on REST and on the stream.
- **Workspaces and repos:** every validation error, root resolution for a path inside a clone, an `origin` that uses an SSH host alias, duplicate links, and the block on sessions without a linked repo.
- **Isolation:** one workspace's session or linked repo returns 404 through another workspace.
- **Launch:** session record, worktree on disk, and brief content. Also the testing-phase rejection, that a worktree failure records no session, and that a runtime that isn't ready returns `RUNTIME_NOT_READY` with its message and creates neither a session nor a worktree.
- **Lifecycle:** each status transition, including an early stream close, a start failure, and `server_restarted` recovery on boot.
- **Status stream:** a client receives each status change within 1 s of the fake runtime reporting it, which covers the server's part of NFR-2. A client only receives its own workspace's sessions, and a change saved before a client connects is visible through the REST read.
- **Required artifact:** `artifactStatus` is `complete` or `incomplete` for each launchable phase, and a symlink doesn't count. The artifact endpoint returns the markdown, including after the worktree is removed, or 404 when none was stored.
- **History:** a ticket's sessions and the rules for when `resumeCommand` appears.
- **Stop and removal:** stop calls the handle and is safe to repeat. Removal covers the active, dirty, forced, and repeated cases, and keeps the branch.
- **NFR-4:** a canary token set as the GitHub token never appears in the child's environment passed to the runtime, in a stored status reason, or in captured logs, even when the fake runtime reports it in an error message.

### Contract seams

- **`SessionRuntime`:** a shared contract suite runs against the fake, so the fake stays faithful. It also backs one opt-in smoke test of the Claude Code runtime against a throwaway repo, off by default and enabled by an env flag. The smoke test also checks that a real session produces its required artifact, and that `checkReady` reports not ready when `CLAUDE_CONFIG_DIR` points to an empty folder.
- **`WorktreeManager`:** real git on temporary repos. Covers branch naming, path layout, slug safety, base ref, dirty detection, forced removal, and kept branches. Also covers that files in `.slop/` don't appear in `git status` and that the exclude line isn't added twice.
- **`TrackerAdapter`:** the GitHub Issues adapter against stubbed HTTP. Covers pull request filtering, pagination, search, 404 mapping, auth and server error mapping, and that the token is sent only as a request header.

### Web app

Light component tests only, in Vitest, for logic worth protecting, such as the stream client's reconnect-and-refetch behavior, cache updates from `session_updated`, and markdown rendering that doesn't pass raw HTML through. There is no browser end-to-end suite this sprint. The demo script is the end-to-end check.

### Done means

Lint, typecheck, and tests all pass, as the sprint's Definition of Done requires. Each spike note also ends with a verdict.

## Out of Scope

From the sprint plan:

- Phase setups and the orchestrator (FR-14, FR-17, FR-18).
- The agents and skills manager.
- Project knowledge MCP.
- Plans.
- Drafted actions and approvals.
- Code editor and annotations.
- Testing phases and inspection hooks.
- Ambient setup view.
- The Jira adapter.
- Remote-host deployment, including the SSH variant of the resume command (FR-13).

Also out for this sprint:

- Live streaming of agent output, and storing it. The developer works from the session's result, and the transcript stays on disk.
- Annotating the markdown artifact (FR-33). The result view is read-only.
- Enforcing where an agent writes, through hooks or a sandbox, and checking which other files it changed.
- Giving a new session the artifacts of earlier phases. They're stored and readable in the dashboard, but not yet passed in.
- Any write to the tracker, including comments and status transitions.
- Answering permission prompts from the dashboard (the rest of FR-12).
- Recording the agent/skill setup and the findings summary from FR-10.
- Rounds as a concept of their own, beyond the round number on a stored artifact. Token usage per round (FR-44) comes later, and S1-15 reports per session.
- Copying env files or installing dependencies in a new worktree.
- Tracking turns continued in a terminal, apart from what S1-15 reconciles from the transcript.
- Unlinking a repo or deleting a workspace.
- Re-attaching to sessions after a server restart.

## Further Notes

- **Authentication stays with the host.** The app has no login flow and stores no Anthropic credentials (A-1). If the app is ever offered to other people, revisit this: the Agent SDK docs say third-party developers may not offer claude.ai login or rate limits for their products unless approved.
- **Auto mode has no phase scope yet.** Until FR-14 exists, `cwd` is the only boundary. A session could write outside its worktree, or use the host's own `git` and `gh` logins to push or comment. FR-27 can't be enforced this sprint, so real-session testing is limited to throwaway repos, and the demo should use an investigation session.
- **Ambient items load by default.** Whatever Claude Code loads on the host, including `~/.claude`, reaches these sessions. FR-41's default of off doesn't apply until phase setups exist.
- **Worktrees may start behind.** Because the base isn't fetched, a stale clone produces a stale worktree. This keeps launch fast and independent of git credentials, and can be revisited with phase setups.
- **New worktrees are bare.** Without env files or dependencies, a session can read code but may not be able to run it. That's acceptable for the investigation demo, and it's part of the setup problem in the pitch that later sprints address.
- **Output location is prompt-only.** An agent can ignore the instruction. If it writes the artifact elsewhere, the session shows as `incomplete`. If an investigation or review session also changes code, nothing flags it, though the changes do show in the worktree's `git status`. If this proves unreliable in practice, add a `PreToolUse` hook on the file-writing tools and a `git status` check when the session ends.
- **Long sessions show no progress.** While a session is `running`, the dashboard shows only that. Its transcript is on disk if something looks wrong, and the stop button ends it.
- **Requirements to update after the spikes:** A-8 and A-10. A-4 and A-5 remain unconfirmed.
