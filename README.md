# Slop Control

Tracks AI coding sessions against the tickets they work on. Create a ticket in the built-in tracker or connect a repo's GitHub Issues, start a Claude Code session on it from the dashboard, watch its status live, and read its result and its diff. When a session ends, the workspace drafts what follows from it: a pull request, a comment on the ticket, a status change. Nothing leaves the machine until you approve it.

## Warning

Sessions run in auto permission mode. Each one is started under a baseline scope that is meant to cut it off from the host's `git`, `gh`, and SSH logins, but that hasn't been proven on a real session yet: see the [S2-01 note](docs/spikes/s2-01-scope-enforcement.md). Until its smoke test passes, run real sessions only against throwaway repos.

## Requirements

- Node 24
- Docker and the Supabase CLI
- Claude Code, installed and signed in

## Set up

```sh
npm install
npm run db:start
```

Sign-up is disabled, so create your user directly, and give the web app its key. Replace the email and password:

```sh
eval "$(supabase status -o env | grep -E '^(SERVICE_ROLE_KEY|ANON_KEY)=')"
echo "VITE_SUPABASE_ANON_KEY=$ANON_KEY" > apps/web/.env
curl -X POST http://127.0.0.1:54321/auth/v1/admin/users \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"choose-one","email_confirm":true}'
```

Server settings are optional. Every workspace has a built-in tracker that needs none, and a GitHub Issues source reads public repos anonymously.

To save GitHub credentials, the server needs a key to seal them with. Copy `.env.example` to `apps/server/.env` and set `SLOP_SECRET_KEY`:

```sh
cp .env.example apps/server/.env
echo "SLOP_SECRET_KEY=$(openssl rand -base64 32)" >> apps/server/.env
```

Then add credentials in the dashboard:

- **A workspace's GitHub credential**, on its Tickets page, pushes branches and opens pull requests in its linked repos. It needs write access to their contents and pull requests.
- **A GitHub Issues source's credential**, on the Sources page, reads private repos, filters by tickets assigned to you, avoids GitHub's low anonymous rate limit, and posts approved comments.

The dashboard shows whether a credential is set and whether it works, and never its value. The old `GITHUB_TOKEN` setting is no longer read. See [ADR-0004](docs/adr/0004-secret-storage-and-token-handoff.md).

## Run

```sh
npm run dev
```

Then open http://127.0.0.1:5173.

## Check

These need local Supabase running.

```sh
npm test
npm run lint
npm run typecheck
```

This runs real Claude Code sessions on throwaway repos, which uses your plan's quota. It includes the cases that show a session can't push or use `gh`:

```sh
npm run test:smoke -w @slop-control/server
```

It first runs a control run with the baseline scope switched off, to prove the test can detect a push at all. Both refuse to start while a real SSH key or agent is in reach of your user, and say how to run safely.

This pushes a branch and opens a pull request on a real throwaway GitHub repo, then closes the pull request and deletes the branch:

```sh
GITHUB_E2E_TOKEN=... GITHUB_E2E_OWNER=you GITHUB_E2E_REPO=throwaway \
  npx jest test/repo-host.spec.ts -t 'real throwaway'
```

Run it from `apps/server`.

This runs the demo script in a browser against the real stack, with Claude Code replaced by a scripted runtime and GitHub by a local stub, so it uses no quota. It needs local Supabase running and a browser installed once:

```sh
npm run e2e:install -w @slop-control/e2e
npm run test:e2e
```
