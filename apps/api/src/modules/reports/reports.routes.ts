import { Router } from 'express';
import {
  auditListQuerySchema,
  dashboardQuerySchema,
  reportExportQuerySchema,
  reportQuerySchema,
  reportTypeParamSchema,
} from '@paragon/shared';
import { authenticate, requirePermission } from '../../core/middleware.js';
import { currentUser, ok, parseParams, parseQuery } from '../../core/http.js';
import { auditService } from '../audit/audit.service.js';
import { dashboardService } from '../dashboard/dashboard.service.js';
import { reportsService } from './reports.service.js';

export const reportsRouter = Router();
reportsRouter.use(authenticate);

reportsRouter.get('/:type', requirePermission('REPORT_VIEW'), async (req, res) =>
  ok(res, await reportsService.page(parseParams(reportTypeParamSchema, req).type, parseQuery(reportQuerySchema, req), currentUser(req))),
);

reportsRouter.get('/:type/export', requirePermission('REPORT_EXPORT'), async (req, res) => {
  const { type } = parseParams(reportTypeParamSchema, req);
  await reportsService.export(type, parseQuery(reportExportQuerySchema, req), currentUser(req), res);
});

export const auditRouter = Router();
auditRouter.use(authenticate);
auditRouter.get('/', requirePermission('AUDIT_VIEW'), async (req, res) => ok(res, await auditService.list(parseQuery(auditListQuerySchema, req))));

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);
dashboardRouter.get('/summary', async (req, res) =>
  ok(res, await dashboardService.summary(parseQuery(dashboardQuerySchema, req), currentUser(req))),
);
