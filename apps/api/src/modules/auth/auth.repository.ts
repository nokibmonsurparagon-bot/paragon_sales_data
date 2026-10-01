import { prisma, type Db } from '../../core/db.js';

export const authRepository = {
  findUserByEmail(email: string) {
    return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  },

  findUserById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  recordFailedLogin(id: string, failedLoginCount: number, lockedUntil: Date | null) {
    return prisma.user.update({ where: { id }, data: { failedLoginCount, lockedUntil } });
  },

  recordSuccessfulLogin(id: string) {
    return prisma.user.update({
      where: { id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
  },

  createRefreshToken(
    db: Db,
    data: { userId: string; tokenHash: string; familyId: string; expiresAt: Date; ipAddress?: string; userAgent?: string },
  ) {
    return db.refreshToken.create({ data });
  },

  findRefreshToken(tokenHash: string) {
    return prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
  },

  revokeFamily(db: Db, familyId: string) {
    return db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  },

  revokeAllForUser(db: Db, userId: string) {
    return db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  },

  /** Atomically marks a token as used; returns false if it was already revoked (race / reuse). */
  async markRotated(db: Db, id: string, replacedById: string): Promise<boolean> {
    const r = await db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), replacedById },
    });
    return r.count === 1;
  },

  updatePassword(db: Db, userId: string, passwordHash: string, mustChangePassword: boolean) {
    return db.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword, tokenVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null },
    });
  },
};
