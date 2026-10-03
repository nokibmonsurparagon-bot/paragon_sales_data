# Paragon – Sales Transaction Management & Approval

Web application that digitises the sales-transaction approval process:

```
Field Force → Sales Admin review/approval → Accountant or Treasury (rule-based routing) → READY_FOR_PROCESSING
```

The application stops at `READY_FOR_PROCESSING`. It contains **no ERP / RPA / UiPath integration**. A future
integration can consume approved transactions from the `domain_events` outbox table and the frozen
`approved_snapshot`, with no change to this application (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

| Layer | Technology |
|---|---|
| Web | React 19, TypeScript, Vite 7, MUI 7 (+ X DataGrid / Date Pickers), TanStack Query, React Hook Form |
| API | Node.js 24, Express 5, TypeScript, Zod 4, Pino, OpenAPI (zod-to-openapi + Swagger UI) |
| Data | PostgreSQL 17, Prisma 6 (migrations) |
| Shared | `packages/shared` – Zod schemas, enums, permission catalogue used by **both** web and API |
| Tests | Vitest, Supertest, Testing Library |
| Infra | Docker, Docker Compose, nginx |

---

## Quick start (local, no Docker required)

Prerequisites: **Node.js ≥ 22.12** (developed on Node 24).

```bash
cp .env.example .env            # then replace both JWT secrets (command inside the file)
npm install                     # also approves the native install scripts listed in package.json "allowScripts"
npm run db:start                # terminal 1 – local PostgreSQL 17 (embedded, data in .local/pgdata)
npm run db:deploy               # terminal 2 – apply migrations
npm run db:seed                 #              roles, permissions, master data, rules, demo users
npm run dev                     #              API http://localhost:4000 · web http://localhost:5173
```

Open **http://localhost:5173**. API docs (development): **http://localhost:4000/api/docs**.

`npm run db:start` runs a real PostgreSQL server from npm (`embedded-postgres`), so no admin rights, WSL or Docker
are needed. If you already have PostgreSQL, point `DATABASE_URL` / `TEST_DATABASE_URL` at it and skip that step.

### Development-only credentials

> ⚠️ **DEVELOPMENT ONLY** – created by the seed when `NODE_ENV` ≠ `production` (or `SEED_DEV_USERS=true`).
> Never use them in a shared or production environment.

Password for every demo user: **`Paragon@Dev2026`**

| Email | Role | Wings |
|---|---|---|
| admin@paragon.local | Administrator (administration & oversight; cannot create/approve) | All |
| ff1@paragon.local | Field Force | DOC, CBF |
| ff2@paragon.local | Field Force | DOC, Feed |
| salesadmin@paragon.local | Sales Admin | DOC, CBF |
| salesadmin2@paragon.local | Sales Admin | DOC, Fish, Feed, Milk |
| accountant@paragon.local | Accountant | All |
| treasury@paragon.local | Treasury | All |
| auditor@paragon.local | Auditor (read-only) | All |

**Wings** (DOC, CBF, Fish, Feed, Milk): every transaction belongs to one wing, and Sales Admin / finance users only see
and approve transactions of their wings. Try it: a *Feed* transaction from ff2 reaches only Sales Admin Two; a *CBF*
transaction from ff1 reaches only Sales Admin One. Wings are managed under *Master Data*, user wings under *Users*.

Seeded routing rules: *special* sales type → Accountant; amount ≥ 1,000,000 → Treasury; *Corporate Sale* → Treasury;
everything else → Accountant.

**Final approval records Amount (CR)** – what the bank actually credited. The bank charge is calculated as deposit amount −
Amount (CR). Reviewers can approve or reject straight from the **Approvals** table, one row at a time or in bulk (tick the
rows; finance rows need Amount (CR) typed in the row). The **CV code is the farmer / customer code**. Farmers / customers,
lines, branches, banks, accounts and sales types are managed under *Master Data*, where each list can also be **imported
from Excel** (download the template or the current list, *Check file*, then *Import*).

## Docker

```bash
cp .env.example .env    # set real secrets
docker compose up --build
```

Web: http://localhost:8080 (nginx serves the SPA and proxies `/api` to the API, so everything is same-origin).
The API container applies migrations on start (`prisma migrate deploy`) and runs the idempotent seed. The compose file
enables demo users (`SEED_DEV_USERS=true`) for local use only – remove it for any real deployment.

> Verified with Docker Desktop 4.92: both images build, the stack comes up healthy and the full approval workflow passes
> end-to-end through nginx.

**Two separate databases.** The Docker stack (http://localhost:8080) keeps its data in the Docker volume
`paragon_pgdata` (PostgreSQL, exposed to the host on port 5433). The local development setup (http://localhost:5173)
uses its own database in `.local/pgdata` (port 5432). Both persist across restarts, but they do **not** share data –
something entered on :8080 is not visible on :5173 and vice versa. Use one of them (normally :8080) for UAT data.

- Start / stop without losing data: `docker compose up -d` / `docker compose stop` (the containers also restart on
  their own whenever Docker Desktop is running).
- Back up the database: `docker compose exec -T db pg_dump -U paragon -d paragon --format=custom > paragon.dump`
  (uploaded documents are in the `paragon_storage` volume).

> Upgrading an existing Docker volume to the wings release gives the existing demo users *All wings* (the migration
> never takes access away). To get the demo wing assignments above, start from an empty volume:
> `docker compose down -v` (**deletes the Docker database and uploads**) and then `docker compose up --build`.

### Production notes

- Set `NODE_ENV=production`, unique random `JWT_SECRET` / `JWT_REFRESH_SECRET` (the API refuses placeholder secrets),
  `COOKIE_SECURE=true` (HTTPS), `CORS_ORIGIN`, `TRUST_PROXY`, and a persistent `FILE_STORAGE_PATH` volume.
- Create the first administrator without demo users:
  `ADMIN_EMAIL=… ADMIN_NAME="…" ADMIN_PASSWORD=… npm run admin:create -w @paragon/api` (password must be changed at first sign-in).
- Swagger is disabled in production unless `SWAGGER_ENABLED=true`.
- Schema changes only through Prisma migrations (`npm run db:migrate` in development, `db:deploy` in deployment).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Shared package watcher + API (tsx watch) + web (Vite) |
| `npm run build` | Production build of shared, API and web |
| `npm run typecheck` / `npm run lint` | Strict TypeScript / ESLint over the whole repo |
| `npm test` | All tests (shared, API unit + integration, web) – needs `TEST_DATABASE_URL` reachable |
| `npm run test:unit -w @paragon/api` | API unit tests only (no database) |
| `npm run db:migrate` | Create/apply a migration in development (`prisma migrate dev`) |
| `npm run db:deploy` / `db:seed` / `db:reset` | Apply migrations / seed / reset the dev DB |
| `npm run openapi:export -w @paragon/api` | Write `docs/openapi.json` |

The integration tests **wipe `TEST_DATABASE_URL`** (it must differ from `DATABASE_URL`).

## Repository layout

```
packages/shared   Zod schemas, enums, permission catalogue, API types (single source of truth)
apps/api          Express API – src/core (infrastructure) + src/modules/* (routes → service → repository)
  prisma/         schema, migrations (incl. append-only triggers), seed
  tests/          unit (pure domain), integration (HTTP + real PostgreSQL)
apps/web          React SPA – features/* per business area, components/, routes/, api/
docs/             SPECIFICATION.md · ARCHITECTURE.md · IMPLEMENTATION.md · openapi.json
scripts/          local-db.mjs (embedded PostgreSQL)
```

See [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for what was built per phase, test coverage, known limitations and
recommended next steps.
