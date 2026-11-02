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

export interface TicketSummary {
  /** Opaque to everything but its adapter, e.g. `owner/repo#123`. */
  key: string;
  title: string;
  /** The tracker's own status name. */
  status: string;
  url: string;
  updatedAt: string;
}

export interface Ticket extends TicketSummary {
  body: string;
}

export interface TicketQuery {
  search?: string;
  state?: 'open' | 'closed' | 'all';
  cursor?: string;
}

export interface TicketPage {
  items: TicketSummary[];
  nextCursor: string | null;
}

export interface StartSessionBody {
  phase: LaunchablePhase;
}

export interface Session {
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

export interface RuntimeSetup {
  permissionMode: 'auto';
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
