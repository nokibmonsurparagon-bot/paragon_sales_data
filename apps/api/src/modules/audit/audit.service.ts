import type { Prisma } from '@prisma/client';
import type { AuditListQuery, AuditLogDto, Paginated } from '@paragon/shared';
import { prisma } from '../../core/db.js';
import { pageArgs } from '../../core/http.js';
import { toDbDate } from '../transactions/transaction.repository.js';

export function auditWhere(q: Partial<AuditListQuery>): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (q.userId) where.userId = q.userId;
  if (q.action) where.action = q.action;
  if (q.entityType) where.entityType = q.entityType;
  if (q.entityId) where.entityId = q.entityId;
  if (q.requestId) where.requestId = q.requestId;
  if (q.dateFrom || q.dateTo) {
    where.createdAt = {
      ...(q.dateFrom ? { gte: toDbDate(q.dateFrom) } : {}),
      // inclusive end date
      ...(q.dateTo ? { lt: new Date(toDbDate(q.dateTo).getTime() + 86_400_000) } : {}),
    };
  }
  return where;
}

export const auditInclude = { user: { select: { id: true, fullName: true, email: true } } } satisfies Prisma.AuditLogInclude;

export function toAuditDto(a: Prisma.AuditLogGetPayload<{ include: typeof auditInclude }>): AuditLogDto {
  return {
    id: a.id,
    user: a.user,
    role: a.role,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    previousData: a.previousData,
    newData: a.newData,
    ipAddress: a.ipAddress,
    userAgent: a.userAgent,
    requestId: a.requestId,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Read-only by design: there is no update/delete path for audit records (and the DB forbids it). */
export const auditService = {
  async list(q: AuditListQuery): Promise<Paginated<AuditLogDto>> {
    const where = auditWhere(q);
    const [items, total] = await prisma.$transaction([
      prisma.auditLog.findMany({ where, include: auditInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) }),
      prisma.auditLog.count({ where }),
    ]);
    return { items: items.map(toAuditDto), page: q.page, limit: q.limit, total };
  },
};
