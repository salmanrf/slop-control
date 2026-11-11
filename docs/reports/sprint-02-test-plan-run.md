---
title: "Sprint 2 test plan run"
summary: "The first run found one product bug and four test bugs. All five are fixed, and a rerun passed lint, typecheck, every test, and the browser run as written. The real-session smoke test still hasn't run, so the baseline scope is unproven."
---

# Sprint 2 test plan run

**Date:** 2026-11-11 · **Branch:** `feat/sprint-02-safe-on-a-real-repo`, uncommitted work on top of `4937a88` · **Plan:** [Sprint 2 test plan](../../test-plans/test-plan-sprint-02-safe-on-a-real-repo/)

## Verdict

**Everything automated now passes, and the plan still isn't done.** The first run found one product bug and four test bugs. All five were fixed, and the [rerun](#rerun) passed lint, typecheck, the server and web tests, and the browser run as written.

**The smoke test wasn't run**, so SM-01 to SM-10 are unproven and real repos stay off limits. See [Not run](#not-run).

**First run:** lint, typecheck, and the web tests were clean. The server suite had two failing tests, and the browser run stopped at BR-09.

## Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| P1 | Medium | After **Stop**, the session page can stay on "Running" with the Stop button showing, while the server has the session as `stopped` | Fixed, rerun passed |
| T1 | Low | PS-12's test builds all six requests before awaiting any, so every request after the first fails inside supertest | Fixed, rerun passed |
| T2 | Low | The GitHub stub leaves `html_url` off a single-issue read, so the tracker contract's read-by-key case fails | Fixed, rerun passed |
| T3 | Low | BR-09 expects the follow-up form straight after Stop, but a stopped round is incomplete, so the page offers **Continue** | Fixed, rerun passed |
| T4 | Low | BR-11 to BR-13 create tickets after BR-07 links a second repo, so no repo is preselected and the launch never starts | Fixed, rerun passed |

**Fixed after this run, per the [fixes spec](../../specs/spec-sprint-02-test-plan-run-fixes/).** The [Results](#results) below are the first run's; the [Rerun](#rerun) section has the results after the fixes. T1 and T2 were confirmed by their own test files. P1's server half was reproduced through the API before the fix: the stop answer said `running`.

**P1 was seen once and its cause is inferred.** In the unmodified browser run, the database had the session `stopped` at 02:32:44.136 UTC, and the page still showed "Running" 15 seconds later. The Stop button had briefly gone, so the `stopped` stream frame did arrive. The likely cause: `stop` in `apps/server/src/sessions/sessions.service.ts` returns the session before the round has finished, so its response can still say `running`, and the page applies that response after the frame. It wasn't reproduced in isolation.

**T1 to T4 are faults in the tests, not the product.** Each was checked with a corrected throwaway copy of the test, deleted afterwards:

- **T1:** with the requests built one at a time, all six endpoints return 401 `UNAUTHENTICATED`.
- **T2:** the real GitHub API returns `html_url` on a single-issue read; only the stub in `apps/server/test/support/github-stub.ts` doesn't.
- **T3:** showing **Continue** for an incomplete session is what WEB-04 and BR-11 ask for.
- **T4:** asking for a repo when none can be preselected is what LP-05 asks for.

## Rerun

Run on the same day, after the fixes, with nothing worked around.

| Check | Result |
|---|---|
| Lint and typecheck | Clean |
| Web tests | 92 of 92 passed |
| Server tests | 645 passed, none failed, 18 smoke tests skipped by default |
| Browser run, as written | 16 of 16 passed, four times in a row |
| BR-18 | Passed again: the production build and `src/` don't contain the scripted runtime |
| Smoke test and its control run | Not run |

**P1 didn't come back.** BR-09 now waits for the stop request to be answered and then checks that the page hasn't gone back to running. It passed in all four runs. P1 was a race that was seen once, so four passes make it unlikely, not impossible.

## Results

These are the first run's results.

| Check | Result |
|---|---|
| Lint and typecheck | Clean |
| Web tests | 77 of 77 passed |
| Server tests | 641 passed, 2 failed (T1, T2), 18 smoke tests skipped by default |
| Browser run, as written | BR-01 to BR-08 passed, BR-09 failed, BR-10 to BR-16 didn't run |
| Browser run, with workarounds for P1, T3, and T4 in a throwaway copy of the spec | 16 of 16 passed |
| BR-17 | Passed: `npm test` doesn't start the browser run |
| BR-18 | Passed: the production build and `src/` don't contain the scripted runtime |
| Smoke test and its control run | Not run |

The workarounds were: reload the page after Stop, click **Continue** before filling the form, and pick the first repo when none is preselected.

| Plan section | Result |
|---|---|
| Phase setups (PS) | Passed, except PS-12's test (T1). The behavior itself was confirmed. |
| Recorded setup and launch (RS) | Passed, including RS-07 and RS-08 |
| Code change flag (CC) | Passed |
| Earlier artifacts (EA) | Passed |
| Starting point (SP) | Passed |
| Follow-up messages (FU) | Passed, including FU-12 and FU-14 |
| Launch preview (LP) and next phase (NP) | Passed |
| Migration (MG-01 to MG-07) | Passed |
| Ticket sources (TS) | Passed, except the stubbed GitHub read-by-key case (T2) |
| Credentials (CR) | The suites that hold these cases passed |
| `SessionRuntime` contract (RT) | Passed with the stubbed SDK. This shows the options are passed, not that they hold. |
| `WorktreeManager` contract (WT) | Passed |
| Web app (WEB) | Passed |
| Browser run (BR) | Failed as written; see above |
| Smoke (SM) | Not run |

**The cases weren't checked one by one.** Most server tests don't carry plan IDs, so the section results above rest on each suite passing and on its test count matching the plan. The blocking cases RS-07, FU-12, FU-14, MG-02, and RT-05 to RT-08 were each matched to a named test that passed.

## Exit criteria

| # | Criterion | State |
|---|---|---|
| 1 | Lint, typecheck, and `npm test` pass | Met on the rerun |
| 2 | SM-01 to SM-13 and SM-15 pass, after the control run failed as it should | **Not met:** not run |
| 3 | The browser run passes, BR-01 to BR-16 | Met on the rerun |
| 4 | MG-01 to MG-07 pass | Met, on both runs |
| 5 | CR-01 to CR-06 pass | Met by suite, on both runs |
| 6 | DOC-01 to DOC-03 are done | **Not met:** see [Docs checks](#docs-checks) |
| 7 | Every open question is answered or accepted | Not assessed |

## Docs checks

| ID | State |
|---|---|
| DOC-01 | Not done. The S2-01 note exists, but its verdict is "none yet" and none of the nine questions has been answered by an experiment. |
| DOC-02 | Correctly not done. The README still carries the throwaway-repo warning, which stays until SM-01 to SM-10 pass. |
| DOC-03 | Not done. It's the developer's step, by hand. |
| DOC-04 | Partly done. This page covers the browser run. The smoke run has no page because it hasn't happened. |

## Not run

- **The smoke test (SM-01 to SM-15).** It starts a real Claude Code session in auto mode on the host's plan, tells it to try hard to get around the block, and relies on a sandbox that has never been run. It was held back for the developer to decide.
- **The control run.** It needs a local build with the baseline scope switched off, which is a code change.
- **One gap in the smoke test's guard.** OpenSSH takes `~/.ssh` from the user record, not from `HOME`, so the planted home doesn't hide the developer's real keys from `ssh`. SSH also doesn't use the recording proxy. If the sandbox failed, `ssh git@github.com` could authenticate with a real key and go unrecorded. Every remote in the clone is local, so this would be a handshake, not a push.

## Environment

- macOS, Node 24.11.0, local Supabase started for the run.
- The browser run needed a newer Chromium build than was installed (`chromium_headless_shell-1254`), fetched with `npm run e2e:install -w @slop-control/e2e`.
- The browser run used the scripted runtime and the local GitHub stub, so it used no quota and made no request to GitHub or Anthropic (BR-16).
