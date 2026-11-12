---
title: "ADR-0004 — Secret storage and handing git a token"
summary: "Credentials are sealed with AES-256-GCM in Postgres under a key from the server's environment, and a push gets its token through a pipe that only git's credential helper reads."
---

# ADR-0004: Secret storage and handing git a token

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

A workspace needs a GitHub credential to push a branch and open a PR, and each GitHub Issues source needs its own to read and write tickets (A-5). Until now the server read one `GITHUB_TOKEN` from its environment, shared by every workspace and source, and nothing could write with it.

Two questions were open:

- **Where a credential lives.** The options were sealed values in Postgres, the OS keychain, or an env file per workspace.
- **How git is given the token for a push.** It must not appear in the command's arguments, the remote URL, the clone's git configuration, a file in a worktree, a credential the host's helper saves, git's error output, or a log line (NFR-4). A session running at the same time must not be able to read it.

## Decision

### Storage

- **Secrets are sealed with AES-256-GCM and stored in Postgres**, in one table keyed by owner: a workspace's GitHub credential, or a ticket source's.
- **The key comes from a new `SLOP_SECRET_KEY` server setting**, 32 bytes as base64 or hex. It is never in the database, so a copy of the database alone opens nothing.
- **Each sealed value is bound to its owner.** The owner is authenticated with the value, so a row moved to another owner doesn't open.
- **With no key set, saving a credential fails with `SECRETS_NOT_CONFIGURED`.** Everything that needs no credential keeps working. A key of the wrong size stops the server at startup.
- **Only `SecretStore` knows any of this.** The rest of the server saves, reads, and erases a secret by its owner.

We rejected the OS keychain because a remote host has none (NFR-5), and it would tie tests to the developer's machine. We rejected an env file per workspace because the dashboard would have to write files holding plain tokens, and FR-67 needs the same store for test environment values. We rejected Supabase Vault because it puts the key in the same database as the values.

### Handing git the token

- **The push runs with the token on file descriptor 3.** The server opens a pipe to the git process and writes the user name and token into it. Git is given one credential helper, a one-line shell function that copies that pipe to git when asked for a credential.
- **The token is in no argument, environment variable, or file.** It exists in the server's memory and in the pipe.
- **The host's credential helpers are cleared for that one command**, with an empty `credential.helper` before the one above. The push uses only the stored token, and nothing is written to the macOS keychain. The helper answers `get` only, so git's `store` and `erase` calls reach nothing.
- **The push names its own address**, built from the linked repo's owner and name, over HTTPS. It doesn't use the clone's remote, which may use SSH and the developer's own login. The clone's configuration is not changed.
- **The push names the commit and never forces.** It runs with `--no-verify`, so the clone's own hooks don't run inside a command that holds the pipe.
- **Only `RepoHost`'s GitHub implementation knows any of this.**

We rejected putting the token in the URL or in an `http.extraHeader` argument, because both show in the process list. We rejected `GIT_ASKPASS` with the token in the environment, because a process's environment can be read by other processes of the same user. We rejected a temporary credentials file, because a crash would leave it behind.

### What was checked

The `RepoHost` contract suite runs the GitHub implementation against real git and a local git server over HTTP that demands the token. After a push it searches for a planted token in the clone's configuration, its remotes, every file under the clone and a worktree, the arguments of the processes the push started, and the error a failing push throws. It also checks that a credential helper configured in the clone is never called.

## Consequences

- `GITHUB_TOKEN` is no longer read. It is not copied into any source, so a Sprint 2 source on a private repo stops listing until it's given a credential. The server logs one line at startup if the variable is still set.
- Losing `SLOP_SECRET_KEY` loses every stored credential. They have to be entered again. Rotating the key is not built.
- A stored secret is added to the `Redactor` at startup and when it's saved, and the session runtime drops any environment variable whose value contains one.
- The server's push runs with the developer's own access to the machine. It isn't sandboxed. What keeps it narrow is that it runs one fixed git command on a commit the developer approved.
- **Still to be shown on a real session:** that a session running while the workspace pushes can't see the token. The design gives it nothing to find, and smoke case SM-16 checks it. Until that case has run, this part of A-5 rests on the design and the contract suite.
- FR-67's test environment values can use the same `SecretStore` with a new kind of owner.
