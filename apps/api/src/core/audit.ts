import type { AuditAction } from '@paragon/shared';
import { getContext, roleCodes } from './context.js';
import { prisma, toJson, type Db } from './db.js';

export interface AuditEntry {
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  previousData?: unknown;
  newData?: unknown;
  /** Defaults to the authenticated user from the request context. */
  userId?: string | null;
  role?: string | null;
}

/** Keys never persisted in audit payloads. */
const SENSITIVE = new Set(['passwordHash', 'password', 'newPassword', 'currentPassword', 'tokenHash', 'token']);

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SENSITIVE.has(k))
        .map(([k, v]) => [k, scrub(v)]),
    );
  }
  return value;
}

/**
 * Append an audit record. Pass the interactive transaction client so the audit row commits
 * (or rolls back) together with the change it describes.
 */
export async function writeAudit(entry: AuditEntry, db: Db = prisma): Promise<void> {
  const ctx = getContext();
  const user = ctx?.user;
  await db.auditLog.create({
    data: {
      userId: entry.userId !== undefined ? entry.userId : (user?.id ?? null),
      role: entry.role !== undefined ? entry.role : user ? roleCodes(user) : null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      previousData: entry.previousData === undefined ? undefined : toJson(scrub(entry.previousData)),
      newData: entry.newData === undefined ? undefined : toJson(scrub(entry.newData)),
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent?.slice(0, 500) ?? null,
      requestId: ctx?.requestId ?? null,
    },
  });
}
