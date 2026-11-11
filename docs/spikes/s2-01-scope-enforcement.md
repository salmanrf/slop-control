---
title: "S2-01 — Scope enforcement"
summary: "Not run yet. The mechanism the runtime applies was chosen from the Agent SDK's documented options, and no real session has tested it."
---

# S2-01: Scope enforcement

**Status on 2026-11-11: not run.** The baseline scope was built against `@anthropic-ai/claude-agent-sdk` 0.3.316 from its type definitions and option docs, without starting a real session. Nothing below is a result until the smoke test's scope cases (SM-01 to SM-10) have run on a throwaway clone with planted logins.

## Verdict: none yet

The spike ends with **confirmed / disproved / partly** once the experiments below have run. Until then, real repos stay off limits, and the README's warning stays as it is.

## What the runtime applies

All of it lives in `apps/server/src/sessions/baseline-scope.ts`, and is the same for `start` and `resume` in every phase. No field of a phase setup reaches it.

| Layer | What it does | Can the agent undo it from a shell? |
|---|---|---|
| Sandbox (`sandbox.enabled`, `allowUnsandboxedCommands: false`) | Runs the agent's commands in Claude Code's sandbox. Denies `github.com` and `*.github.com`, allows a short list of package registries, denies reads of `~/.ssh`, `~/.config/gh`, `~/.git-credentials`, `~/.netrc`, and the macOS keychain folder, and allows writes to the linked clone's git folder. | No, if the sandbox holds. This is the layer the rest depends on. |
| `failIfUnavailable: true` | The session ends with an error when the sandbox can't start. | No |
| `strictMcpConfig`, empty `mcpServers`, `disableClaudeAiConnectors` | Keeps out connectors from the developer's Claude account, the repo's `.mcp.json`, and user-level MCP servers. | No |
| Deny rules in flag settings and managed settings | Denies `git push`, `gh`, `ssh`, `scp`, `sftp`, reads of the credential paths, and fetching GitHub. | A disguised command gets past the rule, not past the sandbox. |
| Environment | Clears git's credential helpers, points `gh` at a config folder that doesn't exist, makes git's SSH command and askpass fail, and turns off prompts. | Yes |
| Pre-tool hook | Denies the plain forms of the commands above and any `mcp__` tool, with a reason the agent can read. | Yes, by disguising the command |

`checkReady` also reports not ready when the host has no sandbox (`sandbox-exec` on macOS, `bwrap` and `socat` on Linux), so a launch is refused before a worktree exists.

## Questions still open

Each is one of the spec's nine. None has been answered by an experiment.

| Question | What the code assumes | How to find out |
|---|---|---|
| What stops `git push`, `gh`, and SSH when the agent tries to get around it? | The sandbox's network rules and credential read rules. | SM-01 to SM-04 |
| Do local commits still work? | Yes, because the clone's git folder is added to `allowWrite`. | SM-06 |
| Do dependency installs still work? | Yes, for the registries in the allowlist. Whether a domain outside it is refused or only prompts isn't known, and package managers may need cache folders outside the worktree. | SM-07 |
| Can a session still reach account connectors? | No, with `disableClaudeAiConnectors` and `strictMcpConfig`. A-11 says the user-level source switch alone doesn't remove them. | SM-10 |
| Can a repo's own settings, hooks, or `.mcp.json` loosen it? | No: flag settings outrank project settings, and `.mcp.json` is ignored. Whether a project setting can switch the sandbox off isn't known. | SM-09 |
| Can the runtime tell in advance that enforcement isn't available? | Only that the sandbox's tools exist on the host. | RT-08, and SM-15 on a host without them |
| Does it hold on resume? | The same options are passed. | SM-08 |
| How can a test plant fake logins? | A temporary `HOME` with a fake `gh` login, SSH key, and git credential, with `CLAUDE_CONFIG_DIR` pointing at the real Claude Code config so sign-in still works. That last part is untested. | The smoke test's guard and its control run |
| Can writes be cheaply limited to `.slop/` for read-only phases? | Not attempted. Read-only phases are flagged, not blocked. | A sandbox `denyWrite` on the worktree with `.slop/` allowed |

## Known gaps

- **The macOS keychain.** `git` and `gh` can both read tokens from it through a system service, not a file. The environment clears git's helper and hides `gh`'s config, but whether the sandbox blocks the keychain service itself isn't known. The GitHub network rule is what's expected to stop a push that does find a token.
- **Remotes that aren't GitHub.** Linked repos must have a GitHub origin, but a session could add another remote. Only the network allowlist would stop a push to it.
- **The registry allowlist is a guess.** It covers npm, Yarn, PyPI, crates.io, Go, and RubyGems. A project that installs from anywhere else will fail until the list becomes a setting.
- **Managed settings.** The SDK drops `managedSettings` on a machine with its own admin-managed tier unless that tier opts in, so the flag settings are what the code relies on.

## What to run

1. The control run from the test plan: with the baseline scope switched off in a local build, SM-01 must reach the recording remote. That shows the remote and the planted logins can detect a push at all.
2. `npm run test:smoke -w @slop-control/server` on macOS.
3. Record the results in this note, replace the status and verdict above, and update A-11 and OQ-8 with what was found about connectors and auto memory.
