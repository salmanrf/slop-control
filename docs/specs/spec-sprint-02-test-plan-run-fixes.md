---
title: "Spec — Sprint 2: test plan run fixes"
summary: "Fix the one product bug and the four test bugs the Sprint 2 test plan run found, so that lint, typecheck, npm test, and the browser run pass as written."
---

# Spec: Sprint 2, test plan run fixes

Closes the five findings in the [Sprint 2 test plan run](../../reports/sprint-02-test-plan-run/): P1 and T1 to T4. It follows the [Sprint 2 spec](../spec-sprint-02-safe-on-a-real-repo/) and the [Sprint 2 test plan](../../test-plans/test-plan-sprint-02-safe-on-a-real-repo/), and changes one contract from the [Sprint 1 spec](../spec-sprint-01-walking-skeleton/): the stop endpoint.

Three decisions here are recommendations the developer hasn't confirmed. [Further Notes](#further-notes) lists them.

## Problem Statement

As the developer, I stop a running session from its page and the page can keep saying "Running" with the **Stop session** button showing, although the workspace has already recorded the session as `stopped`. Until I reload, I can't send a follow-up or continue the session, and I can't tell whether Stop worked.

I also can't trust the Sprint 2 test plan's result. Two server tests fail and the browser run stops at BR-09, but four of the five causes are faults in the tests, not in the product. A red run that is mostly noise hides the one real bug, and exit criteria 1 and 3 of the test plan stay unmet for reasons that have nothing to do with whether sessions are safe on a real repo.

## Solution

After **Stop**, the session page shows the session as stopped and offers the next action without a reload. Two things make that hold:

- The stop request answers once the round has ended, so its answer says `stopped`.
- The dashboard never lets an older state of a session replace a newer one, whichever of the stop answer and the status stream arrives last.

The four test bugs are fixed where they are, in the tests and the stubs, and the test plan's wording for BR-09 is corrected. After this, lint, typecheck, and `npm test` pass, and the browser run passes BR-01 to BR-16 as written, with none of the report's three workarounds.

## User Stories

### Stopping a session

1. As the developer, I want the session page to show a session as stopped as soon as I stop it, so that I know Stop worked.
2. As the developer, I want the **Stop session** button to go away once the session has stopped and stay away, so that I'm not invited to stop it again.
3. As the developer, I want the page to offer **Continue** or the follow-up form straight after a stop, without a reload, so that I can carry on with the session.
4. As the developer, I want the stop request's answer to say `stopped` when the round ended, so that the answer and the status stream agree.
5. As the developer, I want stopping to stay safe to repeat, so that a second click or a retry does no harm.
6. As the developer, I want stopping a session that has already ended to change nothing, so that a late click doesn't alter its record.
7. As the developer, I want a stop request to answer within a few seconds even when the agent's process is slow to end, so that the page never hangs on Stop.
8. As the developer, I want the page to keep showing "Running" when a slow agent really hasn't ended yet, so that the page never claims a stop that hasn't happened.
9. As the developer, I want the ticket page's session history to show the stopped session as stopped too, so that both views agree.
10. As the developer, I want stopping a follow-up round to behave the same as stopping a first round, so that I don't have to think about which round is running.

### Session status in the dashboard

11. As the developer, I want an older state of a session never to overwrite a newer one in the dashboard, so that the page always shows where the session really is.
12. As the developer, I want this to hold for every answer the dashboard applies, not only Stop, so that a follow-up or a launch can't cause the same stale page.
13. As the developer, I want a session that starts a new round to show as running again, so that the rule against older states doesn't freeze a session at its last terminal status.
14. As the developer, I want a change that doesn't move the status, such as a removed worktree, still to show, so that the rule only drops states that are older.
15. As the developer, I want a reconnect to read every session again from the workspace, so that the page recovers even if a status frame was missed.

### A test run I can trust

16. As the developer, I want `npm test` to pass when the product is right, so that a failure means something.
17. As the developer, I want the no-token test to really ask all six endpoints, so that PS-12 proves each one returns 401 `UNAUTHENTICATED`.
18. As the developer, I want the GitHub stub to answer a single-issue read the way GitHub does, with the issue's web address, so that the tracker contract tests the adapter and not the stub.
19. As the developer, I want one tracker contract to pass for both the built-in tracker and the stubbed GitHub Issues source, so that I know a ticket reads the same from either.
20. As the developer, I want the browser run to stop a round and then use **Continue**, so that BR-09 checks what the page should offer for a stopped, incomplete session.
21. As the developer, I want BR-09 to check the page right after Stop without a reload, so that it catches P1 if it comes back.
22. As the developer, I want the browser run to pick a repo wherever the workspace can't preselect one, so that BR-11 to BR-13 start their sessions the way I would.
23. As the developer, I want the browser run to check that the dashboard asks for a repo when none is preselected, so that LP-05's behavior is covered in the browser as well.
24. As the developer, I want the browser run to pass BR-01 to BR-16 in one go as written, so that exit criterion 3 can be met.
25. As the developer, I want the test plan's BR-09 row to say what the page really offers after Stop, so that the plan and the run agree.
26. As the developer, I want the run report to show each finding as fixed once it is, so that the report stays a true record.

## Implementation Decisions

### Modules

- **Sessions service (changed).** `stop` waits for the stopped round to end before it answers.
- **Session cache in the web app (changed).** Applying a session update keeps the newer of the cached session and the incoming one.
- **Session view in the web app (changed).** Gains the rule that decides which of two states of a session is newer.
- **GitHub stub for the server tests (changed).** A single-issue read is shaped like a listed issue.
- **Phase setups test, the browser run spec, and the test plan (changed).** Test and wording fixes only.

No schema, migration, or shared type changes.

### P1: stop answers when the round has ended

- Cause, as inferred in the report: `stop` tells the runtime to stop and reads the session back straight away. The round's `stopped` event is applied on a separate path, so the read can still say `running`. The page then applies that answer after the `stopped` stream frame and goes back to "Running".
- The first step is to reproduce this at the HTTP seam, since the report saw it once and didn't isolate it: stop a running session whose runtime ends on stop, and check the answer's status. If the answer already says `stopped` every time, the server half of the cause is wrong and only the dashboard half below is built.
- The sessions service keeps each running round's completion reachable by session ID. `stop` tells the runtime to stop, then waits for that round to finish being recorded, then reads the session back.
- The wait is capped at a grace period of 5 seconds. A process that is slow to end must not hold the request open. When the cap is reached the answer is the session as it is, which may still be `running`, and the status stream reports the end when it comes.
- Stop stays safe to repeat. A second stop on a round that is already stopping waits on the same completion and doesn't signal the runtime's handle differently from today.
- Stop on a session that has already ended still answers at once with the session unchanged, and doesn't call the runtime.
- Shutdown doesn't use this wait. It keeps its own handling of slow processes.
- The 401 and 404 answers are unchanged.

### P1: the dashboard keeps the newer state

- Within one round a session's status only moves forward: `starting`, then `running`, then one of `ended`, `failed`, or `stopped`. Across rounds, the round number only goes up. So a session's position is its round, then its place in that order, and the three terminal statuses share one place.
- A state is older than another when its round is lower, or when the rounds match and its status sits earlier in the order.
- Applying a session update drops the incoming session when it is older than the one cached for that session. An incoming session at the same position is applied, so changes that don't move the status, such as a removed worktree or a newly known transcript path, still show.
- The rule covers both places a session is cached: its own entry and its ticket's session list. When the incoming session is dropped, nothing else happens either: the launch previews and the artifact aren't refreshed for it.
- The rule applies to every caller: stream frames, and the answers to stop, follow-up, launch, and worktree removal.
- A refetch isn't subject to the rule. A reconnect reads every session again and replaces what's cached, as today. The workspace is the source of truth, and the rule only orders updates that race each other.
- The rule lives with the other pure session rules in the session view, so it's tested without a query client.

### T1: the no-token test sends one request at a time

- The test lists the six requests as functions that build a request, and builds each one only when the previous one has been answered.
- The expectations are unchanged: every one of the six returns 401 with `UNAUTHENTICATED`.
- No product change. The report confirmed all six endpoints already behave this way.

### T2: the stub's single-issue read matches GitHub

- The stub shapes an issue in one place, used by the list, the search, and the single read, so all three carry the issue's web address.
- The adapter and the tracker contract are unchanged. The real API returns the address on a single read, so the adapter is right to rely on it.
- The stub used by the browser run already returns the address on a single read and isn't changed.

### T3: BR-09 continues a stopped round

- A stopped round wrote no new artifact, so the session is incomplete and the page offers **Continue**, as WEB-04 and BR-11 ask.
- After Stop, BR-09 checks, without a reload: the **Stop session** button is gone, the session shows as stopped, and **Continue** is offered. It then clicks **Continue**, checks the follow-up message is prefilled, sends it, and waits for round 4 to complete.
- The check that the button is gone must hold, not just pass once. BR-09 confirms the stopped status after the button has gone, so a page that flips back to "Running" fails the case.
- The test plan's BR-09 row is reworded: with the keep-running marker, the previous result stays readable during the round, the follow-up form isn't offered, **Stop** ends it, and the stopped session offers **Continue**.

### T4: BR-11 to BR-13 pick a repo

- After BR-07 links a second repo, a new built-in ticket has no session history and its source names no repo, so nothing can be preselected. Asking for the repo is what LP-05 requires, and the product doesn't change.
- The browser run gains a helper that picks a repo in the launch controls by its label. BR-11, BR-12, and BR-13 pick the first linked repo before starting their session.
- BR-11 also checks, before picking, that no repo is selected and the session can't be started yet. This is the browser's view of LP-05.
- The order of the cases doesn't change. BR-07 still links the second repo before BR-08.

### Docs

- The run report's findings table marks each of P1 and T1 to T4 as fixed once its fix is merged, and the results are replaced by a rerun's. The report's verdict changes only if the rerun supports it.
- The test plan changes only in the BR-09 row.

## Contracts

### Endpoints

**(changed)** The answer now waits for the round to end, up to the grace period. Paths, auth, and error answers are the same.

```
POST /workspaces/:workspaceId/sessions/:sessionId/stop
Auth: signed-in user
Path params: workspaceId, sessionId
Responses:
  200: Session. For an active session, sent once its round has ended, so `status` is `stopped`
       (or `ended` or `failed` if the round ended another way first). If the round hasn't ended
       within 5 seconds, sent with the session as it then is. Has no effect if the session has
       already ended.
  401: UNAUTHENTICATED, when the token is missing, invalid, or expired
  404: NOT_FOUND, when the session does not exist in this workspace
```

### Functions & Methods

**(changed)** `stop` now waits for the round's end to be recorded before reading the session back.

```ts
class SessionsService {
  /**
   * @params workspaceId: the workspace; sessionId: the session to stop
   * @return the session once its round has ended, or as it is after the grace period; throws NOT_FOUND if it isn't in this workspace
   * Tells the runtime to stop an active session and waits for the round to be recorded as ended. Does nothing to a session that has already ended.
   */
  stop(workspaceId: string, sessionId: string): Promise<Session>;
}
```

New, in the web app's session view:

```ts
/**
 * @params incoming: a state of a session just received; cached: the state of the same session already held
 * @return true when `incoming` is from an earlier round, or from the same round at an earlier status
 * Orders two states of one session. `ended`, `failed`, and `stopped` count as the same position.
 */
function isOlderSession(
  incoming: Pick<Session, 'round' | 'status'>,
  cached: Pick<Session, 'round' | 'status'>,
): boolean;
```

**(changed)** `applySessionUpdate` now drops an update that is older than what's cached.

```ts
/**
 * @params client: the query client; session: a full session from a stream frame or an API answer
 * @return nothing
 * Writes the session into its own entry and its ticket's list, unless the cached session is newer. Each frame carries the full session, so the cache needs no refetch.
 */
function applySessionUpdate(client: QueryClient, session: Session): void;
```

## Testing Decisions

A good test here checks what the developer or an API client can see: the answer to a request, a frame on the stream, what the page shows. It doesn't check which promise the service waited on or how the cache stores a session.

### Main seam: HTTP API

The session lifecycle suite already drives stop through the HTTP API with the fake runtime. It gains:

- Stopping a running session answers 200 with `status: 'stopped'` and an `endedAt`, with no polling. This is written first and must fail before the fix. If it passes before the fix, the server half of P1's cause is wrong; see [P1](#p1-stop-answers-when-the-round-has-ended).
- The same for a session stopped during a follow-up round, in the follow-up suite beside its existing stop case.
- With the fake runtime set to ignore stop, the request answers 200 within the grace period plus a margin, with `status: 'running'`. The test uses a short grace period, set through the test harness, so it doesn't wait 5 seconds.
- The existing cases stay as they are: safe to repeat, no effect on an ended session, 404 for an unknown session.

PS-12 (T1) and the tracker contract's read-by-key case (T2) are existing tests at this seam and its contract seam. They go green with no new cases.

### Web app

- The session view tests gain the ordering rule as a table: a lower round is older; the same round at an earlier status is older; the three terminal statuses are equal; the same position is not older; a higher round at `starting` is newer than a lower round at any terminal status.
- The session cache tests gain: a `running` update after a `stopped` one in the same round leaves both the session entry and the ticket list at `stopped`, and doesn't refresh the launch previews; a same-position update with a changed field is applied; a `running` update in the next round replaces a `stopped` one.

Prior art: the existing session view and session cache tests, which build partial sessions and a bare query client.

### Browser run

- BR-09 and BR-11 to BR-13 change as described under T3 and T4. No case is added or removed, and the run is not given a reload after Stop.
- BR-09 is the regression check for P1 in the browser. It was the case that exposed it.
- The scripted runtime and the browser run's GitHub stub aren't changed.

### Done means

- Lint, typecheck, and `npm test` pass: the 2 failing server tests pass and nothing else changes state.
- The browser run passes BR-01 to BR-16 as written, three times in a row, since P1 was a race seen once.
- BR-17 and BR-18 still pass.
- Test plan exit criteria 1 and 3 are met. Criteria 2, 6, and 7 are untouched by this spec.

## Out of Scope

- **The smoke test and its control run (SM-01 to SM-15).** Running them is the developer's decision. The baseline scope stays unproven and real repos stay off limits until they pass.
- **The gap in the smoke test's guard.** OpenSSH takes `~/.ssh` from the user record, so the planted home doesn't hide the developer's real keys from `ssh`, and SSH doesn't go through the recording proxy. This needs its own decision before the smoke test is run.
- **DOC-01 to DOC-03.** The S2-01 note's verdict, the README warning, and the by-hand demo step.
- **Putting test plan IDs on the server tests.** The report couldn't check cases one by one because most tests don't carry them. Worth doing, but not needed to make the run pass.
- **A version or sequence number on `Session`.** The round and status are enough to order the states that race today.
- **Changing what a stopped session offers.** A stopped round stays incomplete and offers **Continue**.
- **Preselecting a repo for a new built-in ticket in a workspace with several repos.** LP-05 says to ask.
- **Optimistic UI for Stop.** The page shows stopped when the workspace says so.

## Further Notes

- **Decided while writing this spec, not discussed.** Each is cheap to change now:

| Decision | Why |
|---|---|
| P1 is fixed on both sides, the server and the dashboard | The server fix makes the stop answer true for any client. The dashboard fix holds whichever message arrives last, and covers a slow process that outlasts the grace period. Either one alone would clear BR-09. |
| The grace period is 5 seconds | Long enough for a process to end in the normal case, short enough that the page doesn't appear to hang. It hasn't been measured against a real Claude Code session; SM-15's stop case will show whether it's enough. |
| T4 is fixed by picking a repo in the test, not by reordering the cases | It's what the developer would do, and it adds browser coverage of LP-05. |

- **P1's cause is still inferred.** The HTTP test in [Testing Decisions](#testing-decisions) is the check. The dashboard rule is worth building either way, because any answer that races a stream frame has the same problem.
- **A stale answer can also come from a follow-up.** The follow-up answer says `running` in the new round. If that round ended before the answer arrived, today's cache would go back to "Running" in the same way. The ordering rule covers it.
- **The ordering rule assumes a round's status never moves backwards.** That holds today. Restart recovery moves an active round to `failed`, which is forward. If a later sprint lets a terminal round reopen without a new round number, this rule has to change with it.
- **The report's 16 of 16 came from a throwaway copy with workarounds.** After this spec the same result must come from the committed browser run, with the reload after Stop gone.
