# Quickstart

## Prerequisites

- Node.js 20.9 or newer (22 LTS recommended)
- npm 10 or newer

No database to install. The app runs real PostgreSQL in-process via PGlite and stores it
in `.data/pg`.

## Run it

```bash
npm install
cp .env.example .env.local     # then set SESSION_SECRET and WORKSPACE_PASSWORD
npm run dev
```

Open <http://localhost:3000>. On first boot the app creates `.data/pg`, applies the
migrations in `drizzle/`, and seeds the demo agency. That takes a few seconds; later
boots are immediate.

## Sign in

- **Internal workspace**: go to `/unlock` and enter the workspace password from
  `.env.local`, then pick the member you want to act as. Their role decides what you can
  see and do — start as the Owner/Admin to see everything.
- **Personal portal**: open any member's page under `/members`, copy their private link,
  and open it. The seeded PIN is `1234` for every demo member. That link shows only that
  person's own week.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Vitest over the domain layer |
| `npm run db:generate` | Regenerate migration SQL after editing `lib/db/schema.ts` — offline, no database needed |
| `npm run db:reset` | Delete `.data/pg` so the next boot migrates and seeds fresh |

## Two things to know about the local database

1. **Only one process may open `.data/pg` at a time.** PGlite does not lock its data
   directory and will not warn you, so a second process writing at the same time can
   corrupt it. Stop the dev server before running `npm run db:reset`, and never run two
   dev servers against the same checkout.
2. **Migrations run at startup, not from the CLI.** Edit `lib/db/schema.ts`, run
   `npm run db:generate` to produce the SQL, then restart the dev server to apply it.
   `db:generate` never touches the database, so it is safe while the server is running.

## Changing the seed

`lib/db/seed.ts` only runs when the database is empty. To reshape the demo agency, edit
it, then `npm run db:reset` with the server stopped and start again.

## Moving to hosted Postgres later

Set `DATABASE_URL` in the environment. `lib/db/client.ts` then uses `node-postgres`
instead of PGlite; the schema and the migration files in `drizzle/` are unchanged. Apply
them to the hosted database on first boot exactly as locally. Note that PGlite cannot be
used on Vercel — a serverless filesystem is ephemeral — so `DATABASE_URL` is mandatory
for any deployment.
