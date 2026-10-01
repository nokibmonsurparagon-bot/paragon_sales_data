# Paragon – Sales Transaction Management & Approval Web Application

> Original requirements specification, as supplied by the project owner (2026-09-26).
> Section numbers are referenced from `docs/ARCHITECTURE.md`.
> Scope ends at `READY_FOR_PROCESSING`. **No UiPath / RPA / ERP integration.**

# ROLE

You are a senior enterprise full-stack architect and developer.

Build a production-ready Sales Transaction Management and Approval Web Application.

The application will be used by Field Force, Sales Admin, Accountant, Treasury, and Administrators.

IMPORTANT:

This project is ONLY the WEB APPLICATION.

DO NOT implement:

* UiPath integration
* ERP integration
* ERP API integration
* RPA API
* RPA worker
* ERP automation
* UiPath Orchestrator integration
* Any direct ERP communication

However, the architecture must be designed so that ERP/RPA integration can be added later without major changes to the existing application.

---

# 1. TECHNOLOGY STACK

Frontend: React, TypeScript, Vite, Material UI (MUI)

Backend: Node.js, TypeScript, Express.js

Database: PostgreSQL

ORM: Prisma

Authentication: JWT, Refresh token mechanism

Authorization: Role-Based Access Control (RBAC)

Validation: Zod

API: REST API, OpenAPI / Swagger

Logging: Pino

Testing: Vitest or Jest, Supertest

Infrastructure: Docker, Docker Compose

Optional infrastructure: Redis may be introduced later for caching/background jobs, but do not add unnecessary infrastructure unless required.

---

# 2. PROJECT OBJECTIVE

The system will digitize the following business process:

FIELD FORCE → SALES ADMIN REVIEW → SALES ADMIN APPROVAL → ACCOUNTANT / TREASURY REVIEW → FINAL APPROVAL → READY FOR NEXT SYSTEM

The final ERP/RPA processing is OUT OF SCOPE.

The web application must stop at: READY_FOR_PROCESSING

This status means that the transaction has completed all required approvals and is ready for a future external system.

---

# 3. CORE BUSINESS PROCESS

1. Field Force enters sales information.
2. Field Force saves as draft.
3. Field Force submits transaction.
4. Sales Admin receives submitted transaction.
5. Sales Admin reviews the transaction.
6. Sales Admin may edit permitted fields.
7. Sales Admin may approve or reject.
8. Approved transactions are routed to Accountant or Treasury.
9. Accountant/Treasury reviews the transaction.
10. Accountant/Treasury may approve or reject.
11. After final approval, transaction becomes READY_FOR_PROCESSING.
12. If rejected, transaction returns to the appropriate user for correction.
13. Every action is recorded in the audit history.

---

# 4. IMPORTANT ARCHITECTURAL PRINCIPLE

Do NOT use a simple boolean such as `approved = true`. Implement a proper workflow/state machine. The transaction must have an explicit status.

Example: DRAFT, SUBMITTED, SALES_ADMIN_REVIEW, SALES_ADMIN_REJECTED, SALES_ADMIN_APPROVED, FINANCE_REVIEW, FINANCE_REJECTED, FINANCE_APPROVED, READY_FOR_PROCESSING, CANCELLED

The backend must control all valid state transitions. Users must never be able to directly modify the status through a generic update API.

---

# 5. USER ROLES

ADMIN, FIELD_FORCE, SALES_ADMIN, ACCOUNTANT, TREASURY, AUDITOR

Do not hard-code authorization logic throughout the application. Use database-driven roles and permissions.

---

# 6. PERMISSIONS

USER_VIEW, USER_CREATE, USER_UPDATE, USER_DISABLE
ROLE_VIEW, ROLE_CREATE, ROLE_UPDATE
SALES_CREATE, SALES_VIEW_OWN, SALES_VIEW_ALL, SALES_EDIT, SALES_SUBMIT
SALES_ADMIN_REVIEW, SALES_ADMIN_EDIT, SALES_ADMIN_APPROVE, SALES_ADMIN_REJECT
FINANCE_REVIEW, FINANCE_EDIT, FINANCE_APPROVE, FINANCE_REJECT
EXCEPTION_VIEW, EXCEPTION_RESOLVE
REPORT_VIEW, REPORT_EXPORT
AUDIT_VIEW
SYSTEM_SETTINGS_VIEW, SYSTEM_SETTINGS_UPDATE

A role can contain multiple permissions. A user can have one or multiple roles if the architecture requires it.

---

# 7. FIELD FORCE

Must be able to: create sales transaction; save draft; edit draft; submit transaction; view their own transactions; view transaction status; view rejection/correction comments; correct rejected transactions; resubmit corrected transactions.

Must NOT: approve their own transaction; access unauthorized transactions; change workflow status manually; modify audit history.

---

# 8. SALES ADMIN

Must be able to: view submitted transactions; search; filter; review transaction details; edit permitted fields; add review comments; approve; reject; return for correction; view complete transaction history.

Approval/rejection must require confirmation. Rejection should require a reason.

---

# 9. ACCOUNTANT / TREASURY

The application must support configurable routing to either ACCOUNTANT or TREASURY. Do NOT permanently hard-code every transaction to Accountant. Create a workflow-routing mechanism.

Example: Sales Type A → Accountant; Sales Type B → Treasury; Amount > configured threshold → Treasury; Special transaction → Accountant.

The routing rules should be stored in the database. Administrators should be able to configure these rules.

---

# 10. SALES TRANSACTION

Fields: 1. Transaction Date, 2. Field Force Name, 3. Party Name, 4. Amount, 5. Bank, 6. Account, 7. Payment Reference, 8. Sales Type, 9. Remarks, 10. Supporting Document

The architecture must allow additional fields to be added later.

Each transaction must have: UUID, Transaction Number, Created By, Created At, Updated By, Updated At, Current Status, Current Assigned Role, Current Assigned User if applicable, Version, Rejection Reason, Latest Comment.

---

# 11. TRANSACTION NUMBER

Generate a human-readable transaction number, e.g. SAL-2026-000001. Must be unique. Use UUID as the database primary key. Do not use the transaction number as the primary key.

---

# 12. FORM REQUIREMENTS

Required field indicators; client-side validation; server-side validation; clear validation messages; amount validation; date validation; dropdowns for master data; confirmation before submission; unsaved changes warning.

Frontend validation is for user experience. Backend validation is authoritative. Never trust frontend validation.

---

# 13. MASTER DATA

Master-data tables: Banks, Accounts, Parties, Sales Types. Do not hard-code these values in React components. Administrators should be able to manage master data.

Bank: id, code, name, status. Party: id, code, name, status. Account: id, code, name, bank_id, status. Sales Type: id, code, name, status.

---

# 14. DUPLICATE DETECTION

Potential duplicate criteria: Transaction Date, Party, Amount, Bank, Account, Payment Reference.

Classify as EXACT_DUPLICATE, POSSIBLE_DUPLICATE, NO_DUPLICATE. Do not silently delete or reject duplicates. Show an appropriate warning. Allow authorized users to resolve the situation. Keep an audit record.

---

# 15. WORKFLOW STATE MACHINE

DRAFT → SUBMITTED; SUBMITTED → SALES_ADMIN_REVIEW; SALES_ADMIN_REVIEW → SALES_ADMIN_APPROVED; SALES_ADMIN_REVIEW → SALES_ADMIN_REJECTED; SALES_ADMIN_APPROVED → FINANCE_REVIEW; FINANCE_REVIEW → FINANCE_APPROVED; FINANCE_REVIEW → FINANCE_REJECTED; FINANCE_APPROVED → READY_FOR_PROCESSING; REJECTED → DRAFT / CORRECTION_REQUIRED

Implement transitions through a workflow service. Do not duplicate workflow rules across controllers.

---

# 16. APPROVAL RULES

A user cannot approve their own transaction. A user cannot approve without the required permission. A transaction cannot be approved from an invalid state. Rejection requires a reason. Approval requires confirmation. Every approval/rejection must create a history record. Users cannot modify historical approval records.

---

# 17. TRANSACTION HISTORY

For every important action store: Transaction ID, Action, Previous Status, New Status, User, Role, Comment, Timestamp. The UI must display this as a timeline.

---

# 18. AUDIT LOG

Separate append-only audit log. Actions: LOGIN, LOGOUT, CREATE_TRANSACTION, UPDATE_TRANSACTION, SUBMIT_TRANSACTION, APPROVE_TRANSACTION, REJECT_TRANSACTION, ASSIGN_TRANSACTION, CHANGE_MASTER_DATA, CREATE_USER, UPDATE_USER, CHANGE_ROLE, CHANGE_PERMISSION, CHANGE_WORKFLOW_RULE.

Fields: ID, User ID, Role, Action, Entity Type, Entity ID, Previous Data, New Data, IP Address, User Agent, Timestamp, Request ID. Normal users must not be able to edit or delete audit records.

---

# 19. EXCEPTION / CORRECTION MANAGEMENT

Correction categories: ACCOUNT_ERROR, BANK_ERROR, PARTY_ERROR, AMOUNT_ERROR, DOCUMENT_ERROR, BUSINESS_RULE_ERROR, OTHER. A reviewer can return a transaction for correction; Field Force sees status CORRECTION_REQUIRED with the reason, corrects, and resubmits.

---

# 20. DASHBOARD

Field Force: Drafts, Submitted, Under Review, Correction Required, Approved, Ready for Processing.
Sales Admin: Pending Review, Approved Today, Rejected, Correction Required, Total Transactions.
Accountant / Treasury: Pending Review, Approved, Rejected, Correction Required.
Admin: Total Transactions, Pending Sales Admin, Pending Finance, Ready for Processing, Rejected, Correction Required, Users, Recent Activity.

# 21. DASHBOARD FILTERS

Date range, status, Field Force, Party, Bank, Account, Sales Type, Amount range. Server-side filtering.

# 22. NOTIFICATIONS

In-app notifications. Table: id, user_id, type, title, message, entity_type, entity_id, is_read, created_at, read_at. Architecture should allow email/Teams later; do not implement external integration now.

# 23. SEARCH

Global search by Transaction Number, Party, Payment Reference, Field Force, Amount, Status. Use indexed fields.

# 24. PAGINATION

Server-side pagination on all large tables, e.g. `GET /api/transactions?page=1&limit=20`.

# 25. FILTERING AND SORTING

Status, Date, Amount, Party, User, Bank, Account, Sales Type. Server-side sorting.

# 26. REPORTING

Sales Transaction, Approval, Rejection, User Activity, Audit reports. CSV/Excel export for authorized users; export must respect permissions.

# 27. FILE ATTACHMENTS

File type validation, size validation, secure access, permission-based download, metadata, upload history. Do not store large files in PostgreSQL. Storage abstraction (local for dev; S3 / Azure Blob / SharePoint later). No cloud integration unless required.

# 28. DATABASE DESIGN

Minimum tables: users, roles, permissions, user_roles, role_permissions, sales_transactions, sales_transaction_history, sales_transaction_attachments, workflow_instances, workflow_actions, approval_records, notifications, audit_logs, banks, accounts, parties, sales_types, workflow_rules, system_settings.

created_at/updated_at where appropriate; UUID PKs; indexes on transaction_number, status, created_by, party_id, transaction_date, created_at, assigned_role, assigned_user; FKs and constraints.

# 29. API ARCHITECTURE

Controller → Service → Repository → Prisma → PostgreSQL. Business rules in services/domain logic, not route handlers or React components.

# 30. API ENDPOINTS

Auth: POST /api/auth/login, POST /api/auth/refresh, POST /api/auth/logout, GET /api/auth/me
Transactions: GET/POST /api/transactions, GET/PATCH /api/transactions/:id, POST /api/transactions/:id/submit, /resubmit, /cancel, GET /api/transactions/:id/history
Approval: POST /api/transactions/:id/approve, /reject, /return
Master data: GET/POST /api/banks, PATCH /api/banks/:id (same for accounts, parties, sales-types)
Users: GET/POST /api/users, PATCH /api/users/:id
Roles: GET/POST /api/roles, PATCH /api/roles/:id
Workflow: GET/POST /api/workflow/rules, PATCH /api/workflow/rules/:id
Notifications: GET /api/notifications, POST /api/notifications/:id/read
Dashboard: GET /api/dashboard/summary
Audit: GET /api/audit-logs

# 31. API RESPONSE FORMAT

Success: `{ "success": true, "data": {}, "message": "...", "requestId": "..." }`
Error: `{ "success": false, "error": { "code": "TRANSACTION_INVALID", "message": "...", "details": [] }, "requestId": "..." }`
No stack traces to normal users.

# 32. SECURITY

Argon2/bcrypt, JWT, refresh tokens, RBAC, input validation, rate limiting, Helmet, CORS, secure headers, SQL-injection protection, XSS protection, CSRF protection where applicable, secure file upload, secrets in env vars only, audit logging.

# 33. DATA OWNERSHIP

Field Force sees own; Sales Admin sees their scope; Accountant/Treasury see their assignments/team; Admin sees all; Auditor read-only. Enforced at API level.

# 34. CONCURRENCY

Optimistic locking with version numbers; mismatched version → 409 Conflict.

# 35. TRANSACTION SAFETY

Approval is atomic: validate permission, status, business rules; update status; create approval record, history, notification, audit — in one DB transaction.

# 36. BUSINESS RULE ENGINE

Configurable rules service: min/max amount, required fields, approval routing, required approval level, party restrictions, account restrictions. Not scattered.

# 37. FRONTEND STRUCTURE

src/{components, pages, layouts, features, hooks, services, api, store, types, utils, routes, constants}. Features: auth, transactions, approvals, users, roles, master-data, workflow, notifications, dashboard, audit.

# 38. FRONTEND ROUTING

/login, /dashboard, /transactions, /transactions/new, /transactions/:id, /transactions/:id/edit, /approvals, /approvals/:id, /notifications, /master-data, /users, /roles, /workflow-rules, /audit-logs. Permission-protected.

# 39. UI REQUIREMENTS

Sidebar, top nav, user profile, notification icon, breadcrumbs, status badges, data tables, filters, pagination, modal confirmations, form validation, timeline history, responsive. Clean and practical.

# 40. STATUS COLORS

Semantic status indicators, always with text labels.

# 41. TESTING

Unit: validation, permissions, workflow transitions, business rules, duplicate detection.
Integration: auth, create, submit, approve, reject, correct, resubmit.
Security: unauthorized access, role restrictions, cross-user access, approval without permission, self-approval.
Critical flow: create → submit → SA receives → SA approves → correct finance role receives → finance approves → READY_FOR_PROCESSING; finance rejects → FF corrects → resubmits; audit intact; unauthorized cannot approve; FF cannot self-approve; concurrent updates handled.

# 42. API DOCUMENTATION

OpenAPI/Swagger (auth, params, body, response, error codes, authorization). Available in development.

# 43. LOGGING

Structured logs with requestId; request, status, user, endpoint, duration, errors. Never log passwords/tokens/sensitive data.

# 44. ENVIRONMENT CONFIGURATION

DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, PORT, NODE_ENV, CORS_ORIGIN, FILE_STORAGE_PATH. Provide `.env.example`. Never commit real `.env`.

# 45. DOCKER

Frontend, backend, PostgreSQL via Docker Compose; `docker compose up`.

# 46. DATABASE MIGRATIONS

Prisma migrations only.

# 47. SEED DATA

Roles, permissions, users, banks, accounts, parties, sales types, workflow rules. Dev credentials clearly marked as development-only.

# 48. ERROR HANDLING

ValidationError 400, AuthenticationError 401, AuthorizationError 403, NotFoundError 404, ConflictError 409, BusinessRuleError 422, 500 internal.

# 49. FUTURE INTEGRATION REQUIREMENT

No UiPath/ERP code. Future consumers need: Transaction ID, Transaction Number, Approved Data, Approval History, Relevant Attachments, Final Approval Timestamp. The web application remains the system of record.

# 50. DEVELOPMENT APPROACH (PHASES)

1 Architecture & setup · 2 PostgreSQL + Prisma schema · 3 Authentication · 4 RBAC · 5 Master Data · 6 Sales Transaction · 7 Workflow Engine · 8 Sales Admin Approval · 9 Accountant/Treasury Approval · 10 Correction/Rejection · 11 Dashboard · 12 Notifications · 13 Reporting · 14 Audit · 15 Testing · 16 Docker · 17 Security Hardening

# 51. DEVELOPMENT RULES

Inspect before modifying; don't overwrite working code; reuse; strict TypeScript; modular business logic; clean architecture; minimal dependencies; no duplication; tests for important logic.

Before each feature explain: requirement, DB changes, backend, API, frontend, security, testing.
After each feature report: files created/modified, DB changes, API changes, how to run, how to test, known limitations, next step.

# 52. DEFINITION OF DONE

Backend + frontend + migration + validation + authorization + error handling + audit/history + tests + API docs + working UI + no TS errors + no lint errors + no regressions.

# 53. FIRST TASK

Analyze the spec; propose architecture, folder structure, ERD, entities, workflow states/transitions, API modules, frontend modules, security considerations, ambiguities/risks. Wait for approval before Phase 1.
