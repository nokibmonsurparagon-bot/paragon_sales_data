import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi, type RouteConfig } from '@asteasolutions/zod-to-openapi';
import { Router, type NextFunction, type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { z } from 'zod';
import * as S from '@paragon/shared';
import { ERROR_CODES } from '@paragon/shared';
import { logger } from '../core/logger.js';

extendZodWithOpenApi(z);

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

interface Endpoint {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  /** Required permission(s) (any-of), `authenticated`, or `public`. */
  auth: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  multipart?: boolean;
  binary?: string;
}

const id = S.idParamSchema;
const typeParam = S.reportTypeParamSchema;
const keyParam = z.object({ key: z.enum(S.SETTING_KEYS as [string, ...string[]]) });

const ENDPOINTS: Endpoint[] = [
  // Auth
  { method: 'post', path: '/auth/login', tag: 'Auth', summary: 'Sign in; sets the HttpOnly refresh cookie', auth: 'public', body: S.loginSchema },
  { method: 'post', path: '/auth/refresh', tag: 'Auth', summary: 'Rotate the refresh token (cookie) and issue a new access token. Requires header X-Requested-With: XMLHttpRequest', auth: 'refresh cookie' },
  { method: 'post', path: '/auth/logout', tag: 'Auth', summary: 'Revoke the refresh-token family and clear the cookie', auth: 'refresh cookie' },
  { method: 'get', path: '/auth/me', tag: 'Auth', summary: 'Current user with roles and effective permissions', auth: 'authenticated' },
  { method: 'post', path: '/auth/change-password', tag: 'Auth', summary: 'Change own password (revokes other sessions)', auth: 'authenticated', body: S.changePasswordSchema },
  { method: 'get', path: '/config/client', tag: 'System', summary: 'Non-sensitive client configuration', auth: 'authenticated' },
  { method: 'get', path: '/health', tag: 'System', summary: 'Liveness probe', auth: 'public' },
  { method: 'get', path: '/ready', tag: 'System', summary: 'Readiness probe (database reachable)', auth: 'public' },

  // Transactions
  { method: 'get', path: '/transactions', tag: 'Transactions', summary: 'List/search transactions (server-side pagination, filters, sorting; data scope enforced)', auth: 'SALES_VIEW_OWN | SALES_VIEW_ALL | SALES_ADMIN_REVIEW | FINANCE_REVIEW', query: S.transactionListQuerySchema },
  { method: 'post', path: '/transactions', tag: 'Transactions', summary: 'Create a draft (fields optional; status cannot be set)', auth: 'SALES_CREATE', body: S.transactionCreateSchema },
  { method: 'get', path: '/transactions/{id}', tag: 'Transactions', summary: 'Transaction detail incl. allowedActions and editableFields for the caller', auth: 'view permissions', params: id },
  { method: 'patch', path: '/transactions/{id}', tag: 'Transactions', summary: 'Edit permitted fields (optimistic locking via version → 409 on conflict)', auth: 'SALES_EDIT | SALES_ADMIN_EDIT | FINANCE_EDIT', params: id, body: S.transactionUpdateSchema },
  { method: 'get', path: '/transactions/{id}/history', tag: 'Transactions', summary: 'Timeline', auth: 'view permissions', params: id },
  { method: 'post', path: '/transactions/{id}/submit', tag: 'Workflow', summary: 'DRAFT → SALES_ADMIN_REVIEW', auth: 'SALES_SUBMIT (owner)', params: id, body: S.simpleActionSchema },
  { method: 'post', path: '/transactions/{id}/resubmit', tag: 'Workflow', summary: 'CORRECTION_REQUIRED → SALES_ADMIN_REVIEW', auth: 'SALES_SUBMIT (owner)', params: id, body: S.simpleActionSchema },
  { method: 'post', path: '/transactions/{id}/cancel', tag: 'Workflow', summary: 'Cancel (owner: DRAFT/CORRECTION_REQUIRED; TRANSACTION_CANCEL_ANY: any active)', auth: 'SALES_EDIT | TRANSACTION_CANCEL_ANY', params: id, body: S.simpleActionSchema },
  { method: 'post', path: '/transactions/{id}/approve', tag: 'Workflow', summary: 'Approve at the current stage (SA → routed finance role; finance → READY_FOR_PROCESSING, requires creditAmount = Amount (CR) ≤ amount; bank charge = amount − creditAmount)', auth: 'SALES_ADMIN_APPROVE | FINANCE_APPROVE (not own; SoD)', params: id, body: S.approveSchema },
  { method: 'post', path: '/transactions/bulk-approve', tag: 'Workflow', summary: 'Approve up to 50 transactions; each item is checked and committed on its own (partial success, per-item results)', auth: 'SALES_ADMIN_APPROVE | FINANCE_APPROVE', body: S.bulkApproveSchema },
  { method: 'post', path: '/transactions/bulk-reject', tag: 'Workflow', summary: 'Reject up to 50 transactions with one reason; per-item results', auth: 'SALES_ADMIN_REJECT | FINANCE_REJECT', body: S.bulkRejectSchema },
  { method: 'post', path: '/transactions/{id}/reject', tag: 'Workflow', summary: 'Reject (terminal). Reason required', auth: 'SALES_ADMIN_REJECT | FINANCE_REJECT', params: id, body: S.rejectSchema },
  { method: 'post', path: '/transactions/{id}/return', tag: 'Workflow', summary: 'Return for correction. Reason and category required', auth: 'SALES_ADMIN_REJECT | FINANCE_REJECT', params: id, body: S.returnSchema },
  { method: 'post', path: '/transactions/{id}/claim', tag: 'Workflow', summary: 'Claim for review', auth: 'SALES_ADMIN_REVIEW | FINANCE_REVIEW', params: id, body: S.claimSchema },
  { method: 'post', path: '/transactions/{id}/release', tag: 'Workflow', summary: 'Release claim', auth: 'claimer | TRANSACTION_ASSIGN', params: id, body: S.claimSchema },
  { method: 'post', path: '/transactions/{id}/reassign', tag: 'Workflow', summary: 'Assign to an eligible reviewer', auth: 'TRANSACTION_ASSIGN', params: id, body: S.reassignSchema },
  { method: 'get', path: '/transactions/{id}/duplicates', tag: 'Duplicates', summary: 'Matching transactions', auth: 'view permissions', params: id },
  { method: 'post', path: '/transactions/{id}/duplicates/resolve', tag: 'Duplicates', summary: 'Resolve a duplicate warning', auth: 'EXCEPTION_RESOLVE', params: id, body: S.resolveDuplicateSchema },
  { method: 'get', path: '/transactions/{id}/attachments', tag: 'Attachments', summary: 'List attachments', auth: 'view permissions', params: id },
  { method: 'post', path: '/transactions/{id}/attachments', tag: 'Attachments', summary: 'Upload (multipart field "file"; PDF/JPG/PNG/XLSX; content-sniffed)', auth: 'editor of the transaction', params: id, multipart: true },
  { method: 'get', path: '/attachments/{id}/download', tag: 'Attachments', summary: 'Download (permission-checked)', auth: 'view permissions', params: id, binary: 'application/octet-stream' },
  { method: 'delete', path: '/attachments/{id}', tag: 'Attachments', summary: 'Soft-delete', auth: 'editor of the transaction', params: id },

  // Master data
  ...S.MASTER_DATA_ENTITIES.flatMap((e): Endpoint[] => [
    { method: 'get', path: `/${e}`, tag: 'Master Data', summary: `List ${e}`, auth: 'authenticated', query: S.masterDataListQuerySchema },
    { method: 'get', path: `/${e}/{id}`, tag: 'Master Data', summary: `Get ${e}`, auth: 'authenticated', params: id },
    { method: 'post', path: `/${e}`, tag: 'Master Data', summary: `Create ${e}`, auth: 'MASTER_DATA_MANAGE', body: S.masterDataCreateSchemas[e] },
    { method: 'patch', path: `/${e}/{id}`, tag: 'Master Data', summary: `Update ${e}`, auth: 'MASTER_DATA_MANAGE', params: id, body: S.masterDataUpdateSchemas[e] },
  ]),

  // Users & roles
  { method: 'get', path: '/users', tag: 'Users', summary: 'List users', auth: 'USER_VIEW', query: S.userListQuerySchema },
  { method: 'get', path: '/users/lookup', tag: 'Users', summary: 'Active-user picker', auth: 'reviewer/report permissions', query: S.userListQuerySchema },
  { method: 'get', path: '/users/{id}', tag: 'Users', summary: 'Get user', auth: 'USER_VIEW', params: id },
  { method: 'post', path: '/users', tag: 'Users', summary: 'Create user (temporary password; must change at first sign-in)', auth: 'USER_CREATE', body: S.userCreateSchema },
  { method: 'patch', path: '/users/{id}', tag: 'Users', summary: 'Update user / roles / status', auth: 'USER_UPDATE | USER_DISABLE', params: id, body: S.userUpdateSchema },
  { method: 'post', path: '/users/{id}/reset-password', tag: 'Users', summary: 'Reset password', auth: 'USER_UPDATE', params: id, body: S.resetPasswordSchema },
  { method: 'get', path: '/roles', tag: 'Roles', summary: 'List roles', auth: 'ROLE_VIEW' },
  { method: 'get', path: '/roles/{id}', tag: 'Roles', summary: 'Get role', auth: 'ROLE_VIEW', params: id },
  { method: 'post', path: '/roles', tag: 'Roles', summary: 'Create role', auth: 'ROLE_CREATE', body: S.roleCreateSchema },
  { method: 'patch', path: '/roles/{id}', tag: 'Roles', summary: 'Update role / permissions', auth: 'ROLE_UPDATE', params: id, body: S.roleUpdateSchema },
  { method: 'get', path: '/permissions', tag: 'Roles', summary: 'Permission catalogue', auth: 'ROLE_VIEW' },

  // Workflow & rules & settings
  { method: 'get', path: '/workflow/rules', tag: 'Workflow Rules', summary: 'Finance routing rules', auth: 'SYSTEM_SETTINGS_VIEW' },
  { method: 'post', path: '/workflow/rules', tag: 'Workflow Rules', summary: 'Create routing rule', auth: 'SYSTEM_SETTINGS_UPDATE', body: S.workflowRuleCreateSchema },
  { method: 'patch', path: '/workflow/rules/{id}', tag: 'Workflow Rules', summary: 'Update routing rule', auth: 'SYSTEM_SETTINGS_UPDATE', params: id, body: S.workflowRuleUpdateSchema },
  { method: 'post', path: '/workflow/rules/simulate', tag: 'Workflow Rules', summary: 'Which rule/role would a transaction route to', auth: 'SYSTEM_SETTINGS_VIEW', body: S.workflowSimulateSchema },
  { method: 'get', path: '/business-rules', tag: 'Business Rules', summary: 'List business rules', auth: 'SYSTEM_SETTINGS_VIEW' },
  { method: 'post', path: '/business-rules', tag: 'Business Rules', summary: 'Create business rule', auth: 'SYSTEM_SETTINGS_UPDATE', body: S.businessRuleCreateSchema },
  { method: 'patch', path: '/business-rules/{id}', tag: 'Business Rules', summary: 'Update business rule', auth: 'SYSTEM_SETTINGS_UPDATE', params: id, body: S.businessRuleUpdateSchema },
  { method: 'get', path: '/system-settings', tag: 'System', summary: 'List settings', auth: 'SYSTEM_SETTINGS_VIEW' },
  { method: 'patch', path: '/system-settings/{key}', tag: 'System', summary: 'Update a setting', auth: 'SYSTEM_SETTINGS_UPDATE', params: keyParam, body: S.settingUpdateSchema },

  // Notifications, dashboard, audit, reports
  { method: 'get', path: '/notifications', tag: 'Notifications', summary: 'Own notifications', auth: 'authenticated', query: S.notificationListQuerySchema },
  { method: 'get', path: '/notifications/unread-count', tag: 'Notifications', summary: 'Unread count', auth: 'authenticated' },
  { method: 'post', path: '/notifications/{id}/read', tag: 'Notifications', summary: 'Mark read', auth: 'authenticated (own)', params: id },
  { method: 'post', path: '/notifications/read-all', tag: 'Notifications', summary: 'Mark all read', auth: 'authenticated' },
  { method: 'get', path: '/dashboard/summary', tag: 'Dashboard', summary: 'Role-aware KPI sections and recent activity', auth: 'authenticated', query: S.dashboardQuerySchema },
  { method: 'get', path: '/audit-logs', tag: 'Audit', summary: 'Audit log (read-only)', auth: 'AUDIT_VIEW', query: S.auditListQuerySchema },
  { method: 'get', path: '/reports/{type}', tag: 'Reports', summary: 'Report page', auth: 'REPORT_VIEW (+AUDIT_VIEW for audit reports)', params: typeParam, query: S.reportQuerySchema },
  { method: 'get', path: '/reports/{type}/export', tag: 'Reports', summary: 'Stream CSV/XLSX export', auth: 'REPORT_EXPORT', params: typeParam, query: S.reportExportQuerySchema, binary: 'text/csv' },
];

const ERROR_DESCRIPTION = `
All responses use a common envelope.

* Success: \`{ "success": true, "data": …, "message"?: string, "requestId": string }\`
* Error: \`{ "success": false, "error": { "code", "message", "details": [{ path, message }] }, "requestId" }\`

HTTP status mapping: 400 validation · 401 authentication · 403 authorization · 404 not found (also for out-of-scope
records) · 409 conflict (optimistic lock / unique key) · 413/415 upload · 422 business rule · 429 rate limit · 500.

Error codes: ${Object.values(ERROR_CODES).join(', ')}.

Authentication: send \`Authorization: Bearer <accessToken>\`. The refresh token lives in an HttpOnly cookie
scoped to /api/auth. Scope ends at READY_FOR_PROCESSING; no ERP/RPA integration is exposed.`;

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });

  const success = z.object({ success: z.literal(true), data: z.unknown(), message: z.string().optional(), requestId: z.string() });
  const failure = z.object({
    success: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.array(z.object({ path: z.string().optional(), message: z.string(), code: z.string().optional() })),
    }),
    requestId: z.string(),
  });
  const Success = registry.register('SuccessResponse', success);
  const Failure = registry.register('ErrorResponse', failure);
  const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: Failure } } });

  for (const ep of ENDPOINTS) {
    const route: RouteConfig = {
      method: ep.method,
      path: ep.path,
      tags: [ep.tag],
      summary: ep.summary,
      description: `**Authorization:** ${ep.auth}`,
      ...(ep.auth === 'public' || ep.auth === 'refresh cookie' ? {} : { security: [{ bearerAuth: [] }] }),
      request: {
        ...(ep.params ? { params: ep.params } : {}),
        ...(ep.query ? { query: ep.query } : {}),
        ...(ep.body ? { body: { content: { 'application/json': { schema: ep.body } } } } : {}),
        ...(ep.multipart
          ? { body: { content: { 'multipart/form-data': { schema: z.object({ file: z.string().describe('Binary file content') }) } } } }
          : {}),
      },
      responses: {
        200: ep.binary
          ? { description: 'File stream', content: { [ep.binary]: { schema: z.string() } } }
          : { description: 'Success', content: { 'application/json': { schema: Success } } },
        400: errorResponse('Validation error'),
        401: errorResponse('Not authenticated'),
        403: errorResponse('Not authorized'),
        404: errorResponse('Not found / out of scope'),
        409: errorResponse('Conflict'),
        422: errorResponse('Business rule violation'),
      },
    };
    try {
      registry.registerPath(route);
    } catch (err) {
      logger.warn({ err, path: ep.path }, 'OpenAPI: could not document endpoint');
    }
  }

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: { title: 'Paragon Sales Transaction API', version: '1.0.0', description: ERROR_DESCRIPTION },
    servers: [{ url: '/api' }],
  });
}

export function docsRouter(): Router {
  const router = Router();
  let doc: ReturnType<typeof buildOpenApiDocument> | null = null;
  const getDoc = () => (doc ??= buildOpenApiDocument());
  router.get('/docs.json', (_req, res) => {
    res.json(getDoc());
  });
  router.use('/docs', swaggerUi.serve, (req: Request, res: Response, next: NextFunction) => swaggerUi.setup(getDoc())(req, res, next));
  return router;
}
