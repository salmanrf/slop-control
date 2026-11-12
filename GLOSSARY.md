# Slop Control

A personal workspace that tracks AI coding sessions against the tickets they work on, and organizes the work on a ticket into plans.

## Language

### Work structure

**Ticket**:
A unit of work from a ticket source, identified by its source and its key together. The workspace owns it only when that source is the built-in tracker.
_Avoid_: Issue, task, card

**Tracker**:
A system that holds tickets, such as Jira, GitHub Issues, or the built-in tracker.
_Avoid_: Board, ticket system

**Ticket source**:
Where a workspace's tickets come from: the built-in tracker, or a **connected source**, meaning one scope in an external tracker, such as a Jira project or one repository's GitHub Issues. A workspace may have any number of connected sources, and connecting one is separate from linking a repository.
_Avoid_: Integration, connector, ticket provider

**Built-in tracker**:
The simple tracker in every workspace, needing no setup, where tickets are created while the workspace has no connected source.
_Avoid_: Local tickets, internal tracker, native tracker

**Plan**:
One separately shippable part of a ticket, with its own branch and its own PR in one repository. Splitting a ticket into several plans is optional; most tickets have a single plan, and work spanning several repositories has one per repository.
_Avoid_: Approach, track, alternative, sub-ticket

**Plan Item**:
One step within a plan, as written in the plan's plan document.
_Avoid_: Task, step, todo

**Plan document**:
The written description of a plan and its plan items, produced and revised in the planning phase.
_Avoid_: plan.md (when talking about the concept), spec

**Session**:
One AI coding run in one phase and one repository. Always belongs to a ticket, and optionally to one of that ticket's plans.
_Avoid_: Run, job, conversation

**Ticket-level session**:
A session that belongs to the ticket but to no plan.

**Phase**:
A stage of work: investigation, planning, implementation, automated testing, e2e testing, or code review.
_Avoid_: Stage, step

**Round**:
One pass of a session's work. A correction round resumes the same session with the developer's annotations as its brief.
_Avoid_: Iteration, revision

**Annotation**:
A comment the developer anchors to a line or paragraph of a plan document or diff, to be sent back to the agent.
_Avoid_: Comment, review note

### Out the door

**Drafted action**:
An outward-facing action the workspace prepares from a session's round and holds until the developer approves it: an open PR, a ticket comment, or a ticket status change. It can be edited, approved, or rejected on its own.
_Avoid_: Pending action, proposal, suggestion

**Dispatch**:
Carrying out an approved drafted action. The workspace does it, outside any session, and records the result or the error on the action.
_Avoid_: Execute, run

**Approvals inbox**:
The workspace's list of drafted actions waiting on the developer: the pending ones, and the ones whose dispatch failed.
_Avoid_: Queue, notifications

**Credential**:
A token the workspace stores to act on GitHub. A workspace has one for pushing and opening PRs, and each GitHub Issues source has its own for its tickets. A session never holds one. The server's secret store is where credentials are kept.
_Avoid_: Key, password

### Testing

**Automated testing** (phase):
The phase that runs the project's own test suites, and writes new automated tests, to check a plan's test cases.

**E2E testing** (phase):
The phase that checks a plan's test cases against the running software: starting the services, exercising them as a user or caller would, and inspecting what they left behind.
_Avoid_: Integration testing, QA, manual testing

**Test case**:
One check that proves a plan item works, with its expected result, marked as either automated or e2e. Written in the plan document under the plan item it checks.
_Avoid_: Test, scenario, acceptance criterion

**Test strategy**:
The workspace's written know-how for testing its project end to end: how to start what needs to run, how to exercise it, and where to look afterwards. Learned by the agent from the codebase and refined by the developer.
_Avoid_: Test plan, test setup, runbook

**Test report**:
The outcome of a testing phase: for each test case, whether it passed, failed or was blocked, with its evidence.
_Avoid_: Test results, test log

**Evidence**:
What a test report shows to back each outcome, such as command output, log excerpts, database query results, screenshots or recordings. Inline evidence is short text the report embeds; anything larger or non-textual is a test artifact the evidence links to.

**Test artifact**:
A file a testing session saves alongside its test report and links from it: a markdown note, a JSON or text output file, a screenshot, or a video recording. Kept in the workspace's storage with the report, not in the worktree; it reaches a PR only when the developer attaches it through the open PR action (FR-30a). Not to be confused with a phase's required artifact, which is the report itself.
_Avoid_: Attachment, asset, upload

**Blocked** (test case):
A test case that could not be run at all, as opposed to one that ran and failed.

**Inspection hook**:
A read-only connection the workspace holds to a system the project writes to, such as a database, an object store, a log service or a queue, so that testing sessions can gather evidence from it. Registered per workspace with its own credentials and an environment label; the test strategy says which hook to use for what.
_Avoid_: Connector, integration, probe, data source

**Hook request**:
A tester's proposal, inside a test strategy update, for an inspection hook the workspace does not have yet. The developer creates the hook; sessions never see its credentials.

### Session setup

**Phase setup**:
What every session of a phase gets: its agents, sub-agents, skills and tools, plus the phase's scope and stop condition.

**Managed** (agent, skill):
An agent or skill the workspace holds and a phase setup chooses for a session.
_Avoid_: Built-in, app skill

**Ambient** (agent, skill, item):
Anything the coding tool loads into a session from its own configuration, either the repo's or the developer's, rather than from the phase setup.
_Avoid_: Native, repo skill, discovered

**Shadowed**:
Describes an ambient item kept out of a session because a managed item has the same name.

### Usage

**Token usage**:
The tokens a round consumed, added up to its session, plan, phase and ticket.
_Avoid_: Cost, spend (dollars are only an API-equivalent figure)

**Baseline context**:
What a session holds before its agent does any work: its instructions plus the ambient and managed items loaded at start.
_Avoid_: Overhead, system prompt

**Peak context fill**:
The most context a round held at once.
