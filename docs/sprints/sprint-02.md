---
title: "Sprint 2 — Safe on a real repo"
summary: "Limit each session to its phase's scope, add ticket sources and the built-in tracker, and work a real ticket from investigation to a reviewed implementation."
---

# 🏃 Sprint 2 — Safe on a real repo

| | |
|---|---|
| **Dates** | 2026-11-04 → 2026-11-17 (2 weeks) |
| **Capacity** | Solo, part-time (A-6): about **10 focus days** |
| **Status** | Planned |

## 🎯 Sprint goal

> **Run a real ticket on a real repo from investigation through to a reviewed implementation, with each session limited to its phase's scope.**

[Sprint 1](../sprint-01/) proved the path from ticket to session to result, but only on throwaway repos. Agents can still act through the host's `gh` and `git` logins (finding F6 in the [e2e report](../../reports/sprint-01-e2e/)), and auto mode approved a `git push --force` in the [S1-04 spike](../../spikes/s1-04-headless-resume/). Closing that gap comes first, because it decides whether the app can be used on real work.

## 📦 Backlog

Estimates are in focus days (d). Items marked **must** carry the sprint goal; items marked **stretch** only start once every must item is done.

Sprint 1's must items took far less time than estimated, so these estimates may also run high.

### 0. Spike (time-boxed, ends in a short note under `docs/spikes/`)

| ID | Item | Est. | Priority | Refs |
|---|---|---|---|---|
| **S2-01** | **Scope enforcement spike.** Find what actually stops `gh`, `git push`, and SSH (hooks, sandbox, or environment) while still allowing local commits and dependency installs. Auto mode's classifier can't be relied on for this. | 0.5 | must | F6, FR-14 |

### 1. Phase scopes

| ID | Item | Est. | Priority | Refs |
|---|---|---|---|---|
| **S2-02** | **Phase setups v0.** Stored per workspace, with a scope and a stop condition, replacing the hard-coded `phases.ts`. The setup used is recorded on the session. | 1.5 | must | FR-14, FR-16, FR-10 |
| **S2-03** | **Enforce scope in the runtime.** Apply the spike's result, and flag code changes made by read-only phases. Closes F6. | 1 | must | F6, FR-27 |
| **S2-04** | **User-level source off by default.** Sessions stop inheriting `~/.claude`. | 0.5 | must | FR-41, A-11 |

### 2. Ticket sources

| ID | Item | Est. | Priority | Refs |
|---|---|---|---|---|
| **S2-05** | **Ticket source model and migration.** Adapters resolve from a source, sessions store source and key, and each existing linked repo becomes a GitHub Issues source. A session's repo is preselected, and can be changed before launch. | 1 | must | FR-6a, FR-6b, FR-6d, FR-11a, [ADR-0003](../../adr/0003-ticket-sources-and-built-in-tracker/) |
| **S2-06** | **Combined ticket view.** All sources in one list, with a source filter and per-source errors. | 0.5 | must | FR-6c |
| **S2-07** | **Built-in tracker.** Create and edit tickets in the dashboard, with no setup. | 1 | must | FR-6e, FR-6f, FR-6g |

### 3. Working across phases

| ID | Item | Est. | Priority | Refs |
|---|---|---|---|---|
| **S2-08** | **Follow-up message** (S1-14 carried over). Resume a finished session from the dashboard, using the contract in the Sprint 1 spec. Also lets an incomplete session be continued from the dashboard. | 1 | must | FR-12, FR-23 |
| **S2-09** | **Pass earlier phases' artifacts into new sessions**, so planning can see the investigation. | 0.5 | must | Sprint 1 spec |
| **S2-10** | **Next-phase suggestion.** Rule-based, using the default order. Testing phases are skipped until they can be launched. | 0.5 | must | FR-17 |
| **S2-11** | **Read-only pre-launch view** of the resolved repo and setup. Adjusting the setup waits for the agents and skills manager. | 0.5 | must | FR-18 (partial) |

### 4. Test coverage

| ID | Item | Est. | Priority | Refs |
|---|---|---|---|---|
| **S2-12** | **Keep the browser e2e run in the repo** as an opt-in test. These runs found most of Sprint 1's bugs, but their scripts were throwaway files. | 1 | must | Sprint 1 e2e report |

**Must total: about 9.5 d**

### 5. Stretch

| ID | Item | Est. | Refs |
|---|---|---|---|
| **S2-13** | Project knowledge MCP: Q&A pairs in the dashboard, attached to every session. | 1.5 | FR-24, FR-25, FR-26 |
| **S2-14** | Usage v0 (S1-15 carried over): per-session token totals from the transcript. | 1 | FR-44, FR-48 |
| **S2-15** | Install dependencies in a new worktree. No requirement covers this yet, so add one first. | 0.5 | Sprint 1 spec |

## 🚫 Not in this sprint

The Jira adapter and stored per-source credentials, which come later. GitHub Issues sources keep using the server's `GITHUB_TOKEN` for now, so A-5 stays open · the test environment (FR-64 to FR-67), which waits for the testing phases · plans · drafted actions and approvals · code editor and annotations · testing phases and inspection hooks · the agents and skills manager · the full ambient setup view · remote-host deployment.

## ✅ Definition of done

- Lint, typecheck, and tests pass, and the new opt-in browser run passes.
- A session's scope is enforced, not only stated in its brief. A test proves that a session can't push or use `gh` through the host's logins.
- Existing workspaces keep their tickets and sessions after the migration.
- No credential appears in a worktree, session record, transcript copy, or log line (NFR-4).
- The spike has a note that ends with a clear **confirmed / disproved / partly** verdict.

## 🎬 Demo script (end of sprint)

1. Create a workspace, link a real repo, and create a ticket in the built-in tracker.
2. Check the resolved repo and setup in the pre-launch view, then start an *investigation* session.
3. Follow the next-phase suggestion to *planning*. The session can see the investigation.
4. Continue to *implementation*, send a follow-up message from the dashboard, then run *code review*.
5. Confirm that a session asked to run `gh` or `git push` is blocked, and that nothing reached GitHub.
6. Connect a GitHub Issues source, and see its tickets listed beside the built-in ones.

## ⚠️ Risks

| Risk | Mitigation |
|---|---|
| Nothing reliably stops the host's logins | S2-01 runs first. If it fails, real repos stay off limits and the rest of the sprint is re-planned. |
| Blocking the network also blocks dependency installs | S2-01 tests both together. |
| The ticket source migration breaks existing sessions | Cover it with a test that upgrades a workspace with existing sessions. |
| New requirements and the ticket sources design are still settling | Confirm the open ticket source decisions before starting S2-05. |

## 📝 Open questions on the test environment

Settle these before specifying the testing phases:

- **Secrets in transcripts.** An agent can print a variable, and Claude Code writes the transcript, so NFR-4 and FR-67 conflict.
- **Terminal resume.** The FR-13 command starts without the variables and gets around FR-66's check.
- **Inference.** FR-10b links every session to a ticket, but inference (FR-65) runs at workspace level, with no worktree specified.
- **Manual test cases.** FR-64 mentions them, but FR-51 only has *automated* and *e2e*. It's also unclear whether automated testing sessions get the variables.
- **Secret storage.** FR-67's encryption at rest depends on A-5.
