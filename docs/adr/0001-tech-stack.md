---
title: "ADR-0001 — Tech stack"
summary: "TypeScript throughout: NestJS backend, React + TanStack frontend, Supabase for auth and Postgres."
---

# ADR-0001: Tech stack

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

Two things are already fixed by the requirements. Supabase provides auth and Postgres (NFR-3, NFR-7), and Claude Code runs headless as the only session runtime (FR-8, FR-9). The rest of the stack has to fit these constraints:

- A **long-running server process** owns child sessions and git worktrees, pushes their status changes within ~1 s (NFR-2) without forwarding agent output (FR-9), and resumes sessions (FR-35).
- The **Claude Agent SDK** and the **MCP SDK** are needed for the built-in project knowledge and inspection servers (FR-24, FR-59). Both SDKs exist for TypeScript.
- The browser UI is rich: a diff editor, line and region annotations, and markdown/JSON/video viewers (FR-31–33, FR-52c).
- One process has to be easy to run on a Mac and on a remote host (NFR-5).

## Decision

**TypeScript end to end, in one npm-workspaces repo.**

| Layer | Choice |
|---|---|
| Backend | **NestJS** on Node. One Nest module per area: `workspaces`, `tickets` (tracker adapters), `sessions` (runtime interface + Claude Code runtime), `worktrees`, `knowledge`, and later `actions`, `testing`, `hooks`. |
| Session runtime | **Claude Agent SDK (TypeScript)**, used behind the runtime interface (FR-8). |
| MCP servers | `@modelcontextprotocol/sdk`, hosted by the backend. |
| Live status | One Server-Sent Events connection per workspace from Nest (`@Sse`) carrying session status changes, not agent output; plain REST for everything else. |
| Frontend | **React + Vite**, with **TanStack Router** for routing and **TanStack Query** for server state. Add TanStack Table where lists need it. |
| Code/diff editor | Monaco (to confirm when FR-31 is built). |
| Auth | Supabase Auth on the frontend. A Nest guard checks the Supabase JWT on every request. |
| Database | Supabase Postgres, with migrations checked in through the Supabase CLI. The data-access library (supabase-js or an ORM) is chosen in S1-03. |
| Shared code | A `shared` package for DTOs and types used by both the server and the web app. |

Repo layout:

```
apps/server   NestJS
apps/web      React + Vite + TanStack
packages/shared
supabase/     migrations, config
```

## Consequences

- One language and one type system across the server, the web app, the MCP servers and the SDK integration.
- Nest's modules and dependency injection fit the many adapter seams: tracker adapters, runtimes, and later hook types. The cost is more boilerplate than a minimal framework.
- No server-side rendering. The web app is a static SPA that the Nest process can serve in production, so a deployment stays one process.
- A Python-only SDK feature would be out of reach unless it is added as a side process.
