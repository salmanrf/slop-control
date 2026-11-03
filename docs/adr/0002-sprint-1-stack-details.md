---
title: "ADR-0002 — Sprint 1 stack details"
summary: "Plain pg for data access, NestJS 11 and TypeScript 5.9 for Jest, and a hand-written SSE route for heartbeats."
---

# ADR-0002: Sprint 1 stack details

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

ADR-0001 left the data-access library to S1-03. Building the scaffold raised two more questions: which framework versions work with the Jest setup the sprint plan asks for, and whether `@Sse` can carry the status stream's contract.

## Decision

| Question | Choice | Why |
|---|---|---|
| Data access | **`pg`** with SQL in one store per area | The server alone holds database credentials, so PostgREST through supabase-js adds nothing. Direct access also gives Postgres error codes, which the duplicate checks rely on. |
| NestJS | **11**, not 12 | Nest 12 is ESM-only, which conflicts with the server's CommonJS Jest setup. |
| TypeScript | **5.9**, not 7 | `ts-jest` needs a version below 7, and `typescript-eslint` needs one below 6.1. |
| Status stream | **A plain route that writes SSE frames**, not `@Sse` | The contract asks for heartbeat comments, and `@Sse` only sends message events. |
| JWT checks | **JWKS by default**, or a shared secret if `SUPABASE_JWT_SECRET` is set | Local Supabase signs with ES256 and publishes its key as a JWKS. |

The Agent SDK is ESM-only, so the CommonJS server loads it with a dynamic `import()`. Its version is pinned, because the runtime depends on undocumented behaviour found in [S1-04](../spikes/s1-04-headless-resume/).

Row level security is on with no policies, so the Supabase keys the browser holds can't read any table.

## Consequences

- Moving to Nest 12 means moving the server and its tests to ESM. That's easier with Vitest than with Jest.
- SQL is written by hand, and table shapes stay inside the stores.
- `ApiErrorCode` gains `INTERNAL_ERROR`, because every error body must be an `ApiError` and the spec's list has no code for unexpected failures.
