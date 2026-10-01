import type { Prisma } from '@prisma/client';
import type { NotificationDto, NotificationListQuery, NotificationType, Paginated, Permission } from '@paragon/shared';
import { prisma, type Db } from '../../core/db.js';
import { NotFoundError } from '../../core/errors.js';
import { pageArgs } from '../../core/http.js';

export interface NotificationMessage {
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}

/**
 * Delivery channel abstraction. Only the in-app channel exists today; e-mail / Teams channels can be
 * added later (ideally fed from the domain_events outbox after commit) without changing callers.
 */
export interface NotificationChannel {
  readonly name: string;
  deliver(db: Db, userIds: string[], msg: NotificationMessage): Promise<void>;
}

const inAppChannel: NotificationChannel = {
  name: 'in-app',
  async deliver(db, userIds, msg) {
    if (!userIds.length) return;
    await db.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: msg.type,
        title: msg.title,
        message: msg.message,
        entityType: msg.entityType ?? null,
        entityId: msg.entityId ?? null,
      })),
    });
  },
};

const channels: NotificationChannel[] = [inAppChannel];

function toDto(n: Prisma.NotificationGetPayload<object>): NotificationDto {
  return {
    id: n.id,
    type: n.type as NotificationType,
    title: n.title,
    message: n.message,
    entityType: n.entityType,
    entityId: n.entityId,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
  };
}

export const notificationsService = {
  /** Send inside the caller's DB transaction so notifications commit with the business change. */
  async notify(db: Db, userIds: Iterable<string>, msg: NotificationMessage, excludeUserId?: string): Promise<void> {
    const recipients = [...new Set(userIds)].filter((id) => id !== excludeUserId);
    for (const ch of channels) await ch.deliver(db, recipients, msg);
  },

  /** Active users holding a permission, optionally restricted to one role and to users working on a wing. */
  async usersWithPermission(db: Db, permission: Permission, opts: { roleId?: string; wingId?: string } = {}): Promise<string[]> {
    const { roleId, wingId } = opts;
    const rows = await db.user.findMany({
      where: {
        status: 'ACTIVE',
        ...(wingId ? { OR: [{ allWings: true }, { wings: { some: { wingId } } }] } : {}),
        roles: {
          some: {
            ...(roleId ? { roleId } : {}),
            role: { permissions: { some: { permission: { code: permission } } } },
          },
        },
      },
      select: { id: true },
      take: 500,
    });
    return rows.map((r) => r.id);
  },

  async list(userId: string, q: NotificationListQuery): Promise<Paginated<NotificationDto>> {
    const where: Prisma.NotificationWhereInput = { userId, ...(q.unreadOnly === 'true' ? { isRead: false } : {}) };
    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      prisma.notification.count({ where }),
    ]);
    return { items: items.map(toDto), page: q.page, limit: q.limit, total };
  },

  unreadCount(userId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, isRead: false } });
  },

  async markRead(userId: string, id: string): Promise<NotificationDto> {
    const n = await prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw new NotFoundError('Notification');
    if (n.isRead) return toDto(n);
    return toDto(await prisma.notification.update({ where: { id }, data: { isRead: true, readAt: new Date() } }));
  },

  async markAllRead(userId: string): Promise<number> {
    const r = await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true, readAt: new Date() } });
    return r.count;
  },
};
