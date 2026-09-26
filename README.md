# Spaceair CRM

Sales, AMC and service CRM for SPACEAIR (MEP contracting), with an automation engine that routes work, chases follow-ups and escalates by a delegation matrix, so that day-to-day operations don't depend on the Founder.

## Run locally

```bash
npm install        # first time only
npm run setup      # create database (data/spaceair.db) + load sample data
npm run build
npm start          # http://localhost:3000
```

Sign in by choosing a role on the login page (Founder, branch head, sales, service manager, technician, accounts).

| Script | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run db:seed` | Reset to fresh sample data (runs the automation engine over it) |
| `npm run e2e` | Playwright workflow tests against a server on port 3100 (mutates data; re-seed after) |
| `npm run screenshots` | Capture screenshots from a server on port 3100 into `docs/screenshots` |
| `npm run report` | Build `docs/Spaceair-CRM-Report.pdf` from the screenshots |

Environment (all optional locally): `DATABASE_URL` (default `file:./data/spaceair.db`; use a Turso URL in production), `DATABASE_AUTH_TOKEN`, `AUTH_SECRET`, `CRM_API_KEY` (default `spaceair-demo-key`), `DISABLE_SCHEDULER=1`.

## Integration API

```bash
curl -X POST http://localhost:3000/api/enquiries \
  -H "content-type: application/json" -H "x-api-key: spaceair-demo-key" \
  -d '{"company":"Sai Hospitals","phone":"+91 98490 11223","requirement":"Fire alarm for 120-bed hospital","division":"Fire & Safety","branch":"Hyderabad","source":"IndiaMART"}'
```

The public website form is at `/enquire`.

## Technologies

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions, Turbopack) |
| UI | React 19, Tailwind CSS 4, Lucide icons, Recharts 3 |
| Language | TypeScript 5 (strict) |
| Data | SQLite via libSQL (`@libsql/client`), Drizzle ORM + Drizzle Kit; Turso / PostgreSQL ready |
| Validation | Zod 4 |
| Auth | JWT session cookies with `jose`; role- and branch-scoped access |
| Automation | Rule engine (`src/lib/automation`) + `node-cron` scheduler via `instrumentation.ts` |
| Testing & docs | Playwright (e2e, screenshots, PDF report), tsx |

## Code map

- `src/db/schema.ts`: 19 tables
- `src/lib/automation/rules.ts`: the 16 automation rules; `engine.ts` runs them; `ctx.ts` holds the idempotent side effects
- `src/lib/actions.ts`: every mutation (Server Actions), each emitting domain events
- `src/app/(app)/*`: the CRM screens; `src/app/enquire`: public form; `src/app/api/enquiries`: REST API
- `scripts/`: seed, e2e, screenshots, report
