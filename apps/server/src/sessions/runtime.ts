import type {
  RuntimeHandle,
  RuntimeReadiness,
  RuntimeResumeInput,
  RuntimeStartInput,
} from '@slop-control/shared';

/** Neutral about the tool: only the Claude Code runtime knows about the Agent SDK (FR-8). */
export abstract class SessionRuntime {
  /**
   * @return whether a session can start now, with a message saying what to fix if not
   * Checks the host's setup without starting a session. Never throws for a missing or signed-out tool.
   */
  abstract checkReady(): Promise<RuntimeReadiness>;

  /**
   * @params input: the brief, the worktree to run in, and the runtime setup
   * @return a handle for the new session's events and for stopping it
   * Starts a new headless session. Start failures surface through the returned events.
   */
  abstract start(input: RuntimeStartInput): RuntimeHandle;

  /**
   * @params input: the session to continue, the new message, and its original worktree
   * @return a handle for the resumed session's events and for stopping it
   * Continues an existing session with its context kept.
   */
  abstract resume(input: RuntimeResumeInput): RuntimeHandle;
}
