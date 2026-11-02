---
title: "S1-05 — Transcript usage"
summary: "Per-message usage can be read from transcripts, per sub-agent. Totals match the SDK except for the tool's own background model calls."
---

# S1-05: Transcript usage

Tested on 2026-11-02 with Claude Code 2.1.316 and `@anthropic-ai/claude-agent-sdk` 0.3.316, against a throwaway repo. The layout is undocumented and may change.

## Verdict: A-10 partly confirmed

Per-message usage, model, and sub-agent files are all on disk. Transcript totals match the SDK for the session's own work, but they leave out small background model calls that the SDK does count.

## Where transcripts live

```
<projectsDirectory>/<encoded cwd>/<sessionId>.jsonl
<projectsDirectory>/<encoded cwd>/<sessionId>/subagents/agent-<id>.jsonl
<projectsDirectory>/<encoded cwd>/<sessionId>/subagents/agent-<id>.meta.json
```

- `projectsDirectory` comes from `claude auth status --json`.
- The encoded `cwd` is the real path with every character outside `[a-zA-Z0-9]` replaced by `-`. For example, `/x/dot.dir_with space/repo` becomes `-x-dot-dir-with-space-repo`.
- A git worktree gets its own folder, keyed by the worktree's path rather than the main clone's.
- Use the real path: on macOS, `/tmp/x` is recorded as `/private/tmp/x`.

The encoding loses information, so two paths can share a folder. Session IDs keep the files apart.

## Reading usage

Each `assistant` line carries `message.id`, `message.model`, and `message.usage`. One API message can span several lines with the same `message.id`, so count each ID once. In this run, 6 lines held 4 distinct messages.

Peak context fill for a message is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. The main thread's peak in this run was 31,423.

## Comparison with the SDK's end-of-run result

One session on `claude-opus-5-5` that spawned one sub-agent on `claude-haiku-5-5`:

| Model | Source | Input | Output | Cache read | Cache write |
|---|---|---:|---:|---:|---:|
| `claude-opus-5-5` | Transcript | 4 | 277 | 33,386 | 20,522 |
| `claude-opus-5-5` | SDK `modelUsage` | 4 | 277 | 33,386 | 20,522 |
| `claude-haiku-5-5` | Transcript | 4 | 614 | 24,015 | 27,693 |
| `claude-haiku-5-5` | SDK `modelUsage` | 1,212 | 630 | 24,015 | 27,693 |

The main thread matches exactly. On `haiku`, cache figures match, but the SDK reports 1,208 more input tokens and 16 more output tokens. A separate session with no sub-agent also reported `haiku` usage in `modelUsage`, so these look like the tool's own background calls, such as session titles or auto mode's classifier. That cause is inferred and wasn't traced.

## What this means for FR-44 to FR-48

- Reconciling from the transcript gives an accurate per-model figure for agent work, including sub-agents.
- It slightly undercounts against the SDK's total. If S1-15 starts, label the source so the two figures aren't expected to match exactly.
- `transcriptPath` is computed as above from the `projectsDirectory` and the worktree's real path. It stays nullable, because the status command can fail.
