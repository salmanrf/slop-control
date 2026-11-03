---
title: "Pitch — Slop Control"
summary: "Product pitch: vision, features, and user actions for Slop Control."
---

# 🤖 Slop Control — tickets, agents, and AI coding sessions in one place

## 1. 🧭 Overview

**Slop Control** is a personal toolkit for a single developer that turns their AI coding assistants (Claude Code or similar tools) into a well-organized crew of helpers. It runs on the developer's own machine, works with almost any software project, and plugs into the ticket tracker they already use.

It brings four things together:

- **Tickets stay the source of truth.** The workspace connects to the developer's existing tracker (Jira, Linear, GitHub Issues, …) instead of replacing it.
- **Every AI coding session is tracked against a ticket**, so the developer can always see what work, findings, and decisions happened for a given ticket.
- **A roster of specialized agents**, each with its own helpers and skills, that can be reached from Slack — so teammates can ask the developer's agents a question about the code without interrupting the developer.
- **A session orchestrator** that, for each phase of work — investigation, planning, implementation, testing, code review — picks the right agents and skills and starts the session already set up and linked to the ticket.

### The problem

- **Repetitive setup.** Every phase of a ticket needs the same manual preparation: picking the right agents and skills, creating a separate working copy of the code, copying configuration, installing dependencies.
- **"Done" isn't tested.** Agents report work as finished after unit tests pass, or none at all; actually running the app and checking what it did is left to the developer, and how to do it differs for every project.
- **Bug reproduction is slow.** Confirming a production bug means building a realistic local environment with production-like data — tedious work done by hand every time.
- **Teammates can't reach the agents.** Simple questions about how the code works end up as interruptions to the developer, even though an agent could answer them.
- **Sessions get lost.** AI coding sessions are scattered and disconnected from tickets; findings and decisions from earlier sessions are hard to find again.

## 2. 👥 Target Users

**Primary user: an individual developer** who already works with AI coding assistants and wants to run them in a more organized, repeatable way. The workspace is personal — it lives on their machine (optionally deployed to a server of their choosing) and is not meant to be shared as a team product, at least for now.

**Secondary audience: the developer's teammates** — other engineers, PMs, QA, support — who interact with the developer's agents through Slack (asking questions, flagging bugs) without needing access to the workspace itself.

## 3. 🧩 Core Concepts

| Concept | What it is | Relates to |
|---|---|---|
| **Workspace** | A home for one project (or product). The app opens with a workspace selector; nothing works until a workspace is created and its sources are linked. | Has linked repositories, a ticket tracker, communication channels, and a wiki |
| **Linked source** | Something a workspace is connected to: **code repositories** (one or more GitHub repos), a **ticket tracker**, **communication channels** (Slack), and a **wiki** (project knowledge). Some are mandatory, some optional. | Belongs to a workspace |
| **Ticket** | A unit of work from the developer's existing tracker. The workspace reads and updates it but never owns it. | Has zero or more plans and many sessions |
| **Plan** | One separately shippable part of a ticket, with its own branch and PR, made of plan items. Most tickets have one; splitting is optional. Plans are revised, never replaced. | Belongs to a ticket; has plan items and sessions |
| **Session** | One AI coding session (Claude Code or similar) working on a ticket, in one phase. Its findings, decisions, and outcome are kept. | Always belongs to a ticket; optionally to one plan; runs one agent setup |
| **Phase** | A stage of work on a ticket: investigation, planning, implementation, automated testing, e2e testing, code review. | Determines which agents and skills a session gets |
| **Agent** | A specialized AI helper with its own helpers (sub-agents) and skills, and its own Slack identity. | Used in sessions; reachable from Slack |
| **Test case** | One check that proves a plan item works, marked automated or e2e. Written by the planner in the plan document. | Belongs to a plan item; checked in a testing phase |
| **Test strategy** | The workspace's learned know-how for testing its project end to end — what to start, how to exercise it, where to look afterwards. | One per workspace; drafted by the tester, refined by the developer |
| **Inspection hook** | A read-only connection to a system the project writes to (database, object store, logs, queue), labelled local, staging or production. | Registered per workspace; named by the test strategy; used by testing sessions for evidence |
| **Skill** | A reusable know-how package an agent can apply (e.g. "replicate prod data", "open a PR"). | Belongs to one or more agents |
| **Orchestrator** | Picks the best agents and skills for a ticket's current phase and starts a session already set up. | Creates sessions |
| **Approval / call to action** | When an agent drafts something (a reply, a fix, a plan), it waits in the workspace for the developer to approve, edit, or reject. How much an agent may do without approval is configurable. | Raised by agents; acted on by the developer |

### The agent roster

| Agent | What it does for you |
|---|---|
| **Explorer** | Answers questions about the code when tagged in Slack. |
| **Bug investigator** | Takes a bug ticket, sets up a separate copy of the project with production-like data, and runs tests to confirm the bug. |
| **Planner** | Turns an investigated ticket into a step-by-step implementation plan. |
| **Implementer** | Writes the code for a planned ticket in its own working copy. |
| **Tester** | Runs the plan's test cases: the project's automated tests, then end to end against the running software, and reports each result with evidence. |
| **Code reviewer** | Reviews changes against the ticket and the project's coding standards. |
| **PR / release helper** | Opens pull requests, writes their descriptions, and prepares hotfixes. The PR can carry artifacts from every phase of the ticket: test reports, screenshots and video recordings of test runs, plan and investigation notes. |
| **Orchestrator** | Chooses which of the above to run for each phase, and starts the session. |

Each agent has **its own Slack user** (e.g. `@explorer`, `@bug-hunter`), so teammates address the right helper directly.

## 4. ✨ Features

The developer works through a **web dashboard that runs on their own machine**.

| Group | Feature | What the developer gets |
|---|---|---|
| **Workspaces** | Workspace selector | Switch between projects; each keeps its own sources, agents, and history. |
| | Link sources | Connect code repositories (**required**), plus optionally a ticket tracker, Slack channels, and a wiki. |
| **Tickets** | Ticket view | See tickets from the existing tracker, with every AI session that worked on each one. |
| **Sessions** | Session tracker | A history of every AI coding session per ticket: phase, agent setup used, findings, decisions, and outcome. |
| | One-click session start | Start a session for a ticket's current phase, already set up with the right agents, skills, and a separate working copy of the code. |
| **Agents** | Agents & skills manager | See which agents, helpers, and skills each phase will use; enable or disable them; install new ones from a catalog or download them. |
| | Slack presence | Each agent has its own Slack user that teammates can tag. |
| | Ambient setup view | See everything the coding tool would load into a session on its own (the repo's `.claude/`, your `~/.claude`, plugins, memory) and what it costs in context. Your personal `~/.claude` is off by default and switched on per phase. |
| **Usage** | Token usage tracker | Token usage per correction round, added up per session, plan, phase and ticket, including each session's baseline context and peak context fill. |
| | Configurable autonomy | Decide per agent what it may do on its own and what needs approval. |
| **Approvals** | Approvals inbox | Everything an agent drafts — an action, a plan, a fix, a Slack reply — shows up in one inbox as a call to action to approve, edit, or reject. |
| **Testing** | Test cases in every plan | The planner writes, for each plan item, the checks that prove it works — automated or e2e — and you correct them with the rest of the plan. |
| | Automated & e2e testing phases | The tester runs the project's test suites, then exercises the real software: starts the service and calls its API, or sets env vars and invokes just the relevant lambda, then inspects logs and database contents. It never fixes code; failures go back to implementation. |
| | Learned test strategy | The tester studies the codebase to work out how *this* project is best tested end to end, writes it down for your approval, and follows it from then on. You refine it by editing or annotating it. |
| | Test reports with evidence | Every test case is passed, failed or blocked, backed by command output, log excerpts, database queries and screenshots. |
| | Test artifacts | Files the tester saves with the report and links from each case: markdown notes, JSON and text outputs, screenshots, and video recordings of a run. Viewed, zoomed, played and annotated in the dashboard; stored with the report, never in the PR. |
| | Inspection hooks | Read-only hooks into the systems the project writes to: databases, S3 buckets, CloudWatch and serverless logs, queues. The tester reads through them to prove what a test case left behind, and asks for new ones when a check needs a system it cannot see. Credentials stay in the workspace; sessions only get the read-only tools. |
| | Test environment | The variables e2e and manual cases need, typed by hand, imported from a `.env` file, or inferred from the codebase and the test strategy, then edited. Required values gate the test plan; testing sessions get them as environment and nothing else sees them. |
| **Bug investigation** | Prod-like reproduction | The bug investigator sets up an isolated copy of the project with production-like data and runs tests to confirm a bug. |
| **Code questions** | Ask the explorer | Teammates ask code questions in Slack and get answers from the explorer agent. |
| **Project know-how** | Built-in project knowledge | A built-in knowledge source every agent consults for project-specific "how do I…" questions (e.g. *how do I bring production data local?*, *how do I run the tests?*). The developer writes these question-and-answer pairs and can add, edit, or remove them in the dashboard — so the workspace adapts to any project without custom code. |
| **Review** | Drafted actions | Agents never act on the outside world directly at the end of a session. They **draft actions** — open a PR, move the ticket's status, update docs, post a comment — and the developer reviews and approves them; approved actions are then carried out. |
| | Built-in code editor & document viewer | Review and tweak an agent's code changes and written documents (plans, investigation notes) right in the dashboard before approving. |
| | Annotations & correction rounds | Comment on a plan or a diff, line by line, and send the comments back to the agent. The agent resumes its session, answers every comment, and the next round shows what was addressed and what is still open. |

### MVP vs later

| Release | Includes |
|---|---|
| **MVP (first release)** | Workspaces & source linking · ticket view · session tracker (**Claude Code** first) · orchestrator with one-click session start · agents & skills manager · built-in project knowledge · drafted actions with approvals inbox · code editor & document viewer · annotations & correction rounds for planning, implementation, test reports and the test strategy · automated & e2e testing phases with test cases, learned test strategy and evidence-backed test reports (local environments only) · token usage tracker · ambient setup view (user-level source off by default) |
| **Later** | Slack agents (explorer, per-agent Slack users, Slack replies through the approvals inbox) · bug investigator with prod-like reproduction · support for other AI coding tools · automatic browser driving for frontend recordings · test strategies that reach shared or remote environments · switches for individual ambient items and other sources · token budgets |

## 5. 🚶 User Journeys

### Set up a workspace (first run)

1. Open the dashboard and create a **workspace** for a project.
2. Link at least one **code repository**; optionally link the ticket tracker, Slack channels, and a wiki.
3. Fill in the **project knowledge** with a few question-and-answer pairs (how to run tests, how to bring production data local, where env files live, …).
4. Open the **agents & skills manager**, review the default setup for each phase, and enable, disable, or install agents and skills as needed.

### Work a ticket end to end

1. Pick a ticket from the workspace's ticket view.
2. The orchestrator **suggests the next phase** (investigation → planning → implementation → automated testing → e2e testing → code review), but the developer can **jump to any phase**, in any order, as many times as needed.
3. The developer sees which agents and skills the session will use, adjusts if needed, and **starts the session** with one click. It opens already prepared: a separate working copy of the code, the right setup, and linked to the ticket.
4. The session's findings, decisions, and outcome are recorded on the ticket's **session history**.
   - If the plan or the code needs changes, the developer **annotates** it in the viewer or editor and **sends the comments back**. The agent resumes the session, addresses each comment, and the next round is reviewed the same way until the developer accepts it.
   - In the testing phases, the tester runs the plan's test cases and writes a **test report** with evidence, reading databases, buckets, logs and queues through the workspace's **inspection hooks**. Failures send the work back to an implementation correction round; the first e2e run in a workspace starts by drafting the **test strategy** for approval, including any hooks it needs.
5. At the end, the agents **draft actions** — e.g. open a PR, move the ticket to *In Review*, update a doc.
6. The developer reviews the drafts in the **approvals inbox**, inspecting code in the built-in editor and documents in the viewer, edits if needed, and approves. Approved actions are carried out.

### Teammate asks a question in Slack (later)

1. A teammate tags `@explorer` in a Slack thread with a question about the code.
2. The explorer looks through the code (and project knowledge) and drafts an answer.
3. Depending on its autonomy setting, it replies directly, or the draft waits in the developer's approvals inbox first.

### Confirm a bug (later)

1. A bug ticket comes in; the developer (or a teammate via Slack) hands it to `@bug-hunter`.
2. The bug investigator sets up an isolated copy of the project, brings in production-like data using the project's own know-how, and runs tests to reproduce the bug.
3. Its findings land on the ticket's session history, with drafted next steps waiting for approval.

## 6. 🎯 Differentiation

Plenty of tools run AI coding agents: plain Claude Code with skills, hosted agents (Devin, Copilot Agent, Codex cloud), chat-based agents (Claude in Slack, Linear agents), and parallel agent runners (Conductor, Vibe Kanban, …). They share two gaps:

- **Loosely coupled to the rest of the development lifecycle.** The ticket tracker, planning, testing, and team communication live elsewhere; the agent's work isn't tied back to the ticket it was for.
- **No clear control over which helpers and skills fit which task.** Choosing the right agents and skills for an investigation versus a code review is left to the developer, every time.

Slop Control is built around those two gaps:

| | Typical agent tools | Slop Control |
|---|---|---|
| Link to tickets | Optional or none | Every session belongs to a ticket and a phase |
| Lifecycle coverage | One step (usually coding) | Investigation, planning, implementation, automated & e2e testing, review — plus team communication |
| Choosing agents & skills | Manual, ad hoc | Per-phase setups, visible and editable in a manager |
| Acting on the outside world | Often direct | Drafted actions, approved by the developer first |
| Where it runs | Often hosted, team-wide | Personal, on the developer's own machine |
| Project specifics | Hard-coded or re-explained each time | Captured once as project knowledge |

## 7. ❓ Open Questions

- **Production data safety.** Bringing production-like data onto a laptop raises privacy and credential-handling questions — how much masking or scoping is needed, and who decides?
- **Slack identities.** One Slack user per agent may need workspace-admin approval and adds setup work for each agent.
- **Session capture.** How reliably sessions can be captured from Claude Code and linked to tickets without the developer doing anything extra.
- **"Almost any project".** How far the project knowledge plus agents & skills manager can stretch before some projects need custom setup.
- **Skill catalog.** Where installable agents and skills come from (a public catalog, a git repo, files), and how trust is handled for downloaded ones.
