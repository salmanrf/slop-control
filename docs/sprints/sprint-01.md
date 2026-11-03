---
title: "Sprint 1 — Walking skeleton"
summary: "First sprint: launch one tracked Claude Code session for a ticket, in its own worktree, from the dashboard."
---

# 🏃 Sprint 1 — Walking skeleton

| | |
|---|---|
| **Dates** | 2026-11-02 → 2026-11-15 (2 weeks) |
| **Capacity** | Solo, part-time (A-6): about **10 focus days** |
| **Status** | Planned |

## 🎯 Sprint goal

> **Start a Claude Code session for a GitHub issue from the dashboard. It runs in its own git worktree, its status updates in the browser live, and when it finishes you can read its markdown result and see it in that ticket's session history.**

Nothing exists yet but docs, so this sprint builds the thinnest path through the whole system: **workspace → repo → ticket → session → history**. It also checks the two assumptions that the rest of the MVP depends on most:

- **A-8**: a headless session can be resumed with new input. Correction rounds (FR-35) need this.
- **A-10**: per-message usage can be read from the transcripts on disk. Token usage (FR-44–48) needs this.

If either one turns out to be false, we need to know now, before the design builds on it.

## 📦 Backlog

Estimates are in focus days (d). Items marked **must** carry the sprint goal; items marked **stretch** only start once every must item is done.

### 0. Foundations

| ID | Item | Est. | Priority | Refs |
|---|---|---|---|---|
| **S1-01** | ✅ **ADR-0001: tech stack** ([decided](../adr/0001-tech-stack/)). NestJS backend, React + Vite + TanStack Router/Query frontend, Claude Agent SDK (TS), Supabase. | — | done | NFR-3, NFR-7, FR-8 |
| **S1-02** | **Repo scaffold.** npm workspaces with `apps/server` (NestJS), `apps/web` (React + Vite + TanStack Router/Query) and `packages/shared`. Lint/format/typecheck, Jest in the server and Vitest in the web app, and one `npm run dev` that starts both. Local Supabase through the Supabase CLI. | 1 | must | NFR-5 |
| **S1-03** | **Supabase schema v0 + auth.** Tables `workspace`, `linked_repo`, `session`, `session_artifact`, with migrations checked in. Supabase sign-in in the web app and a Nest guard that checks the JWT. Choose the data-access library. | 1 | must | NFR-3, NFR-7, FR-3 |

### 1. Spikes (time-boxed, each ends in a short note under `docs/spikes/`)

| ID | Item | Est. | Priority | Refs |
|---|---|---|---|---|
| **S1-04** | **Headless resume spike.** Start a session through the Agent SDK, end it, then resume it with a new prompt. Check that the context is kept and that `claude --resume <id>` in the worktree continues the same session. Also confirm that auto mode is available, how to detect a fallback to manual mode, that a denied call doesn't stall a session, and that the SDK runs with the host's existing Claude Code setup. | 0.5 | must | A-8, FR-13, FR-35 |
| **S1-05** | **Transcript usage spike.** Find where transcripts and sub-agent files live, parse per-message usage, model, and peak context fill, and compare the totals with the SDK's end-of-run result. | 0.5 | must | A-10, FR-44, FR-48 |

### 2. Walking skeleton

| ID | Item | Est. | Priority | Refs |
|---|---|---|---|---|
| **S1-06** | **Workspace selector + create workspace.** The app opens on the selector, and sessions are blocked until a workspace exists. | 0.5 | must | FR-1 |
| **S1-07** | **Link a repo.** Point the workspace at a local clone (A-4), check that it is a git repo with a GitHub remote, and require at least one. | 0.5 | must | FR-2, A-4 |
| **S1-08** | **Tracker adapter interface + GitHub Issues adapter (read only).** List/search and read details. No writes this sprint, and no ticket rows stored in the DB. | 1 | must | FR-4, FR-5, FR-6 |
| **S1-09** | **Ticket view v0.** List the workspace's issues and open one to see its details and its sessions. | 0.5 | must | FR-10f (partial) |
| **S1-10** | **Runtime interface + Claude Code runtime.** `checkReady()`, `start(brief, cwd, setup)`, `resume(id, msg)`, `stop()`, and an event stream. Runs headless in **auto** permission mode, using the host's existing Claude Code setup. Starting a session shows a clear error if Claude Code isn't ready. | 1.5 | must | FR-8, FR-9, FR-15 |
| **S1-11** | **Worktree manager.** Create a worktree per ticket-level session on a `slop/<ticket>/<session>` branch and record its path. Remove it on request. | 0.5 | must | FR-11 |
| **S1-12** | **Launch + live status.** A "Start session" button on a ticket (phase picked by hand for now) launches the runtime. Status changes are pushed to the browser through a Nest `@Sse` endpoint in under ~1 s, with no polling. Agent output isn't streamed. | 1 | must | FR-7, FR-9, NFR-2 |
| **S1-13** | **Session record + history.** Store ticket, phase, worktree, start/end time, status, and transcript path. Show a copyable `cd <worktree> && claude --resume <id>`. | 0.5 | must | FR-10, FR-13 |
| **S1-16** | **Required-artifact check.** Mark the session *complete* or *incomplete* depending on whether its phase's required artifact (such as `.slop/investigation.md`) exists in the worktree. The brief tells the agent where to write it, and `/.slop/` is excluded from git to keep diffs clean. When the session ends, the artifact is copied into `session_artifact`, so it outlasts the worktree. | 0.5 | must | FR-22, FR-23 |
| **S1-17** | **Result view.** Show the session's markdown artifact, rendered and read-only, on the session page. | 0.5 | must | FR-32 (partial) |

**Must total: about 9.5 d**

### 3. Stretch

| ID | Item | Est. | Refs |
|---|---|---|---|
| **S1-14** | Send a follow-up message to a finished session from the dashboard, which resumes it. Depends on the result of S1-04. | 1 | FR-12 |
| **S1-15** | Usage v0: reconcile per-session token totals from the transcript when the session ends, and show them in the history. Depends on the result of S1-05. | 1 | FR-44, FR-48 |

## 🚫 Not in this sprint

Phase setups and the orchestrator (FR-14, FR-17–18) · the agents & skills manager · project knowledge MCP · plans · drafted actions and approvals · code editor and annotations · the testing phases and inspection hooks · ambient setup view · the Jira adapter · remote-host deployment.

For now the session brief is the ticket title and body plus a fixed one-line instruction for the chosen phase.

## ✅ Definition of done

- Lint, typecheck, and tests pass. The runtime, worktree manager, and adapter each have tests against their interface. The Claude Code runtime is tested behind a fake, with one opt-in real smoke test.
- No credential ever appears in a worktree, session record, transcript copy, or log line (NFR-4). The GitHub token comes from env or config for now; where it is stored for good stays open under A-5.
- Each spike has a note that ends with a clear **confirmed / disproved / partly** verdict, and the matching assumption in `requirements.md` is updated.

## 🎬 Demo script (end of sprint)

1. Sign in, create workspace **"slop-control"**, and link this repo.
2. Open a GitHub issue in the ticket view and start an *investigation* session.
3. Watch the status change to *running* without reloading. A new worktree shows up under the workspace's worktree folder.
4. When it ends, the status updates on its own and the session is marked *complete*. Read `.slop/investigation.md` in the dashboard.
5. The ticket shows the session with its status, times, and resume command. Copy the command into a terminal and continue the session there.

## ⚠️ Risks

| Risk | Mitigation |
|---|---|
| The Agent SDK's resume or stream behaviour doesn't match A-8 | S1-04 runs on day 1–2, so S1-10 can be redesigned in time. Fallback: a fresh session given a summary of the earlier one. |
| The transcript layout differs from what A-10 expects | It only blocks the stretch item S1-15. Record the actual layout in the spike note. |
| Auto mode lets a session write outside its worktree | Set the cwd to the worktree. Smoke-test only against a throwaway repo until phase scopes (FR-14) exist. |

## ➡️ Likely Sprint 2

Phase setups with scope and stop conditions, the orchestrator's next-phase suggestion, the pre-launch view, the project knowledge MCP, and the Jira adapter.
