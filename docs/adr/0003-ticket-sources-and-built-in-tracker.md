---
title: "ADR-0003 — Ticket sources and the built-in tracker"
summary: "Workspaces connect any number of ticket sources, separately from repos, and fall back to a built-in tracker that stores its own tickets."
---

# ADR-0003: Ticket sources and the built-in tracker

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

The MVP treated tickets as always living in an external tracker, and the workspace never stored them. Sprint 1 went further: each linked repo was also its own ticket source, so a ticket's key decided which repo a session ran in.

That model has two gaps:

- A workspace may need tickets from several places, and a Jira ticket names no repo.
- A developer with no tracker, or who hasn't connected one yet, can't start any work, because every session needs a ticket.

## Decision

- **Zero or more ticket sources per workspace.** A source is one scope in one tracker, such as a Jira project or one repo's GitHub Issues, with its own credentials (FR-6a, FR-6b).
- **Connecting a source is separate from linking a repo.** If linking a GitHub repo still connected its Issues, every workspace would have a tracker and the built-in one would never be used.
- **A built-in tracker sits behind the same adapter interface** (FR-4, FR-6e). It is the only case where the workspace stores tickets and is their source of truth. Tickets from connected sources are still never stored.
- **Connecting the first source stops new built-in tickets, but keeps the existing ones workable** (FR-6g). Tickets are not migrated, so the two kinds never compete to own the same work.
- **Tickets don't determine repos.** A session's repo is preselected where it can be and chosen before launch otherwise (FR-11a). A plan targets one repo, so work spanning several gets one plan per repo (FR-10d).

We rejected requiring a connected tracker, because it blocks a new workspace on setup. We rejected a GitHub Issues fallback, because it would still need credentials and would write the developer's private tickets to GitHub. We also rejected keeping the built-in tracker fully available alongside connected sources, because that invites a second backlog. OQ-17 keeps this open.

## Consequences

- The tracker adapter resolves from a ticket source instead of a linked repo, so Sprint 1's `TrackerAdapterFactory.forRepo` has to change.
- Ticket keys are only unique within a source, so sessions and later records must store a source alongside `ticket_key`.
- Existing workspaces need a migration: each linked repo becomes a GitHub Issues source, so their tickets and sessions keep working.
- The ticket view merges several sources, so it needs paging across them and has to handle one source failing while the others work (FR-6c).
- Built-in tickets are only visible in the dashboard, so teammates can't see them (A-2).
- Moving built-in tickets to a connected tracker stays open (OQ-16).
