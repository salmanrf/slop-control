# Slop Control

Tracks AI coding sessions against the tickets they work on. Start a Claude Code session on a GitHub issue from the dashboard, watch its status live, and read its result.

## Warning

Sessions run in auto permission mode and can use the host's own `git` and `gh` logins. Until phase scopes exist, run real sessions only against throwaway repos.

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

Server settings are optional. To read private repos or avoid GitHub's low anonymous rate limit, copy `.env.example` to `apps/server/.env` and set `GITHUB_TOKEN`.

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

This runs real Claude Code sessions on throwaway repos, which uses your plan's quota:

```sh
npm run test:smoke -w @slop-control/server
```
