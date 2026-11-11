# Slop Control

Tracks AI coding sessions against the tickets they work on. Create a ticket in the built-in tracker or connect a repo's GitHub Issues, start a Claude Code session on it from the dashboard, watch its status live, and read its result.

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

Server settings are optional. Every workspace has a built-in tracker that needs none. GitHub Issues sources read through the server's `GITHUB_TOKEN`: to read private repos, filter by tickets assigned to you, or avoid GitHub's low anonymous rate limit, copy `.env.example` to `apps/server/.env` and set it.

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

This runs the demo script in a browser against the real stack, with Claude Code replaced by a scripted runtime and GitHub by a local stub, so it uses no quota. It needs local Supabase running and a browser installed once:

```sh
npm run e2e:install -w @slop-control/e2e
npm run test:e2e
```
