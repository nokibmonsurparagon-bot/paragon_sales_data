import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission } from '@paragon/shared';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  roles: { id: string; code: string; name: string; permissions: Permission[] }[];
  permissions: ReadonlySet<Permission>;
  /** Wings the user is assigned to (ignored when `allWings`). */
  wings: { id: string; code: string; name: string }[];
  allWings: boolean;
}

export interface RequestContext {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  user?: AuthenticatedUser;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function hasPermission(user: AuthenticatedUser, ...perms: Permission[]): boolean {
  return perms.some((p) => user.permissions.has(p));
}

/** The first of the user's roles that carries the given permission – used to label history/audit entries. */
export function roleFor(user: AuthenticatedUser, perm?: Permission): string | null {
  if (perm) {
    const r = user.roles.find((role) => role.permissions.includes(perm));
    if (r) return r.code;
  }
  return user.roles[0]?.code ?? null;
}

/** Whether the user works on the given wing (review scope, creating transactions). */
export function hasWing(user: Pick<AuthenticatedUser, 'allWings' | 'wings'>, wingId: string): boolean {
  return user.allWings || user.wings.some((w) => w.id === wingId);
}

export function roleCodes(user: AuthenticatedUser): string {
  return user.roles.map((r) => r.code).join(',');
}
