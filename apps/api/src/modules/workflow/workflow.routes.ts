import { Router } from 'express';
import {
  businessRuleCreateSchema,
  businessRuleUpdateSchema,
  idParamSchema,
  workflowRuleCreateSchema,
  workflowRuleUpdateSchema,
  workflowSimulateSchema,
} from '@paragon/shared';
import { authenticate, requirePermission } from '../../core/middleware.js';
import { created, currentUser, ok, parseBody, parseParams } from '../../core/http.js';
import { rulesService } from '../rules/rules.service.js';
import { routingService } from './routing.service.js';

/** Finance routing rules – /api/workflow/rules */
export const workflowRouter = Router();
workflowRouter.use(authenticate);

workflowRouter.get('/rules', requirePermission('SYSTEM_SETTINGS_VIEW'), async (_req, res) => ok(res, await routingService.list()));
workflowRouter.post('/rules', requirePermission('SYSTEM_SETTINGS_UPDATE'), async (req, res) =>
  created(res, await routingService.create(parseBody(workflowRuleCreateSchema, req), currentUser(req)), 'Routing rule created'),
);
workflowRouter.patch('/rules/:id', requirePermission('SYSTEM_SETTINGS_UPDATE'), async (req, res) =>
  ok(
    res,
    await routingService.update(parseParams(idParamSchema, req).id, parseBody(workflowRuleUpdateSchema, req), currentUser(req)),
    'Routing rule updated',
  ),
);
workflowRouter.post('/rules/simulate', requirePermission('SYSTEM_SETTINGS_VIEW'), async (req, res) =>
  ok(res, await routingService.simulate(parseBody(workflowSimulateSchema, req))),
);

/** Business rules – /api/business-rules */
export const businessRulesRouter = Router();
businessRulesRouter.use(authenticate);

businessRulesRouter.get('/', requirePermission('SYSTEM_SETTINGS_VIEW'), async (_req, res) => ok(res, await rulesService.list()));
businessRulesRouter.post('/', requirePermission('SYSTEM_SETTINGS_UPDATE'), async (req, res) =>
  created(res, await rulesService.create(parseBody(businessRuleCreateSchema, req)), 'Business rule created'),
);
businessRulesRouter.patch('/:id', requirePermission('SYSTEM_SETTINGS_UPDATE'), async (req, res) =>
  ok(res, await rulesService.update(parseParams(idParamSchema, req).id, parseBody(businessRuleUpdateSchema, req)), 'Business rule updated'),
);
