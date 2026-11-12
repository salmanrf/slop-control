export type Phase =
  | 'investigation'
  | 'planning'
  | 'implementation'
  | 'automated_testing'
  | 'e2e_testing'
  | 'code_review';

export type LaunchablePhase = Exclude<Phase, 'automated_testing' | 'e2e_testing'>;

export type SessionStatus = 'starting' | 'running' | 'ended' | 'failed' | 'stopped';

/** Whether the session's required artifact exists; separate from SessionStatus. */
export type ArtifactStatus = 'complete' | 'incomplete';

export type ApiErrorCode =
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
  | 'SESSION_ACTIVE'
  | 'SESSION_NOT_RESUMABLE'
  | 'SOURCE_ALREADY_CONNECTED'
  | 'SOURCE_DISCONNECTED'
  | 'BUILT_IN_SOURCE_FIXED'
  | 'BUILT_IN_CREATION_OFF'
  | 'REPO_CHOICE_REQUIRED'
  | 'SECRETS_NOT_CONFIGURED'
  | 'CREDENTIAL_REJECTED'
  | 'CREDENTIAL_NOT_SET'
  | 'REPO_HOST_UNAVAILABLE'
  | 'ACTION_ALREADY_DECIDED'
  | 'ACTION_STALE'
  /** An unexpected server failure; the spec's contract has no code for these. */
  | 'INTERNAL_ERROR';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

export interface Workspace {
  id: string;
  name: string;
  /** False until a repo is linked; the UI then directs the developer to link one (FR-2). */
  hasLinkedRepo: boolean;
  createdAt: string;
}

export interface CreateWorkspaceBody {
  name: string;
}

export interface LinkedRepo {
  id: string;
  workspaceId: string;
  /** Absolute path of the clone's root. */
  localPath: string;
  githubOwner: string;
  githubRepo: string;
  defaultBranch: string;
  createdAt: string;
}

export interface LinkRepoBody {
  /** Absolute path to, or inside, a local clone. */
  localPath: string;
}

export type CredentialState = 'ok' | 'auth_failed' | 'unavailable';

/** What the API says about a stored credential. It never includes the token. */
export interface CredentialStatus {
  isSet: boolean;
  /** How the last check went; null when no credential is set. */
  state: CredentialState | null;
  /** The GitHub login the token belongs to; null when not set or never accepted. */
  login: string | null;
  /** What went wrong at the last check; null when `state` is `ok` or nothing is set. */
  message: string | null;
  /** Null when no credential is set. */
  checkedAt: string | null;
}

export interface RepoPushAccess {
  linkedRepoId: string;
  /** Whether the credential could push to this repo at the last check. */
  canPush: boolean;
}

export interface WorkspaceCredentialStatus extends CredentialStatus {
  /** One entry per linked repo; empty when no credential is set. */
  repos: RepoPushAccess[];
}

export interface SetCredentialBody {
  token: string;
}

export type TicketSourceType = 'built_in' | 'github_issues' | 'jira';

export type StatusCategory = 'open' | 'in_progress' | 'done';

export type BuiltInTicketStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';

export interface TicketSource {
  id: string;
  workspaceId: string;
  type: TicketSourceType;
  /** For display, e.g. `owner/repo` or `Built-in`. */
  label: string;
  /** Null for `built_in`. */
  scope:
    | { githubOwner: string; githubRepo: string }
    | { jiraSite: string; jiraProject: string; jiraEmail: string }
    | null;
  /** Same as `credential.isSet`. */
  hasCredential: boolean;
  /** Always not set for `built_in`. */
  credential: CredentialStatus;
  defaultLinkedRepoId: string | null;
  /** Only ever true on a `built_in` source with no connected sources alongside it. */
  canCreateTickets: boolean;
  disconnectedAt: string | null;
  createdAt: string;
}

/** The `jira` type is in the contract but rejected until it's built. */
export type ConnectSourceBody =
  | {
      type: 'github_issues';
      githubOwner: string;
      githubRepo: string;
      token?: string;
      defaultLinkedRepoId?: string;
    }
  | {
      type: 'jira';
      jiraSite: string;
      jiraProject: string;
      jiraEmail: string;
      token: string;
      defaultLinkedRepoId?: string;
    };

export interface UpdateSourceBody {
  /** Replaces the stored credential; null removes it. */
  token?: string | null;
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

export interface TicketSummary {
  sourceId: string;
  /** Unique only within its source, e.g. `owner/repo#123` or `T-12`. */
  key: string;
  title: string;
  /** The tracker's own status name. */
  status: string;
  statusCategory: StatusCategory;
  /** Null for a built-in ticket, which has no external page. */
  url: string | null;
  updatedAt: string;
}

export interface Ticket extends TicketSummary {
  body: string;
}

export type TicketCategoryFilter = StatusCategory | 'not_done' | 'all';

export interface TicketQuery {
  search?: string;
  /** Defaults to `not_done`. */
  category?: TicketCategoryFilter;
  /** Defaults to true. */
  mine?: boolean;
  cursor?: string;
}

export interface TicketPage {
  items: TicketSummary[];
  nextCursor: string | null;
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

/** What a phase may do beyond the baseline scope, which applies to every session and isn't stored. */
export interface PhaseScope {
  /** False for read-only phases; a session that changes code anyway gets the `code_changed` flag. */
  mayChangeCode: boolean;
}

export interface StopCondition {
  /** Relative to the worktree root and always under `.slop/`, e.g. `.slop/plan.md`. */
  requiredArtifactPath: string;
}

export interface PhaseSetup {
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

export interface UpdatePhaseSetupBody {
  instruction?: string;
  userLevelSource?: boolean;
}

/** The phase setup as it was when a session started. */
export interface SessionSetup {
  instruction: string;
  scope: PhaseScope;
  stopCondition: StopCondition;
  userLevelSource: boolean;
}

export type ScopeFlag = 'code_changed';

/** An earlier phase's artifact given to a session. */
export interface InputArtifact {
  /** The session that produced it. */
  sessionId: string;
  round: number;
  phase: LaunchablePhase;
  /** Where it's written in the new worktree, e.g. `.slop/context/investigation.md`. */
  path: string;
}

export interface NextPhaseSuggestion {
  /** Null once code review is done. */
  phase: LaunchablePhase | null;
  /** One line for the dashboard, e.g. "Investigation is complete." */
  reason: string;
}

export interface LaunchPreview {
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

export interface StartSessionBody {
  phase: LaunchablePhase;
  /** Overrides the preselected repo. */
  linkedRepoId?: string;
}

export interface SendMessageBody {
  message: string;
}

export interface Session {
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
  /** True when the base couldn't be fetched before the worktree was created, so it may be behind. */
  baseFetchFailed: boolean;
  inputArtifacts: InputArtifact[];
  /** Empty unless the session went beyond its scope. */
  scopeFlags: ScopeFlag[];
  /** Null again once a follow-up restores the worktree. */
  worktreeRemovedAt: string | null;
  /** Set once the runtime reports it. */
  runtimeSessionId: string | null;
  /** Null until known; see S1-05. */
  transcriptPath: string | null;
  /** Null while the session is active, once its worktree is removed, or with no runtime session ID. */
  resumeCommand: string | null;
  /** Null while a round is running; otherwise whether the latest round produced the required artifact. */
  artifactStatus: ArtifactStatus | null;
  startedAt: string;
  /** Null while a round is running. */
  endedAt: string | null;
}

export interface SessionArtifact {
  sessionId: string;
  /** Starts at 1; a later round adds a new copy rather than replacing this one. */
  round: number;
  /** Where the agent wrote it, relative to the worktree root, e.g. `.slop/investigation.md`. */
  path: string;
  markdown: string;
  createdAt: string;
}

export type RuntimeEvent =
  | { type: 'session_started'; runtimeSessionId: string; transcriptPath: string | null }
  | { type: 'session_ended'; outcome: 'success' | 'error' | 'stopped'; message: string | null };

/** The baseline scope has no field, because the runtime always applies it. */
export interface RuntimeSetup {
  permissionMode: 'auto';
  scope: PhaseScope;
  userLevelSource: boolean;
}

export type RuntimeReadiness =
  | { ready: true }
  /** `message` says what to fix on the host, e.g. "Claude Code isn't signed in. Run `claude auth login`." */
  | { ready: false; message: string };

export interface RuntimeStartInput {
  brief: string;
  /** The worktree path. */
  cwd: string;
  setup: RuntimeSetup;
}

export interface RuntimeResumeInput {
  runtimeSessionId: string;
  message: string;
  cwd: string;
  setup: RuntimeSetup;
}

export interface RuntimeHandle {
  /** Ends after `session_ended`, or early if the runtime dies. */
  events: AsyncIterable<RuntimeEvent>;
  /**
   * @return resolves once the runtime has been asked to stop; safe to call more than once
   * Stops the underlying process. `events` then yields `session_ended` with outcome `stopped`.
   */
  stop(): Promise<void>;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  /** The commit the worktree started from. */
  baseCommit: string;
}

export interface CreateWorktreeInput {
  /** Root of the linked clone. */
  repoPath: string;
  /** e.g. `origin/main`. */
  baseRef: string;
  workspaceId: string;
  ticketKey: string;
  sessionId: string;
}

export type DraftedActionType = 'open_pr' | 'ticket_comment' | 'ticket_transition';

export type DraftedActionStatus = 'pending' | 'rejected' | 'dispatching' | 'succeeded' | 'failed';

export interface OpenPrPayload {
  title: string;
  /** Markdown. */
  body: string;
  /** The linked repo's default branch. Not editable. */
  baseBranch: string;
  /** The session's branch. Not editable. */
  headBranch: string;
}

export interface OpenPrResult {
  number: number;
  url: string;
  /** The commit that was pushed. */
  commit: string;
}

export interface TicketCommentPayload {
  /** Markdown. */
  body: string;
}

export interface TicketCommentResult {
  /** Null for a built-in ticket, which has no external page. */
  url: string | null;
}

export interface TicketTransitionPayload {
  /** The tracker's own status name, e.g. `In review`. */
  toStatus: string;
}

export interface TicketTransitionResult {
  /** The ticket's status after the move. */
  status: string;
}

export interface DraftedActionBase {
  id: string;
  workspaceId: string;
  sessionId: string;
  ticketSourceId: string;
  ticketKey: string;
  /** The ticket's title when the session started. */
  ticketTitle: string;
  /** The session's phase. */
  phase: Phase;
  /** The session round that drafted it, or last redrafted it. */
  round: number;
  status: DraftedActionStatus;
  /** True once the developer has changed the payload; a later round then leaves it alone. */
  edited: boolean;
  /** Why the last dispatch failed; null otherwise. */
  error: string | null;
  createdAt: string;
  updatedAt: string;
  /** When it was approved or rejected; null while pending. */
  decidedAt: string | null;
  /** When the last dispatch finished; null if none has. */
  dispatchedAt: string | null;
}

/** `result` is null until the action has succeeded. */
export type DraftedAction = DraftedActionBase &
  (
    | { type: 'open_pr'; payload: OpenPrPayload; result: OpenPrResult | null }
    | { type: 'ticket_comment'; payload: TicketCommentPayload; result: TicketCommentResult | null }
    | {
        type: 'ticket_transition';
        payload: TicketTransitionPayload;
        result: TicketTransitionResult | null;
      }
  );

/** Only the editable fields of the action's type are accepted. */
export type UpdateDraftedActionBody =
  { title?: string; body?: string } | { body?: string } | { toStatus?: string };

export interface ApproveActionBody {
  /** Required for `open_pr`: the head commit the developer was shown. */
  expectedHeadCommit?: string;
}

export interface TicketTransition {
  /** The tracker's own status name. */
  status: string;
  category: StatusCategory;
}

export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface DiffFile {
  path: string;
  /** Set when `status` is `renamed`; null otherwise. */
  previousPath: string | null;
  status: DiffFileStatus;
  /** Null for a binary file. */
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  /** Unified diff text; null for a binary file or one left out for size. */
  patch: string | null;
}

export interface UncommittedFile {
  path: string;
  state: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
}

export interface SessionDiff {
  /** The commit the diff is taken against. */
  baseCommit: string;
  headCommit: string;
  commitCount: number;
  files: DiffFile[];
  /** True when at least one file's diff text was left out for size. */
  truncated: boolean;
  /** Null when the worktree was removed. */
  uncommitted: UncommittedFile[] | null;
}

/** What a branch holds right now, read when the action is opened. */
export interface BranchState {
  headCommit: string;
  /** Commits since the commit the session started from. */
  commitCount: number;
  /** Null when the worktree was removed. */
  uncommitted: UncommittedFile[] | null;
}

export interface DraftedActionDetail {
  action: DraftedAction;
  /** For `open_pr`; null for other types. */
  branch: BranchState | null;
  /** For `ticket_transition`: the statuses the ticket can move to now. Null for other types, and when the source can't be read. */
  transitions: TicketTransition[] | null;
}
