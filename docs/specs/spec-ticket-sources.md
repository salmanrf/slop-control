---
title: "Spec — Ticket sources and the built-in tracker"
summary: "Connect any number of ticket sources per workspace, see their tickets in one list, and use a built-in tracker when none is connected."
---

# Spec: Ticket sources and the built-in tracker

Implements FR-4 to FR-6h and FR-11a, following [ADR-0003](../../adr/0003-ticket-sources-and-built-in-tracker/). Some decisions here are recommendations the developer hasn't confirmed yet. [Further Notes](#further-notes) lists them.

## Problem Statement

The developer can only work on tickets from the GitHub Issues of a repo linked to the workspace. Their tickets may live in Jira or in the Issues of a repo they haven't linked, and tickets from different places can't be seen together. If they use no tracker at all, or haven't set one up yet, they can't start a session, because every session needs a ticket.

Today a ticket also decides which repo a session runs in, and that only works when the ticket's key names a repo. A Jira ticket doesn't.

## Solution

Every workspace starts with a built-in tracker that needs no setup, so the developer can create a ticket and start a session straight away.

The developer can connect any number of ticket sources, such as a Jira project or a repo's GitHub Issues, each with its own credentials. Linking a repo no longer connects its Issues, though the dashboard offers to. Once a source is connected, new tickets come from it, and existing built-in tickets stay workable.

The ticket view lists all sources' tickets together, most recently updated first. Each ticket shows its source, and the list can be filtered by source and status. A failing source shows its own error while the others still list.

When starting a session, the developer sees which repo it will run in and can change it. The repo is preselected wherever that's possible.

## User Stories

### Built-in tracker

1. As the developer, I want a new workspace to have a tracker without any setup, so that I can start work immediately.
2. As the developer, I want to create a ticket with a title and a markdown body, so that I can describe the work for a session.
3. As the developer, I want each built-in ticket to get a short key like `T-12`, so that I can refer to it easily.
4. As the developer, I want to edit a built-in ticket's title and body, so that I can correct or expand it.
5. As the developer, I want to set a built-in ticket's status to *To do*, *In progress*, *In review*, *Done*, or *Cancelled*, so that the list shows where the work stands.
6. As the developer, I want to add comments to a built-in ticket and read them later, so that I can keep notes on it.
7. As the developer, I want to search built-in tickets by title and body, so that I can find one again.
8. As the developer, I want to retire a ticket as *Cancelled* rather than delete it, so that its sessions and history are kept.
9. As the developer, I want to start a session on a built-in ticket the same way as any other ticket, so that nothing changes based on where the ticket lives.
10. As the developer, I want built-in ticket keys never to be reused, so that an old reference always means the same ticket.

### Connecting sources

11. As the developer, I want to connect a Jira project with its site, my email, and an API token, so that its tickets appear in the workspace.
12. As the developer, I want to connect a repo's GitHub Issues by owner and repo name, so that I can use Issues from a repo I haven't linked.
13. As the developer, I want linking a repo to offer connecting its Issues, without doing so automatically, so that I decide where my tickets come from.
14. As the developer, I want to connect several sources to a workspace, in any mix, so that all my tickets for the project are in one place.
15. As the developer, I want each source to hold its own token, so that connections stay independent of each other and of other workspaces.
16. As the developer, I want credentials checked when I connect, so that a bad token or project fails straight away rather than later.
17. As the developer, I want a clear error if a source is already connected, so that I don't create duplicates.
18. As the developer, I want to replace a source's token, so that I can rotate it without losing anything.
19. As the developer, I want to see my workspace's sources and whether each has a stored credential, so that I know what's connected.
20. As the developer, I want tokens never returned to the browser after I enter them, so that they can't leak from the dashboard.
21. As the developer, I want tokens encrypted at rest, so that a database dump doesn't expose them.
22. As the developer, I want a source token never to appear in a worktree, transcript, status reason, or log, so that agents and logs can't leak it.
23. As the developer, I want connecting a public GitHub repo's Issues to work without a token, so that the setup stays quick.

### Built-in tracker alongside connected sources

24. As the developer, I want creating built-in tickets turned off once I connect a source, so that new work doesn't drift away from the tracker my team sees.
25. As the developer, I want existing built-in tickets to stay listed, editable, and workable after connecting a source, so that nothing in progress is stranded.
26. As the developer, I want built-in ticket creation back when I disconnect my last source, so that the workspace is never left without a way to create work.

### Ticket view

27. As the developer, I want one list of tickets from all my sources, most recently updated first, so that I see what's active regardless of where it lives.
28. As the developer, I want each ticket to show its source, so that I know where it came from.
29. As the developer, I want to filter by source, so that I can focus on one tracker.
30. As the developer, I want to filter by *open*, *in progress*, or *done*, so that the same filter works across trackers with different statuses.
31. As the developer, I want each ticket to still show its tracker's own status name, so that it matches what my team sees.
32. As the developer, I want *done* tickets hidden by default, so that the list shows work that's still live.
33. As the developer, I want to search across all sources at once, so that I don't need to search each one.
34. As the developer, I want to see only tickets assigned to me by default, with a toggle for all, so that a large Jira project stays usable.
35. As the developer, I want to be told when a source can't apply the assigned-to-me filter, so that I understand why I'm seeing everything.
36. As the developer, I want a failing source to show its own error while the others still list, so that one bad token doesn't hide all my work.
37. As the developer, I want to tell an auth failure from an unreachable tracker, so that I know what to fix.
38. As the developer, I want to keep paging through the merged list, so that I can reach older tickets.

### Choosing a repo

39. As the developer, I want to see which repo a session will run in before it starts, so that it doesn't run in the wrong place.
40. As the developer, I want the repo preselected when it can be worked out, so that I rarely have to choose.
41. As the developer, I want the ticket's most recently used repo preselected, so that follow-up sessions stay together.
42. As the developer, I want to set a default repo on a source, so that its tickets start in the right repo.
43. As the developer, I want to change the repo for any ticket-level session, so that I can work on a ticket across repos.
44. As the developer, I want a clear prompt when no repo can be preselected, so that the workspace never guesses.
45. As the developer, I want each session record to show its repo, so that the history makes sense in a multi-repo workspace.

### Disconnecting

46. As the developer, I want to disconnect a source, so that its tickets leave my list and its token is deleted.
47. As the developer, I want a disconnected source's sessions and artifacts kept, so that I don't lose the work done on its tickets.
48. As the developer, I want to find tickets from a disconnected source, marked as such, using their title and stored brief, so that their history stays reachable.
49. As the developer, I want new sessions blocked on those tickets with a clear reason, so that I know to reconnect first.
50. As the developer, I want to still stop sessions and remove worktrees for those tickets, so that a revoked token can't strand anything on my machine.
51. As the developer, I want reconnecting the same project or repo to restore its tickets and their sessions, so that disconnecting isn't destructive.

### Upgrading

52. As the developer, I want my existing workspaces to keep working after the upgrade, with each linked repo's Issues already connected, so that I lose no tickets or session history.

## Implementation Decisions

### Modules

- **ticket-sources (new, inside `tickets`):** owns connecting, updating, disconnecting, and reconnecting sources, and resolves a source to its adapter.
- **tickets (changed):** merges and pages tickets across sources, and maps a failing source to its own status rather than failing the request.
- **built-in tracker (new, inside `tickets`):** stores built-in tickets and comments, and implements `TrackerAdapter`. It owns the rule that turns creation off.
- **Jira adapter (new):** implements `TrackerAdapter`, read only.
- **GitHub Issues adapter (changed):** gains status categories, sort by updated, and the assigned-to-me filter.
- **sessions (changed):** resolves the repo independently of the ticket, and records the source and title.
- **SecretBox (new, in `common`):** encrypts and decrypts stored credentials. FR-67 can reuse it for test environment values.
- **Redactor (changed):** secrets can be added at runtime, since source tokens aren't known at startup.
- **web app (changed):** merged ticket view, source management, built-in ticket editing, and a repo picker at launch.

### A source's identity

- A ticket source is a row in `ticket_source`, with a `type` of `built_in`, `github_issues`, or `jira`.
- Each workspace has exactly one `built_in` row, created with the workspace. It can't be updated or disconnected.
- `(workspace_id, scope_key)` is unique, where `scope_key` is `built_in`, `github:<owner>/<repo>`, or `jira:<site>/<project>`, lowercased. This is what lets a reconnect find the same row and restore its sessions.
- Nothing is shared across sources or workspaces: each row holds its own credential.
- A ticket is addressed by source ID and key everywhere, so routes change from `/tickets/:key` to `/sources/:sourceId/tickets/:key`, in the API and in web URLs. Old URLs aren't preserved.

### Credentials

- Credentials are encrypted with AES-256-GCM and stored on the source row. The key comes from a new `SLOP_SECRET_KEY` server setting, so it isn't stored in the database.
- A credential is required for Jira and optional for GitHub Issues. With none, a GitHub Issues source uses the server's `GITHUB_TOKEN`, then anonymous access, as it does today.
- Storing a credential with no key configured fails with `SECRETS_NOT_CONFIGURED`. Sources without a stored credential still work.
- The API never returns a credential, only `hasCredential`.
- Connecting or changing a token first calls `TrackerAdapter.verify`. If that fails, nothing is saved.
- Stored tokens are added to the `Redactor` when the server starts and when they're saved.
- Disconnecting erases the stored credential, so reconnecting needs a token again.

### Jira

- Supports Jira Cloud only, with email and API token over basic auth.
- The site must be an `https` host ending in `.atlassian.net`. This stops a token being sent to an arbitrary host.
- Lists with JQL scoped to the project and ordered by `updated DESC`. The search text is passed as a quoted JQL string, so it can't widen the scope.
- A ticket's body arrives in Atlassian Document Format and is converted to markdown. Unsupported nodes are dropped.
- `statusCategory` maps as: To Do to `open`, In Progress to `in_progress`, Done to `done`.
- The current Jira search endpoint and its token-based paging must be confirmed against Atlassian's docs when this is built.

### Status categories

- `TicketSummary.status` remains the tracker's own name, and the new `statusCategory` is used for filtering.
- GitHub Issues maps open to `open` and closed to `done`, so filtering by `in_progress` returns nothing from it, without a network call.
- Built-in maps *To do* to `open`, *In progress* and *In review* to `in_progress`, and *Done* and *Cancelled* to `done`.
- `state` on `TicketQuery` is replaced by `category`, which defaults to `not_done`.

### Assigned to me

- `mine` defaults to `true`.
- Jira uses `assignee = currentUser()`.
- GitHub Issues filters by the login of the token's user. With no token there is no user, so it returns everything and reports `mineApplied: false`.
- The built-in tracker has no assignees and one user, so it ignores the filter and reports `mineApplied: true`.

### Merged listing

- Every adapter must return tickets by `updatedAt` descending.
- The service fetches a page from each selected source concurrently and merges them by `updatedAt`, breaking ties by source ID then key. It returns up to 30.
- The cursor is opaque. It holds each source's adapter cursor, how many items of that page were used, and whether the source is exhausted, so the server stays stateless.
- Tickets that change between pages can repeat or be skipped, as with any live tracker. The web app removes repeats by source and key.
- `GET /tickets` returns 200 even if every source fails. A failure appears in that source's `sources` entry, and its position is kept for the next page.
- Disconnected sources are left out of the list and reachable through their own endpoint.

### Built-in tickets

- `built_in_ticket(id, ticket_source_id, number, title, body, status, created_at, updated_at)`, with `(ticket_source_id, number)` unique. The key is `T-<number>`.
- Numbers are allocated atomically per source, and since there's no delete they are never reused.
- `built_in_ticket_comment(id, ticket_id, body, created_at)`. Comments can be added but not edited or deleted, and adding one updates the ticket's `updated_at`.
- `TicketSummary.url` becomes nullable, since a built-in ticket has no external page.
- Creation returns `BUILT_IN_CREATION_OFF` while the workspace has a connected source. Editing and comments always work.
- These endpoints are for the dashboard. Sessions get no route to them, and agent writes wait for drafted actions (FR-6f).
- The session brief stays title, body, and the phase instruction, so comments aren't included, matching other sources.

### Repo resolution

`POST` on a ticket's sessions uses the first that applies:

1. `linkedRepoId` from the request.
2. The repo of the ticket's most recent session.
3. The source's `defaultLinkedRepoId`.
4. For a GitHub Issues source, the linked repo with the same owner and name, using the oldest if several clones match.
5. The workspace's only linked repo.

If none applies, the request fails with `REPO_CHOICE_REQUIRED`. The web app shows the same result from a read endpoint before launch, so a developer normally never sees this error.

### Disconnected sources

- Disconnecting sets `disconnected_at` and erases the credential. Sessions, artifacts, and the row remain.
- Reading a ticket or starting a session on one returns `SOURCE_DISCONNECTED`.
- Listing a ticket's sessions, reading a session or artifact, stopping a session, and removing a worktree all still work.
- Sessions store `ticket_title` at launch, so a disconnected ticket can still show its title.

### Schema migration

- Add `ticket_source`, `built_in_ticket`, and `built_in_ticket_comment`, with row level security on and no policies, like the existing tables.
- Add one `built_in` source per existing workspace.
- Add one `github_issues` source per distinct owner and repo among linked repos. It has no stored credential, so it keeps using `GITHUB_TOKEN`, and its default repo is that linked repo, or the oldest if several clones match.
- Add `session.ticket_source_id`, backfilled by matching the session's linked repo to its source, then set not null.
- Add `session.ticket_title`, backfilled from the first line of `brief`, then set not null.
- Replace `session_ticket_idx` with one on `(workspace_id, ticket_source_id, ticket_key, started_at desc)`.

### Web app

- The workspace page's repo dropdown is replaced by the merged list, with source, status, and assigned-to-me filters, and one inline error per failing source.
- A new sources screen connects, updates, disconnects, and reconnects sources, and lists tickets from disconnected ones.
- After linking a repo, the dashboard offers to connect its Issues.
- *New ticket* appears only when the built-in tracker allows creation. Built-in tickets have an edit form, a status picker, and comments on the ticket page.
- The launch controls gain a repo picker, filled from the preselection endpoint.
- Query keys and the session cache are keyed by source ID and ticket key.
- The README's description of tickets and tokens is updated, including `SLOP_SECRET_KEY`.

## Contracts

### Types

```ts
export type TicketSourceType = 'built_in' | 'github_issues' | 'jira';

export type StatusCategory = 'open' | 'in_progress' | 'done';

export type BuiltInTicketStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';

export interface TicketSource {
  id: string;
  workspaceId: string;
  type: TicketSourceType;
  /** For display, e.g. `owner/repo`, `BF on acme.atlassian.net`, or `Built-in`. */
  label: string;
  /** Null for `built_in`. */
  scope:
    | { githubOwner: string; githubRepo: string }
    | { jiraSite: string; jiraProject: string; jiraEmail: string }
    | null;
  hasCredential: boolean;
  defaultLinkedRepoId: string | null;
  /** Only ever true on a `built_in` source with no connected sources alongside it. */
  canCreateTickets: boolean;
  disconnectedAt: string | null;
  createdAt: string;
}

export type ConnectSourceBody =
  | { type: 'github_issues'; githubOwner: string; githubRepo: string; token?: string; defaultLinkedRepoId?: string }
  | { type: 'jira'; jiraSite: string; jiraProject: string; jiraEmail: string; token: string; defaultLinkedRepoId?: string };

export interface UpdateSourceBody {
  /** Replaces the stored credential. */
  token?: string;
  /** Null clears it. */
  defaultLinkedRepoId?: string | null;
}

export interface SourceListStatus {
  sourceId: string;
  state: 'ok' | 'auth_failed' | 'unavailable';
  /** Null when `state` is `ok`. */
  message: string | null;
  /** False when the source returned tickets not limited to the developer. */
  mineApplied: boolean;
}

export interface MergedTicketPage {
  items: TicketSummary[];
  nextCursor: string | null;
  /** One entry per source asked, including failed ones. */
  sources: SourceListStatus[];
}

export interface CreateBuiltInTicketBody {
  title: string;
  body?: string;
}

export interface UpdateBuiltInTicketBody {
  title?: string;
  body?: string;
  status?: BuiltInTicketStatus;
}

export interface BuiltInTicketComment {
  id: string;
  body: string;
  createdAt: string;
}

export interface AddCommentBody {
  body: string;
}

export interface RepoPreselection {
  /** Null when the developer must choose. */
  linkedRepoId: string | null;
}

export interface DisconnectedTicket {
  sourceId: string;
  key: string;
  /** The title when its latest session started. */
  title: string;
  /** The brief of its latest session. */
  latestBrief: string;
  lastSessionAt: string;
}
```

**(changed)** `TicketSummary`: adds `sourceId` and `statusCategory`; `url` becomes nullable.

```ts
export interface TicketSummary {
  sourceId: string;
  /** Unique only within its source, e.g. `owner/repo#123`, `BF-123`, or `T-12`. */
  key: string;
  title: string;
  /** The tracker's own status name. */
  status: string;
  statusCategory: StatusCategory;
  /** Null for a built-in ticket, which has no external page. */
  url: string | null;
  updatedAt: string;
}
```

**(changed)** `TicketQuery`: `state` is replaced by `category`, and `mine` is added.

```ts
export interface TicketQuery {
  search?: string;
  /** Defaults to `not_done`. */
  category?: StatusCategory | 'not_done' | 'all';
  /** Defaults to true. */
  mine?: boolean;
  cursor?: string;
}
```

**(changed)** `StartSessionBody`: adds `linkedRepoId`.

```ts
export interface StartSessionBody {
  phase: LaunchablePhase;
  /** Overrides the preselected repo. */
  linkedRepoId?: string;
}
```

**(changed)** `Session`: adds `ticketSourceId` and `ticketTitle`. Its other fields are unchanged.

```ts
export interface Session {
  id: string;
  workspaceId: string;
  linkedRepoId: string;
  ticketSourceId: string;
  ticketKey: string;
  /** The ticket's title when the session started. */
  ticketTitle: string;
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
}
```

**(changed)** `ApiErrorCode`: adds `SOURCE_ALREADY_CONNECTED`, `SOURCE_DISCONNECTED`, `BUILT_IN_SOURCE_FIXED`, `BUILT_IN_CREATION_OFF`, `REPO_CHOICE_REQUIRED`, and `SECRETS_NOT_CONFIGURED`. Existing codes are unchanged and aren't repeated here.

### Endpoints

All endpoints require a valid Supabase JWT and return `401: UNAUTHENTICATED` without one. `404: NOT_FOUND` also covers a workspace, source, or repo belonging to a different workspace.

```
GET /workspaces/:workspaceId/sources
Responses:
  200: TicketSource[], including disconnected sources
  404: NOT_FOUND, when the workspace does not exist
```

```
POST /workspaces/:workspaceId/sources
Body: ConnectSourceBody
Responses:
  201: TicketSource; reconnecting a disconnected scope restores its existing row
  400: VALIDATION_FAILED, when a field is missing, or the Jira site is not an https *.atlassian.net host
  404: NOT_FOUND, when the workspace or defaultLinkedRepoId does not exist
  409: SOURCE_ALREADY_CONNECTED, when this scope is already connected
  502: TRACKER_AUTH_FAILED, when the tracker rejects the credential or can't show the scope
  502: TRACKER_UNAVAILABLE, when the tracker cannot be reached
  503: SECRETS_NOT_CONFIGURED, when a token is given and SLOP_SECRET_KEY is not set
```

```
PATCH /workspaces/:workspaceId/sources/:sourceId
Body: UpdateSourceBody
Responses:
  200: TicketSource
  400: VALIDATION_FAILED, when the body is malformed
  404: NOT_FOUND, when the workspace, source, or defaultLinkedRepoId does not exist
  409: BUILT_IN_SOURCE_FIXED, when the source is the built-in tracker
  409: SOURCE_DISCONNECTED, when the source is disconnected
  502: TRACKER_AUTH_FAILED, when the tracker rejects the new token
  502: TRACKER_UNAVAILABLE, when the tracker cannot be reached to check the new token
  503: SECRETS_NOT_CONFIGURED, when a token is given and SLOP_SECRET_KEY is not set
```

```
DELETE /workspaces/:workspaceId/sources/:sourceId
Responses:
  200: TicketSource, with disconnectedAt set; repeating the call returns the same source
  404: NOT_FOUND, when the workspace or source does not exist
  409: BUILT_IN_SOURCE_FIXED, when the source is the built-in tracker
```

**(changed)** Lists across sources. `linkedRepoId` and `state` are removed, and `sourceId`, `category`, and `mine` are added. It no longer returns tracker errors.

```
GET /workspaces/:workspaceId/tickets
Query: { sourceId?: string, search?: string, category?: StatusCategory | 'not_done' | 'all', mine?: boolean, cursor?: string }
Responses:
  200: MergedTicketPage, with any source's failure reported in `sources`
  404: NOT_FOUND, when the workspace does not exist, or sourceId is not a connected source of it
```

```
GET /workspaces/:workspaceId/disconnected-tickets
Responses:
  200: DisconnectedTicket[], tickets with at least one session on a disconnected source, latest first
  404: NOT_FOUND, when the workspace does not exist
```

**(changed)** The route moves under a source.

```
GET /workspaces/:workspaceId/sources/:sourceId/tickets/:ticketKey
Path params: ticketKey is URL-encoded
Responses:
  200: Ticket
  404: NOT_FOUND, when the workspace, source, or ticket does not exist
  409: SOURCE_DISCONNECTED, when the source is disconnected
  502: TRACKER_AUTH_FAILED, when the tracker rejects the credential
  502: TRACKER_UNAVAILABLE, when the tracker cannot be reached or returns a server error
```

**(changed)** The route moves under a source. It still works on a disconnected source.

```
GET /workspaces/:workspaceId/sources/:sourceId/tickets/:ticketKey/sessions
Responses:
  200: Session[], latest first
  404: NOT_FOUND, when the workspace or source does not exist
```

```
GET /workspaces/:workspaceId/sources/:sourceId/tickets/:ticketKey/repo-preselection
Responses:
  200: RepoPreselection
  404: NOT_FOUND, when the workspace or source does not exist
```

**(changed)** The route moves under a source, and the body gains `linkedRepoId`.

```
POST /workspaces/:workspaceId/sources/:sourceId/tickets/:ticketKey/sessions
Body: StartSessionBody
Responses:
  201: Session
  400: VALIDATION_FAILED, when the phase is not launchable
  404: NOT_FOUND, when the workspace, source, ticket, or linkedRepoId does not exist
  409: NO_LINKED_REPO, when the workspace has no linked repo
  409: REPO_CHOICE_REQUIRED, when no linkedRepoId is given and none can be preselected
  409: SOURCE_DISCONNECTED, when the source is disconnected
  500: WORKTREE_CREATE_FAILED, when the worktree cannot be created
  502: TRACKER_AUTH_FAILED, when the tracker rejects the credential
  502: TRACKER_UNAVAILABLE, when the tracker cannot be reached or returns a server error
  503: RUNTIME_NOT_READY, when the runtime is not ready or the server is shutting down
```

```
POST /workspaces/:workspaceId/built-in-tickets
Body: CreateBuiltInTicketBody
Responses:
  201: Ticket
  400: VALIDATION_FAILED, when the title is blank
  404: NOT_FOUND, when the workspace does not exist
  409: BUILT_IN_CREATION_OFF, when the workspace has a connected source
```

```
PATCH /workspaces/:workspaceId/built-in-tickets/:ticketKey
Body: UpdateBuiltInTicketBody
Responses:
  200: Ticket
  400: VALIDATION_FAILED, when the title is blank or the status is unknown
  404: NOT_FOUND, when the workspace or ticket does not exist
```

```
GET /workspaces/:workspaceId/built-in-tickets/:ticketKey/comments
Responses:
  200: BuiltInTicketComment[], oldest first
  404: NOT_FOUND, when the workspace or ticket does not exist
```

```
POST /workspaces/:workspaceId/built-in-tickets/:ticketKey/comments
Body: AddCommentBody
Responses:
  201: BuiltInTicketComment
  400: VALIDATION_FAILED, when the body is blank
  404: NOT_FOUND, when the workspace or ticket does not exist
```

### Functions & Methods

**(changed)** `TrackerAdapter`: adds `verify`. `list` must now sort by most recently updated and report whether `mine` was applied.

```ts
interface TrackerAdapter {
  /**
   * @return resolves if the credential can read the source's scope; otherwise throws TrackerAuthError or TrackerUnavailableError
   * Checks a source before it is saved.
   */
  verify(): Promise<void>;

  /**
   * @params query: optional search text, status category, assigned-to-me flag, and page cursor
   * @return one page of tickets, latest update first, and whether `mine` was applied; or throws TrackerAuthError or TrackerUnavailableError
   * Lists and searches tickets. Items that are not tickets, such as pull requests, are excluded.
   */
  list(query: TicketQuery): Promise<TicketPage & { mineApplied: boolean }>;

  /**
   * @params key: the ticket key
   * @return the ticket, or throws TicketNotFoundError, TrackerAuthError, or TrackerUnavailableError
   * Reads one ticket's details from the tracker.
   */
  get(key: string): Promise<Ticket>;
}
```

**(changed)** `TrackerAdapterFactory`: `forRepo` is replaced by `forConnected`, since an adapter now comes from a source. The built-in tracker isn't created here, so tests can fake connected trackers and still run the real built-in one.

```ts
abstract class TrackerAdapterFactory {
  /**
   * @params source: a connected source, with no built-in type; token: its decrypted credential, if any
   * @return the adapter for that source
   * Resolves the adapter for a Jira or GitHub Issues source.
   */
  abstract forConnected(source: TicketSource, token: string | null): TrackerAdapter;
}
```

```ts
class TicketSourcesService {
  /**
   * @params workspaceId: the workspace
   * @return its sources, including the built-in tracker and disconnected sources
   * Lists a workspace's ticket sources.
   */
  list(workspaceId: string): Promise<TicketSource[]>;

  /**
   * @params workspaceId: the workspace; body: the source's scope and credential
   * @return the connected source, or throws an ApiException listed under the connect endpoint
   * Verifies and saves a source, restoring the existing row if the scope was disconnected.
   */
  connect(workspaceId: string, body: ConnectSourceBody): Promise<TicketSource>;

  /**
   * @params workspaceId: the workspace; sourceId: the source; body: the new token and default repo
   * @return the updated source, or throws an ApiException listed under the update endpoint
   * Verifies a new token before saving it, and changes the default repo.
   */
  update(workspaceId: string, sourceId: string, body: UpdateSourceBody): Promise<TicketSource>;

  /**
   * @params workspaceId: the workspace; sourceId: the source
   * @return the disconnected source, or throws BUILT_IN_SOURCE_FIXED for the built-in tracker
   * Marks the source disconnected and erases its credential; safe to repeat.
   */
  disconnect(workspaceId: string, sourceId: string): Promise<TicketSource>;

  /**
   * @params source: any source of the workspace
   * @return its adapter, or throws SOURCE_DISCONNECTED if it is disconnected
   * Resolves a source to the built-in tracker or a connected adapter, decrypting its credential.
   */
  adapterFor(source: TicketSource): Promise<TrackerAdapter>;
}
```

**(changed)** `TicketsService`: `list` takes a source filter instead of a repo and no longer throws tracker errors, and `get` and `read` take a source.

```ts
class TicketsService {
  /**
   * @params workspaceId: the workspace; sourceId: limits the list to one source; query: filters and the merged cursor
   * @return one merged page and a status per source, with failures reported there rather than thrown
   * Lists and merges tickets across the workspace's connected sources and built-in tracker.
   */
  list(workspaceId: string, sourceId: string | undefined, query: TicketQuery): Promise<MergedTicketPage>;

  /**
   * @params workspaceId: the workspace; sourceId: the ticket's source; key: its key
   * @return the ticket, or throws NOT_FOUND, SOURCE_DISCONNECTED, or a tracker error
   * Reads one ticket through its source's adapter.
   */
  get(workspaceId: string, sourceId: string, key: string): Promise<Ticket>;

  /**
   * @params workspaceId: the workspace
   * @return tickets on disconnected sources that have sessions, latest first
   * Builds the list from session records, since those tickets can no longer be read.
   */
  listDisconnected(workspaceId: string): Promise<DisconnectedTicket[]>;
}
```

```ts
class BuiltInTracker implements TrackerAdapter {
  /**
   * @params workspaceId: the workspace; body: the title and optional body
   * @return the ticket, or throws BUILT_IN_CREATION_OFF if the workspace has a connected source
   * Creates a ticket with the next key and the status *To do*.
   */
  create(workspaceId: string, body: CreateBuiltInTicketBody): Promise<Ticket>;

  /**
   * @params workspaceId: the workspace; key: the ticket key; body: the fields to change
   * @return the updated ticket, or throws NOT_FOUND
   * Edits a ticket from the dashboard, which is the only caller.
   */
  update(workspaceId: string, key: string, body: UpdateBuiltInTicketBody): Promise<Ticket>;

  /**
   * @params workspaceId: the workspace; key: the ticket key
   * @return its comments, oldest first, or throws NOT_FOUND
   * Lists a ticket's comments.
   */
  listComments(workspaceId: string, key: string): Promise<BuiltInTicketComment[]>;

  /**
   * @params workspaceId: the workspace; key: the ticket key; body: the comment
   * @return the comment, or throws NOT_FOUND
   * Adds a comment and updates the ticket's `updatedAt`.
   */
  addComment(workspaceId: string, key: string, body: AddCommentBody): Promise<BuiltInTicketComment>;
}
```

**(changed)** `SessionsService.start`: takes a source and an optional repo. `listForTicket` also gains `sourceId` after `workspaceId`.

```ts
class SessionsService {
  /**
   * @params workspaceId: the workspace; sourceId: the ticket's source; ticketKey: the ticket; body: the phase and optional repo
   * @return the session, or throws an ApiException listed under the start endpoint
   * Resolves the repo, reads the ticket, creates the worktree, and starts the runtime without waiting for it.
   */
  start(workspaceId: string, sourceId: string, ticketKey: string, body: StartSessionBody): Promise<Session>;

  /**
   * @params workspaceId: the workspace; sourceId: the ticket's source; ticketKey: the ticket
   * @return the repo a new session would use, or null if the developer must choose
   * Applies the preselection order without starting anything.
   */
  preselectRepo(workspaceId: string, sourceId: string, ticketKey: string): Promise<RepoPreselection>;
}
```

```ts
class SecretBox {
  /**
   * @params plaintext: the secret
   * @return the encrypted value, or throws SecretsNotConfiguredError if no key is set
   * Encrypts a secret for storage.
   */
  seal(plaintext: string): string;

  /**
   * @params sealed: a value from `seal`
   * @return the secret, or throws if the key is missing or the value was altered
   * Decrypts a stored secret.
   */
  open(sealed: string): string;
}
```

**(changed)** `Redactor`: adds `add`, for secrets only known at runtime.

```ts
class Redactor {
  /**
   * @params secret: a value to hide from now on
   * @return nothing
   * Adds a secret to the set that `redact` replaces.
   */
  add(secret: string): void;

  /**
   * @params text: text bound for storage or logs
   * @return the text with known secrets replaced
   * Replaces known secret values, as a second line of defense (NFR-4).
   */
  redact(text: string): string;
}
```

## Testing Decisions

**A good test** checks behavior a caller can see through a public interface. It doesn't assert on private methods or table shapes the API doesn't expose, so it survives refactoring.

**Seams** (confirmed with the developer) are the existing ones, with no new seams:

### Main seam: HTTP API

Tests run against the real Nest app, a real local Supabase Postgres, and real JWT checks, extending the existing `tickets`, `session-launch`, and `workspaces` suites and their `test-app` and `session-harness` support. `SessionRuntime` and connected trackers are faked. `FakeTracker` moves to per-source behavior, so one source can fail while another succeeds. The built-in tracker runs for real.

These tests cover:

- **Default tracker:** a new workspace has a built-in source, and a ticket can be created, edited, commented on, searched, and given a session with no setup.
- **Creation rule:** creating is refused while a source is connected and allowed again after the last disconnect, while editing and comments always work.
- **Connecting:** every validation error, a failed verification saving nothing, duplicates, a non-Atlassian Jira site, a token with no secret key, and linking a repo not creating a source.
- **Merged list:** ordering across sources, paging through to the end without losing a source, source and category and `mine` filters, and hiding *done* by default.
- **Failure isolation:** a source with an auth failure, or one that's unreachable, gets its own status while the others list, including across a later page.
- **Identity:** the same key in two sources stays two tickets, with separate sessions.
- **Repo resolution:** each step of the order, `REPO_CHOICE_REQUIRED`, an override, the preselection endpoint agreeing with launch, and a repo from another workspace returning 404.
- **Disconnecting:** the ticket leaves the list and appears in `disconnected-tickets`, reads and launches return `SOURCE_DISCONNECTED`, stop and worktree removal still work, the token is erased, and reconnecting restores the sessions.
- **Isolation:** one workspace's source or built-in ticket returns 404 through another workspace.
- **NFR-4:** a canary source token is never returned by the API, stored in plain text, or seen in a child environment, status reason, worktree, or captured log.
- **Migration:** a database at the old schema migrates with each session on the right source, and two clones of one repo produce one source.

### Contract seam: `TrackerAdapter`

A shared contract suite, following the existing `runtime-contract` pattern, runs against GitHub Issues, Jira, the built-in tracker, and `FakeTracker`, so the fake stays faithful. It covers ordering, paging, search, status categories, `mineApplied`, and not-found.

Adapter-specific tests over stubbed HTTP, following `github-issues-adapter.spec`, also cover:

- **Jira:** JQL scoping, search text that can't escape the quoted string, ADF conversion, auth and server error mapping, and the token sent only as a header.
- **GitHub Issues:** sort order, category mapping, and `mine` with and without a token.

### Web app

Light Vitest tests for logic worth protecting, following `apps/web/test`: removing repeated tickets across pages, cache updates keyed by source, and per-source error display. There is no browser suite, and an e2e report in `docs/reports` serves as the end-to-end check, as in Sprint 1.

## Out of Scope

- Writing to connected trackers, including comments and status changes. Those arrive with drafted actions (FR-27, FR-28), when the adapter gains its write methods.
- Agents changing or creating tickets on any source.
- Plans. When they're built, each must store its repo (FR-10d).
- Linear and other trackers.
- Jira Server and Data Center.
- JQL scopes, and a single source covering several Jira projects.
- Sharing credentials across sources or workspaces, and a separate workspace GitHub credential for PRs.
- Moving tickets between sources (OQ-16).
- Boards, assignees, sprints, custom statuses, attachments, and comment editing in the built-in tracker.
- A session reading or working across several repos (OQ-18).
- Rotating `SLOP_SECRET_KEY`.
- Renaming "linked source" in the docs.

## Further Notes

**Confirmed by the developer:** each Jira source is one project with its own token, nothing is shared across workspaces, and the test seams above.

**Not yet confirmed:** this spec uses my recommendations from the design review for these, and each is cheap to change now:

| Question | Used here |
|---|---|
| Q1: Repos per session | One per session |
| Q2: Built-in tracker after connecting a source | Fallback only |
| Q3: Agent writes to built-in tickets | Need approval, and don't exist until drafted actions do |
| Q4: Agents creating tickets | Not in the MVP |
| Q5b: GitHub Issues token | Separate from any PR credential; the one-time copy is dropped, because no workspace GitHub credential exists yet |
| Q6: Status filtering | Three shared categories, with *done* hidden by default |
| Q7: Default ticket list | Assigned to me |
| Q8: Repo preselection | Extends FR-11a with last-used repo and a source default |
| Q9: Disconnected sources | Stop and worktree removal still work, and reconnecting restores tickets. Resuming and PR dispatch should also stay allowed when they're built |
| Q10: Deleting built-in tickets | No delete |

**Decided while writing this spec, not discussed:**

- `SLOP_SECRET_KEY` with AES-256-GCM as the credential store. This answers A-5's open question for ticket sources, and `requirements.md` should be updated if it's kept.
- Falling back to `GITHUB_TOKEN` when a GitHub Issues source has no token. This keeps migrated workspaces working without a key.
- Erasing the credential on disconnect.
- Jira Cloud only.

**Docs to update if these hold:** FR-11a for the fuller preselection order, A-5 for storage, and new open questions for agent-created tickets (Q4) and JQL scopes (Q7).
