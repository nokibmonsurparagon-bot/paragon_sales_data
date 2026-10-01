# CLAUDE.md

Sales-transaction approval web app (Field Force → Sales Admin → Accountant/Treasury → `READY_FOR_PROCESSING`).
Spec: `docs/SPECIFICATION.md` · design: `docs/ARCHITECTURE.md` · status/limitations: `docs/IMPLEMENTATION.md`.

**Hard scope rule:** no UiPath / RPA / ERP code. Integration readiness = `domain_events` outbox + `approved_snapshot` only.

## Commands
- Local DB: `npm run db:start` (embedded PostgreSQL 17, UTF-8, `.local/pgdata`)
- `npm run dev` · `npm run typecheck` · `npm run lint` · `npm test` (integration tests wipe `TEST_DATABASE_URL`)
- API unit tests only: `npm run test:unit -w @paragon/api`
- Rebuild shared after editing it: `npm run build:shared` (API/web import its `dist`)
- Schema change: edit `apps/api/prisma/schema.prisma` → `npm run db:migrate` (never hand-edit DB schemas)
- Full stack in Docker: `docker compose up --build` → http://localhost:8080. Its DB is a separate database (volume
  `paragon_pgdata`, host port 5433) – the user's UAT data lives there, not in `.local/pgdata`. Back it up
  (`docker compose exec -T db pg_dump -U paragon -d paragon --format=custom > .local/backups/<name>.dump`) before
  rebuilding with new migrations; never `docker compose down -v` without explicit consent.
- On Windows, `prisma generate` fails with EPERM while the API dev server is running (DLL lock) – stop it first.

## Conventions
- Validation schemas, enums and permission codes live in `packages/shared` and are used by both apps.
- API layering: `*.routes.ts` (thin controller: parse with Zod → call service → `ok()`/`created()`) → `*.service.ts`
  (business rules) → repository / Prisma. No business logic in routes or React components.
- **All status changes go through `workflowService.execute()`**; transitions/guards live only in `modules/workflow/state-machine.ts`.
- Transaction visibility: always via `scopeWhere(user)` (`transaction.repository.ts`); out-of-scope → 404.
- Wings: every transaction has a `wingId`; reviewers are limited to their wings (`wingWhere` in scope/queue, `onWing` in
  state-machine guards, `usersWithPermission(…, { wingId })` for notifications). Only the owner may change the wing.
- Mutations that change business data run in `withTransaction` and write history/audit (and outbox where relevant) in the same tx.
- Optimistic locking: every mutating transaction endpoint takes `version`; mismatch → 409.
- Amount (CR) (`creditAmount`) is set only by `FIN_APPROVE` (approve body / bulk item); `bankCharge` = amount − creditAmount via
  shared `bankCharge()` (DB CHECK enforces it). Bulk approve/reject (`workflowService.bulk`) runs each item through
  `review()` → `execute()` in its own DB transaction – never add a bulk path that bypasses the per-item guards.
- Money = decimal strings (`^\d+(\.\d{1,2})?$`), compared via `toCents`. Dates = `YYYY-MM-DD`.
- Errors: throw `AppError` subclasses from `core/errors.ts`; response envelope `{ success, data|error, requestId }`.
- Relative imports in API/shared use `.js` extensions (ESM, NodeNext).
- Web: TanStack Query for server state, `useUrlState` for list filters, `Can`/`RequirePermission` for UX gating only.
- Tests: add unit tests for pure domain logic and an integration test for any new endpoint/permission rule.
