import { Router } from 'express';
import { authenticate, csrfGuard, loginRateLimit } from '../../core/middleware.js';
import { authController } from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/login', loginRateLimit, authController.login);
authRouter.post('/refresh', csrfGuard, authController.refresh);
authRouter.post('/logout', csrfGuard, authController.logout);
authRouter.get('/me', authenticate, authController.me);
authRouter.post('/change-password', authenticate, loginRateLimit, authController.changePassword);
