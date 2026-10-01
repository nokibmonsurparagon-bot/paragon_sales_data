# Implementation Report

Status: **Phases 1–17 implemented** (2026-09-26). All phases were pre-approved together with the recommended defaults in
[ARCHITECTURE.md §9](ARCHITECTURE.md#9-ambiguities-and-decisions-needed); further changes are expected during UAT.
**Change request 1 – Wings** implemented 2026-09-28; **change request 2 – new fields, Amount (CR) / bank charge, table
and bulk approval** implemented 2026-09-30 (see [below](#change-requests)).

## Verification summary

| Check | Result |
|---|---|
| API tests (unit + integration against real PostgreSQL) | **140 / 140 pass** |
| Shared package tests (schemas, formatting, role policy, bank charge) | **28 / 28 pass** |
| Web tests (components, validation helpers) | **12 / 12 pass** |
| `tsc --noEmit` (strict) – shared, API, web | clean |
| ESLint (whole repo) | clean |
| Production build (API compiled + web bundle) | builds; compiled API starts and passes `/api/ready` |
| Migration drift (DB vs Prisma schema) | none |
| `npm audit --omit=dev` | 0 vulnerabilities (two transitive packages pinned via `overrides`) |
| End-to-end through the web dev proxy (create → upload → submit → SA approve → routed to Treasury → final approve) | passes |
| Wings end-to-end (wing required, own wings only, other-wing Sales Admin → 404, wing-scoped notifications, filter/report/dashboard) | 15 / 15 pass |
| Headless-browser tour (admin, field force, Sales Admin on mobile width) | renders, no console errors |
| CR2 end-to-end (new fields, bulk SA approval, Amount (CR) > deposit → 422, final approval with bank charge, report columns) | 15 / 15 pass; UI: row approve, inline Amount (CR), bulk approve + results, finance approve dialog – no console errors |
| Docker images / compose | **verified** (2026-09-27, Docker Desktop 4.92): images build, migrations + seed on start, healthchecks green, 24-step e2e through nginx passes, data/uploads survive restart, containers run non-root |

## What was built, by phase

| Phase | Delivered |
|---|---|
| 1 Setup | npm-workspaces monorepo, strict TS, ESLint/Prettier, `.env.example`, embedded PostgreSQL script, shared package |
| 2 Schema | 23 tables, UUID PKs, enums, FKs, indexes (incl. pg_trgm GIN for search), CHECK constraints, **append-only triggers** on audit/approval/history/workflow-action tables, idempotent seed |
| 3 Auth | argon2id, JWT access (15 min, memory only), rotating HttpOnly refresh cookie with **reuse detection**, lockout, forced password change, CSRF guard on cookie endpoints |
| 4 RBAC | DB-driven roles/permissions, multi-role users, `requirePermission` middleware, token-version invalidation, self-protection rules, locked ADMIN role |
| 5 Master data | Banks, accounts (bank-scoped), parties (server search), sales types (+`isSpecial`); soft status; admin UI |
| 6 Transactions | Partial drafts, `SAL-YYYY-NNNNNN` numbering (race-free counter), field-level edit rights per stage, optimistic locking, attachments (content-sniffed), history diffs |
| 7 Workflow engine | Declarative transition table + guards (`state-machine.ts`), single atomic `execute()` |
| 8 Sales Admin | Queue, claim/release/reassign, approve / return (category) / reject (terminal) with confirmation and reasons |
| 9 Finance | DB-configured routing rules (priority, conditions, effective dates, catch-all invariant, simulator), segregation of duties |
| 10 Correction | `CORRECTION_REQUIRED` with category + reason, correction, resubmission (new cycle, full re-review) |
| 11 Dashboard | Permission-driven KPI sections (Field Force, Sales Admin, per finance role, admin overview) with filters and recent activity |
| 12 Notifications | In-app notifications (transactional), bell with unread count, list page; channel abstraction for future e-mail/Teams |
| 13 Reports | Sales, approvals, rejections, user activity, audit – scoped, paginated, streamed CSV/XLSX export with formula-injection protection |
| 14 Audit | Append-only audit log with request id, IP, user agent, before/after; filterable UI with detail drawer |
| 15 Testing | Unit (state machine, rules, routing, duplicates, money, time zones), integration (auth, workflow, security, duplicates, attachments, admin, reports) |
| 16 Docker | Multi-stage API image (non-root, healthcheck, migrate-on-start), nginx-unprivileged web image with CSP, compose with healthchecks |
| 17 Hardening | Helmet/CSP, CORS allow-list, rate limits, `Cache-Control: no-store`, production secret guard, dependency audit, bootstrap admin script |

## Critical workflow scenarios covered by automated tests (spec §41)

1–7 create → submit → SA receives → SA approves → correct finance role receives → finance approves → `READY_FOR_PROCESSING`
(with approved snapshot + outbox event) · 8–10 finance returns → FF corrects → resubmits (cycle 2) · 11 history and approval
records intact across cycles · 12 unauthorised users (FF, auditor, wrong finance role) cannot approve · 13 self-approval blocked
even with the permission · 14 stale version → 409; two simultaneous reviewers → exactly one wins.

Additional: cross-user isolation (404 not 403), status can never be set via CRUD, DB-level immutability of audit/approval/history,
refresh-token reuse detection, lockout, forced password change, duplicate detection & resolution, attachment type/extension
spoofing, permission-checked downloads, routing-rule invariants, business-rule configuration, settings validation, CSV/XLSX export.

## Decisions made during implementation (beyond the architecture proposal)

- **Administrators do not create or approve transactions** by default (segregation of duties). Give a person an operational
  role explicitly if they must do both.
- **Drafts may be incomplete**; completeness, active master data, date limits and business rules are enforced at submit.
- **Mandatory supporting document** is implemented as a seeded, configurable `REQUIRED_FIELD` rule (`attachments`).
- **Out-of-scope records return 404**, so the API never reveals the existence of other users’ transactions.
- **Sales Admin data scope** = everything awaiting Sales Admin review **in their wings** + everything they acted on.
- Amounts are transported as decimal strings and compared in integer cents – no floating-point money.
- Timeline timestamps are strictly increasing within one DB transaction so entries never reorder.

## Known limitations

- Rate limiting and the permission/settings caches are in-process: correct for one API instance; use Redis (planned
  optional infra) before scaling horizontally. Role changes take effect within ≤30 s on other instances.
- Notifications are polled every 30 s (no WebSocket/SSE push). E-mail/Teams channels are not implemented (by design).
- Report exports are streamed and capped (`report.maxExportRows`); very large exports would benefit from background jobs.
- No virus scanning of uploads yet (the upload pipeline has the hook point: content is buffered and sniffed before storage).
- Only the local storage provider exists; S3/Azure/SharePoint providers implement the same `StorageProvider` interface.
- Scoping is by wing; finer territory/team scoping *within* a wing is not modelled.
- The UI is English-only; dates display in the browser locale, "today" calculations use `business.timezone` (default UTC –
  set it in Settings).
- Default currency is `USD` (Settings → `business.currency`); change it for UAT.

## Change requests

### 1. Wings – DOC, CBF, Fish, Feed, Milk (2026-09-28)

Everything else stays the same; transactions are now separated by business wing.

| Area | Behaviour |
|---|---|
| Master data | New **Wings** tab (code, name, active/inactive). Seeded: DOC, CBF, FISH (Fish), FEED (Feed), MILK (Milk). |
| Users | Each user gets wings, or **All wings** (includes wings added later). Wing changes are audited and sign the user out of existing sessions like role changes. |
| Transaction | **Wing is required** (first field of the form; pre-selected when the user has one wing). Only the owner can change it, and only while the transaction is Draft / Correction Required. It must be one of the Field Force user's wings. Changes appear in the timeline. |
| Field Force | Creates only in their own wings (`422 WING_NOT_ASSIGNED` otherwise); always sees their own transactions. |
| Sales Admin / finance | Queue, list, detail, notifications, claim, reassign and approve/return/reject are limited to their wings. Other wings answer 404 (existence not revealed). Anything they already acted on stays visible to them. |
| Routing | Routing rules have an optional **Wings** condition (e.g. “Feed → Treasury”); the simulator takes a wing. |
| Lists, reports, dashboard | Wing column and filter everywhere; reports and exports include Wing; dashboard adds **Transactions by Wing** for users who see several wings. |
| Integration readiness | `approved_snapshot.approvedData.wing` and the `wing` code on status-change events. |

Migration `20260928040428_wings` is data-safe: it creates the five wings, assigns **existing transactions to DOC** and gives
**existing users All wings**, so nothing disappears after the upgrade; administrators then narrow each user's wings.
Transaction numbers are unchanged (`SAL-YYYY-NNNNNN`, one sequence for all wings).

Defaults to confirm in UAT: wing names (seeded with the codes you gave); whether finance should be per wing or central
(both are supported); whether numbering should carry the wing (e.g. `DOC-2026-000001`); whether parties, bank accounts or
sales types should be restricted per wing (currently shared by all wings).

### 2. Transaction fields, Amount (CR) / bank charge, approval from the table (2026-09-30)

| Area | Behaviour |
|---|---|
| Master data | New tabs **Lines**, **Branches**, **CV Codes** (code, name, active/inactive; admin-managed). *Parties* is shown as **Farmers / Customers** (same data). Demo lists L01–L03, DHK/CTG/RAJ, CV-1001–1003 are seeded only with the demo users. |
| Transaction form | New fields **Line name**, **Branch code**, **CV code** (searchable dropdowns), **Bank branch / bank details** (free text, where the deposit came from). *Amount* is labelled **Deposit amount**, *Remarks* **Narration**, *Party* **Farmer / Customer**. All four new fields are required to submit (drafts may leave them empty). |
| Amount (CR) | Entered **only by Accountant / Treasury at the final approval** (approve dialog or directly in the Approvals table); required for final approval; must be > 0 and **≤ deposit amount** (`422` otherwise). |
| Bank charge | **Deposit amount − Amount (CR)**, 0 when equal; calculated in exact cents, stored with the transaction (DB CHECK keeps both consistent), shown live while typing, recorded in the history/audit and in the approved snapshot. |
| Approvals table | Per-row **Approve / Reject** buttons, **Amount (CR)** input and live bank charge for finance rows, document count, checkboxes with **Approve N / Reject N**. Bulk: up to 50 rows, confirmation shows count and total; reject asks one reason (optional category) for all. *Return for correction* stays on the detail page. |
| Bulk processing | `POST /api/transactions/bulk-approve` / `bulk-reject`: every item goes through exactly the same checks as a single action (wing, claim, duplicate, segregation of duties, version) in its **own DB transaction** – partial success, per-item results dialog. The audit entry of each item carries `bulk: true`. |
| Lists, filters, reports | Farmer / Customer, CV Code, Deposit, Amount (CR) columns (Line, Branch, Bank details, Bank charge available from the column menu); filters and search for line / branch / CV code / bank details / narration; sales report and exports add Line, Branch, CV Code, Amount (CR), Bank Charge, Bank Details, Narration. |
| Integration readiness | `approved_snapshot.schemaVersion` = 2 with `line`, `branch`, `cvCode`, `bankDetails`, `creditAmount`, `bankCharge`. |

Migration `20260930113943_line_branch_cv_credit_amount` only adds tables and nullable columns: existing transactions keep
their data and show the new fields as empty; transactions already under review can still be edited (only fields being
changed are checked for completeness).

Defaults to confirm in UAT: Line / Branch / CV code are independent lists (no Line → Branch → CV → Farmer chain yet);
no Excel import of master data yet; the bank charge rule (deposit − Amount (CR), Amount (CR) may not exceed the deposit).

## Recommended next steps (UAT)

1. Deploy with `docker compose up --build` (verified locally); set `business.timezone` and `business.currency`.
2. Walk through the UAT script: each role in the table in README; verify routing rules match real policy.
3. Confirm field lists editable by Sales Admin / Finance (Settings) and the mandatory-field rule.
4. Assign every user to their wings (Users screen); give central finance / auditors “All wings”. Confirm the wing names
   and whether any routing rule should depend on the wing.
5. Before production: HTTPS + `COOKIE_SECURE=true`, a dedicated DB role that does not own the tables, backups,
   centralised JSON log shipping, and Redis if running more than one API instance.
