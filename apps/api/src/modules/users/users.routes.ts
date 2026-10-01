import { Router } from 'express';
import { idParamSchema, resetPasswordSchema, userCreateSchema, userListQuerySchema, userUpdateSchema } from '@paragon/shared';
import { authenticate, requirePermission } from '../../core/middleware.js';
import { created, currentUser, ok, parseBody, parseParams, parseQuery } from '../../core/http.js';
import { usersService } from './users.service.js';

/** Controller functions are inline: they only parse input, call the service and shape the response. */
export const usersRouter = Router();
usersRouter.use(authenticate);

usersRouter.get(
  '/lookup',
  requirePermission('USER_VIEW', 'SALES_VIEW_ALL', 'SALES_ADMIN_REVIEW', 'FINANCE_REVIEW', 'TRANSACTION_ASSIGN', 'REPORT_VIEW', 'AUDIT_VIEW'),
  async (req, res) => ok(res, await usersService.lookup(parseQuery(userListQuerySchema, req))),
);

usersRouter.get('/', requirePermission('USER_VIEW'), async (req, res) =>
  ok(res, await usersService.list(parseQuery(userListQuerySchema, req))),
);

usersRouter.get('/:id', requirePermission('USER_VIEW'), async (req, res) =>
  ok(res, await usersService.get(parseParams(idParamSchema, req).id)),
);

usersRouter.post('/', requirePermission('USER_CREATE'), async (req, res) =>
  created(res, await usersService.create(parseBody(userCreateSchema, req)), 'User created'),
);

usersRouter.patch('/:id', requirePermission('USER_UPDATE', 'USER_DISABLE'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req);
  const input = parseBody(userUpdateSchema, req);
  const actor = currentUser(req);
  // USER_DISABLE alone may only change status.
  if (!actor.permissions.has('USER_UPDATE')) {
    input.fullName = undefined;
    input.roleIds = undefined;
    input.wingIds = undefined;
    input.allWings = undefined;
  }
  ok(res, await usersService.update(id, input, actor), 'User updated');
});

usersRouter.post('/:id/reset-password', requirePermission('USER_UPDATE'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req);
  await usersService.resetPassword(id, parseBody(resetPasswordSchema, req).newPassword);
  ok(res, null, 'Password reset. The user must change it at next sign-in.');
});
