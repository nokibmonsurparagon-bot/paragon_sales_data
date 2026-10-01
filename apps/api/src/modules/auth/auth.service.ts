import { randomUUID } from 'node:crypto';
import { ERROR_CODES, type AuthUser, type ChangePasswordInput, type LoginInput } from '@paragon/shared';
import { env } from '../../config/env.js';
import { writeAudit } from '../../core/audit.js';
import { invalidateAuthz, loadAuthz } from '../../core/authz.js';
import { getContext } from '../../core/context.js';
import { prisma, withTransaction } from '../../core/db.js';
import { AuthenticationError, ValidationError } from '../../core/errors.js';
import {
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  signAccessToken,
  verifyDummyPassword,
  verifyPassword,
} from '../../core/security.js';
import { getSetting } from '../../core/settings.js';
import { authRepository } from './auth.repository.js';

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthUser;
}

const INVALID = () => new AuthenticationError('Invalid email or password', ERROR_CODES.INVALID_CREDENTIALS);

async function buildAuthUser(userId: string): Promise<AuthUser> {
  const [authz, user] = await Promise.all([loadAuthz(userId), authRepository.findUserById(userId)]);
  if (!authz || !user) throw new AuthenticationError();
  return {
    id: authz.user.id,
    email: authz.user.email,
    fullName: authz.user.fullName,
    mustChangePassword: user.mustChangePassword,
    roles: authz.user.roles.map(({ id, code, name }) => ({ id, code, name })),
    permissions: [...authz.user.permissions].sort(),
    wings: authz.user.allWings
      ? await prisma.wing.findMany({ where: { status: 'ACTIVE' }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } })
      : authz.user.wings,
    allWings: authz.user.allWings,
  };
}

async function issueSession(userId: string, tokenVersion: number, familyId: string = randomUUID()) {
  const refreshToken = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  const ctx = getContext();
  const record = await authRepository.createRefreshToken(
    prisma,
    {
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      familyId,
      expiresAt: refreshExpiresAt,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent?.slice(0, 500),
    },
  );
  return {
    record,
    refreshToken,
    refreshExpiresAt,
    accessToken: signAccessToken(userId, tokenVersion),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  };
}

export const authService = {
  async login(input: LoginInput): Promise<IssuedSession> {
    const user = await authRepository.findUserByEmail(input.email);
    if (!user) {
      await verifyDummyPassword(input.password);
      await writeAudit({ action: 'LOGIN_FAILED', entityType: 'User', newData: { email: input.email.toLowerCase(), reason: 'UNKNOWN_USER' }, userId: null, role: null });
      throw INVALID();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await writeAudit({ action: 'LOGIN_FAILED', entityType: 'User', entityId: user.id, userId: user.id, role: null, newData: { reason: 'LOCKED' } });
      throw new AuthenticationError(
        'Account temporarily locked after too many failed attempts. Try again later.',
        ERROR_CODES.ACCOUNT_LOCKED,
      );
    }

    const passwordOk = await verifyPassword(user.passwordHash, input.password);
    if (!passwordOk || user.status !== 'ACTIVE') {
      if (!passwordOk) {
        const [maxFailed, lockMinutes] = await Promise.all([
          getSetting('security.maxFailedLogins'),
          getSetting('security.lockoutMinutes'),
        ]);
        const failed = user.failedLoginCount + 1;
        const lockedUntil = failed >= maxFailed ? new Date(Date.now() + lockMinutes * 60_000) : null;
        await authRepository.recordFailedLogin(user.id, lockedUntil ? 0 : failed, lockedUntil);
      }
      await writeAudit({
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        userId: user.id,
        role: null,
        newData: { reason: passwordOk ? 'DISABLED' : 'BAD_PASSWORD' },
      });
      throw INVALID();
    }

    await authRepository.recordSuccessfulLogin(user.id);
    const session = await issueSession(user.id, user.tokenVersion);
    const authUser = await buildAuthUser(user.id);
    await writeAudit({
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      role: authUser.roles.map((r) => r.code).join(','),
    });
    return { ...session, user: authUser };
  },

  /** Rotates the refresh token. Presenting an already-used token revokes the whole family. */
  async refresh(rawToken: string | undefined): Promise<IssuedSession> {
    if (!rawToken) throw new AuthenticationError('No refresh token', ERROR_CODES.TOKEN_INVALID);
    const stored = await authRepository.findRefreshToken(hashRefreshToken(rawToken));
    if (!stored) throw new AuthenticationError('Invalid refresh token', ERROR_CODES.TOKEN_INVALID);

    if (stored.revokedAt) {
      await withTransaction(async (tx) => {
        await authRepository.revokeFamily(tx, stored.familyId);
        await writeAudit(
          { action: 'TOKEN_REUSE_DETECTED', entityType: 'User', entityId: stored.userId, userId: stored.userId, role: null, newData: { familyId: stored.familyId } },
          tx,
        );
      });
      throw new AuthenticationError('Session revoked. Please sign in again.', ERROR_CODES.TOKEN_INVALID);
    }
    if (stored.expiresAt <= new Date()) throw new AuthenticationError('Session expired', ERROR_CODES.TOKEN_EXPIRED);
    if (stored.user.status !== 'ACTIVE') throw new AuthenticationError('Account disabled', ERROR_CODES.TOKEN_INVALID);

    const session = await issueSession(stored.userId, stored.user.tokenVersion, stored.familyId);
    const rotated = await authRepository.markRotated(prisma, stored.id, session.record.id);
    if (!rotated) {
      // Lost a race with a concurrent refresh using the same token â†’ treat as reuse.
      await authRepository.revokeFamily(prisma, stored.familyId);
      throw new AuthenticationError('Session revoked. Please sign in again.', ERROR_CODES.TOKEN_INVALID);
    }
    return { ...session, user: await buildAuthUser(stored.userId) };
  },

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const stored = await authRepository.findRefreshToken(hashRefreshToken(rawToken));
    if (!stored) return;
    await withTransaction(async (tx) => {
      await authRepository.revokeFamily(tx, stored.familyId);
      await writeAudit({ action: 'LOGOUT', entityType: 'User', entityId: stored.userId, userId: stored.userId }, tx);
    });
  },

  me(userId: string): Promise<AuthUser> {
    return buildAuthUser(userId);
  },

  /** Changes the password, revokes every other session and returns a fresh session for this device. */
  async changePassword(userId: string, input: ChangePasswordInput): Promise<IssuedSession> {
    const user = await authRepository.findUserById(userId);
    if (!user) throw new AuthenticationError();
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new ValidationError('Validation failed', [{ path: 'currentPassword', message: 'Current password is incorrect' }]);
    }
    const hash = await hashPassword(input.newPassword);
    const updated = await withTransaction(async (tx) => {
      const u = await authRepository.updatePassword(tx, userId, hash, false);
      await authRepository.revokeAllForUser(tx, userId);
      await writeAudit({ action: 'PASSWORD_CHANGED', entityType: 'User', entityId: userId }, tx);
      return u;
    });
    invalidateAuthz(userId);
    const session = await issueSession(userId, updated.tokenVersion);
    return { ...session, user: await buildAuthUser(userId) };
  },
};
