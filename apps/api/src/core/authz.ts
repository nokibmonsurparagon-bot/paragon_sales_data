import type { Permission } from '@paragon/shared';
import type { AuthenticatedUser } from './context.js';
import { prisma } from './db.js';

interface CachedAuthz {
  at: number;
  status: string;
  tokenVersion: number;
  mustChangePassword: boolean;
  user: AuthenticatedUser;
}

/**
 * Short-lived cache of each user's effective roles/permissions.
 * Role/permission/user changes call `invalidateAuthz` for immediate effect on this instance;
 * the TTL bounds staleness across instances.
 */
const TTL_MS = 30_000;
const cache = new Map<string, CachedAuthz>();

export function invalidateAuthz(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

export async function loadAuthz(userId: string): Promise<CachedAuthz | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: {
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      },
      wings: { include: { wing: { select: { id: true, code: true, name: true } } } },
    },
  });
  if (!user) {
    cache.delete(userId);
    return null;
  }

  const roles = user.roles.map(({ role }) => ({
    id: role.id,
    code: role.code,
    name: role.name,
    permissions: role.permissions.map((rp) => rp.permission.code as Permission),
  }));
  const entry: CachedAuthz = {
    at: Date.now(),
    status: user.status,
    tokenVersion: user.tokenVersion,
    mustChangePassword: user.mustChangePassword,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles,
      permissions: new Set(roles.flatMap((r) => r.permissions)),
      wings: user.wings.map(({ wing }) => wing).sort((a, b) => a.code.localeCompare(b.code)),
      allWings: user.allWings,
    },
  };
  cache.set(userId, entry);
  return entry;
}
