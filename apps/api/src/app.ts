import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { prisma } from './core/db.js';
import { errorHandler, notFoundHandler } from './core/error-handler.js';
import { ok } from './core/http.js';
import { logger } from './core/logger.js';
import { apiRateLimit, requestContext } from './core/middleware.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { masterDataRouter } from './modules/master-data/master-data.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { auditRouter, dashboardRouter, reportsRouter } from './modules/reports/reports.routes.js';
import { permissionsRouter, rolesRouter } from './modules/roles/roles.routes.js';
import { clientConfigRouter, settingsRouter } from './modules/settings/settings.routes.js';
import { attachmentsRouter, transactionsRouter } from './modules/transactions/transactions.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { businessRulesRouter, workflowRouter } from './modules/workflow/workflow.routes.js';
import { docsRouter } from './openapi/openapi.js';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).requestId,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      customProps: (req) => ({ requestId: (req as Request).requestId, userId: (req as Request).user?.id }),
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // Swagger UI (development by default). Mounted before the strict CSP.
  if (env.swaggerEnabled) app.use('/api', helmet({ contentSecurityPolicy: false }), docsRouter());

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGIN.includes(origin)),
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', apiRateLimit, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => ok(res, { status: 'ok' }));
  app.get('/api/ready', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    ok(res, { status: 'ready' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/config/client', clientConfigRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/attachments', attachmentsRouter);
  app.use('/api/wings', masterDataRouter('wings'));
  app.use('/api/lines', masterDataRouter('lines'));
  app.use('/api/branches', masterDataRouter('branches'));
  app.use('/api/cv-codes', masterDataRouter('cv-codes'));
  app.use('/api/banks', masterDataRouter('banks'));
  app.use('/api/accounts', masterDataRouter('accounts'));
  app.use('/api/parties', masterDataRouter('parties'));
  app.use('/api/sales-types', masterDataRouter('sales-types'));
  app.use('/api/users', usersRouter);
  app.use('/api/roles', rolesRouter);
  app.use('/api/permissions', permissionsRouter);
  app.use('/api/workflow', workflowRouter);
  app.use('/api/business-rules', businessRulesRouter);
  app.use('/api/system-settings', settingsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/audit-logs', auditRouter);
  app.use('/api/reports', reportsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
