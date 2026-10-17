# Tab web + API

Next.js 16 (App Router, Cache Components) app that serves Tab's pay pages (`/r`, `/s`, `/d`, `/b`), the landing page,
OG cards, and the API the PayBox plugin calls. The API contract is `../shared/api-contract.md`.

## Run locally

```sh
export PATH=~/.local/node24/node-v24.21.0-darwin-arm64/bin:$PATH
pnpm install
cp .env.example .env.local   # leave DATABASE_URL empty to use PGlite in ./.pglite (migrations auto-apply)
pnpm dev                     # http://localhost:3000
```

Checks: `pnpm test` (vitest + PGlite), `pnpm typecheck`, `pnpm lint`, `pnpm build`.

## Database

Drizzle schema in `src/lib/db/schema.ts`, migrations in `drizzle/`.

- New migration: `pnpm db:generate`
- Apply to Neon: `pnpm db:migrate` (reads `DATABASE_URL` from env or `.env.local`)

Production uses `@neondatabase/serverless` Pool (WebSockets, supports transactions); dev/tests use PGlite with the same
migrations. The driver is picked from `DATABASE_URL` in `src/lib/db/client.ts`.

## Deploy (Vercel)

1. Set env vars from `.env.example` (DATABASE_URL, TAB_PLUGIN_KEY, CRON_SECRET, NEXT_PUBLIC_BASE_URL,
   NEXT_PUBLIC_TAB_ESCROW, TAB_ESCROW_START_BLOCK, BASE_RPC_URL).
2. `pnpm db:migrate` against the production database.
3. Deploy. `vercel.json` pins functions to `sin1` (next to the Neon DB) and schedules
   `/api/cron/index-escrow` every minute (per-minute crons need a Pro plan; on Hobby, the tabs endpoint still runs an
   on-demand catch-up).
4. Add a Vercel Firewall rate-limit rule for `/api/*` (the in-app token bucket is per instance, best effort).

## Payment matching

RPC `eth_getLogs` only (Blockscout is Cloudflare-challenged for servers), ≤2,000-block chunks, never below the escrow
deploy block, scan progress persisted per request. Incomplete scans report `checking`, never `open`.
