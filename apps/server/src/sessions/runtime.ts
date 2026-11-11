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
   * Checks the host's setup without starting a session, including whether the baseline scope can be enforced here. Never throws for a missing or signed-out tool.
   */
  abstract checkReady(): Promise<RuntimeReadiness>;

  /**
   * @params input: the brief, the worktree to run in, and the runtime setup
   * @return a handle for the new session's events and for stopping it
   * Starts a new headless session under the baseline scope and the given setup. If the scope can't be enforced, the events end with outcome `error` and a reason saying so. Other start failures surface through the events too.
   */
  abstract start(input: RuntimeStartInput): RuntimeHandle;

  /**
   * @params input: the session to continue, the new message, its worktree, and the setup it started with
   * @return a handle for the resumed session's events and for stopping it
   * Continues an existing session with its context kept, under the same scope rules as `start`.
   */
  abstract resume(input: RuntimeResumeInput): RuntimeHandle;

  /**
   * @params cwd: the worktree a session was running in when the server died
   * @return resolves once any process this runtime left there has been told to stop
   * Ends what a crashed server left behind. Leaves everything else in that folder alone.
   */
  abstract terminateLeftovers(cwd: string): Promise<void>;
}
