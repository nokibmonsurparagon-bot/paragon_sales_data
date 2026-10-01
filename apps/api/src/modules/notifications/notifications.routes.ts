import { Router } from 'express';
import { idParamSchema, notificationListQuerySchema } from '@paragon/shared';
import { authenticate } from '../../core/middleware.js';
import { currentUser, ok, parseParams, parseQuery } from '../../core/http.js';
import { notificationsService } from './notifications.service.js';

/** Every user can read only their own notifications. */
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get('/', async (req, res) =>
  ok(res, await notificationsService.list(currentUser(req).id, parseQuery(notificationListQuerySchema, req))),
);
notificationsRouter.get('/unread-count', async (req, res) =>
  ok(res, { count: await notificationsService.unreadCount(currentUser(req).id) }),
);
notificationsRouter.post('/read-all', async (req, res) =>
  ok(res, { updated: await notificationsService.markAllRead(currentUser(req).id) }),
);
notificationsRouter.post('/:id/read', async (req, res) =>
  ok(res, await notificationsService.markRead(currentUser(req).id, parseParams(idParamSchema, req).id)),
);
