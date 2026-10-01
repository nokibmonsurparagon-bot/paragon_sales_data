import type { Request, Response } from 'express';
import { changePasswordSchema, loginSchema, type LoginResult } from '@paragon/shared';
import { currentUser, ok, parseBody } from '../../core/http.js';
import { REFRESH_COOKIE, refreshCookieOptions } from '../../core/security.js';
import { authService, type IssuedSession } from './auth.service.js';

function sendSession(res: Response, session: IssuedSession, message?: string): void {
  res.cookie(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions(session.refreshExpiresAt.getTime() - Date.now()));
  const data: LoginResult = { accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user };
  ok(res, data, message);
}

function refreshCookie(req: Request): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
}

export const authController = {
  async login(req: Request, res: Response) {
    const input = parseBody(loginSchema, req);
    sendSession(res, await authService.login(input), 'Signed in');
  },

  async refresh(req: Request, res: Response) {
    try {
      sendSession(res, await authService.refresh(refreshCookie(req)));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      throw err;
    }
  },

  async logout(req: Request, res: Response) {
    await authService.logout(refreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    ok(res, null, 'Signed out');
  },

  async me(req: Request, res: Response) {
    ok(res, await authService.me(currentUser(req).id));
  },

  async changePassword(req: Request, res: Response) {
    const input = parseBody(changePasswordSchema, req);
    sendSession(res, await authService.changePassword(currentUser(req).id, input), 'Password changed');
  },
};
