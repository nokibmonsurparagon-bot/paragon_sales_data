import { Router } from 'express';
import { idParamSchema, roleCreateSchema, roleUpdateSchema } from '@paragon/shared';
import { authenticate, requirePermission } from '../../core/middleware.js';
import { created, ok, parseBody, parseParams } from '../../core/http.js';
import { rolesService } from './roles.service.js';

export const rolesRouter = Router();
rolesRouter.use(authenticate);

rolesRouter.get('/', requirePermission('ROLE_VIEW', 'USER_VIEW', 'SYSTEM_SETTINGS_VIEW'), async (_req, res) =>
  ok(res, await rolesService.list()),
);
rolesRouter.get('/:id', requirePermission('ROLE_VIEW'), async (req, res) =>
  ok(res, await rolesService.get(parseParams(idParamSchema, req).id)),
);
rolesRouter.post('/', requirePermission('ROLE_CREATE'), async (req, res) =>
  created(res, await rolesService.create(parseBody(roleCreateSchema, req)), 'Role created'),
);
rolesRouter.patch('/:id', requirePermission('ROLE_UPDATE'), async (req, res) =>
  ok(res, await rolesService.update(parseParams(idParamSchema, req).id, parseBody(roleUpdateSchema, req)), 'Role updated'),
);

export const permissionsRouter = Router();
permissionsRouter.use(authenticate);
permissionsRouter.get('/', requirePermission('ROLE_VIEW'), async (_req, res) => ok(res, await rolesService.listPermissions()));
