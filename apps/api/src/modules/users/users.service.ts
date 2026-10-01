import type { Prisma } from '@prisma/client';
import {
  type Paginated,
  type UserCreateInput,
  type UserDto,
  type UserListQuery,
  type UserRef,
  type UserUpdateInput,
} from '@paragon/shared';
import { writeAudit } from '../../core/audit.js';
import { invalidateAuthz } from '../../core/authz.js';
import { hasPermission, type AuthenticatedUser } from '../../core/context.js';
import { prisma, withTransaction } from '../../core/db.js';
import { AuthorizationError, NotFoundError, ValidationError } from '../../core/errors.js';
import { pageArgs, sortOrder } from '../../core/http.js';
import { hashPassword } from '../../core/security.js';

const userInclude = {
  roles: { include: { role: true } },
  wings: { include: { wing: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.UserInclude;
type UserWithRoles = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export function toUserDto(u: UserWithRoles): UserDto {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
    roles: u.roles.map(({ role }) => ({ id: role.id, code: role.code, name: role.name })),
    wings: u.wings.map(({ wing }) => wing).sort((a, b) => a.code.localeCompare(b.code)),
    allWings: u.allWings,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

function snapshot(u: UserWithRoles) {
  return {
    email: u.email,
    fullName: u.fullName,
    status: u.status,
    roles: u.roles.map((r) => r.role.code).sort(),
    wings: u.allWings ? 'ALL' : u.wings.map((w) => w.wing.code).sort(),
  };
}

function buildWhere(q: Pick<UserListQuery, 'q' | 'status' | 'roleId' | 'permission' | 'wingId'>): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  if (q.q) {
    where.OR = [
      { fullName: { contains: q.q, mode: 'insensitive' } },
      { email: { contains: q.q, mode: 'insensitive' } },
    ];
  }
  if (q.status) where.status = q.status;
  const roleFilters: Prisma.UserRoleWhereInput[] = [];
  if (q.roleId) roleFilters.push({ roleId: q.roleId });
  if (q.permission) roleFilters.push({ role: { permissions: { some: { permission: { code: q.permission } } } } });
  const and: Prisma.UserWhereInput[] = roleFilters.map((f) => ({ roles: { some: f } }));
  if (q.wingId) and.push({ OR: [{ allWings: true }, { wings: { some: { wingId: q.wingId } } }] });
  if (and.length) where.AND = and;
  return where;
}

async function assertRolesExist(roleIds: string[]): Promise<void> {
  const count = await prisma.role.count({ where: { id: { in: roleIds } } });
  if (count !== new Set(roleIds).size) {
    throw new ValidationError('Validation failed', [{ path: 'roleIds', message: 'One or more roles do not exist' }]);
  }
}

async function assertWingsExist(wingIds: string[]): Promise<void> {
  const count = await prisma.wing.count({ where: { id: { in: wingIds } } });
  if (count !== new Set(wingIds).size) {
    throw new ValidationError('Validation failed', [{ path: 'wingIds', message: 'One or more wings do not exist' }]);
  }
}

export const usersService = {
  async list(q: UserListQuery): Promise<Paginated<UserDto>> {
    const where = buildWhere(q);
    const { field, dir } = sortOrder(q.sort, ['fullName', 'email', 'status', 'createdAt', 'lastLoginAt'] as const, {
      field: 'fullName',
      dir: 'asc',
    });
    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({ where, include: userInclude, orderBy: { [field]: dir }, ...pageArgs(q) }),
      prisma.user.count({ where }),
    ]);
    return { items: items.map(toUserDto), page: q.page, limit: q.limit, total };
  },

  /** Minimal active-user lookup for pickers (field force filter, reassignment). */
  async lookup(q: UserListQuery): Promise<Paginated<UserRef>> {
    const where = { ...buildWhere(q), status: 'ACTIVE' as const };
    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: { id: true, fullName: true, email: true },
        orderBy: { fullName: 'asc' },
        ...pageArgs(q),
      }),
      prisma.user.count({ where }),
    ]);
    return { items, page: q.page, limit: q.limit, total };
  },

  async get(id: string): Promise<UserDto> {
    const u = await prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!u) throw new NotFoundError('User');
    return toUserDto(u);
  },

  async create(input: UserCreateInput): Promise<UserDto> {
    await assertRolesExist(input.roleIds);
    await assertWingsExist(input.wingIds);
    const passwordHash = await hashPassword(input.password);
    return withTransaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: input.email.toLowerCase(),
          fullName: input.fullName,
          passwordHash,
          mustChangePassword: true,
          allWings: input.allWings,
          roles: { create: [...new Set(input.roleIds)].map((roleId) => ({ roleId })) },
          wings: { create: [...new Set(input.wingIds)].map((wingId) => ({ wingId })) },
        },
        include: userInclude,
      });
      await writeAudit({ action: 'CREATE_USER', entityType: 'User', entityId: u.id, newData: snapshot(u) }, tx);
      return toUserDto(u);
    });
  },

  async update(id: string, input: UserUpdateInput, actor: AuthenticatedUser): Promise<UserDto> {
    const before = await prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!before) throw new NotFoundError('User');

    if (input.status && input.status !== before.status) {
      if (!hasPermission(actor, 'USER_DISABLE')) throw new AuthorizationError('You cannot change user status');
      if (id === actor.id) throw new AuthorizationError('You cannot disable your own account');
    }
    const currentRoleIds = before.roles.map((r) => r.roleId).sort();
    const nextRoleIds = input.roleIds ? [...new Set(input.roleIds)].sort() : currentRoleIds;
    const rolesChanged = nextRoleIds.join() !== currentRoleIds.join();
    if (rolesChanged) {
      if (id === actor.id) throw new AuthorizationError('You cannot change your own roles');
      await assertRolesExist(nextRoleIds);
    }
    const statusChanged = input.status !== undefined && input.status !== before.status;
    const currentWingIds = before.wings.map((w) => w.wingId).sort();
    const nextWingIds = input.wingIds ? [...new Set(input.wingIds)].sort() : currentWingIds;
    const wingsChanged = nextWingIds.join() !== currentWingIds.join() || (input.allWings !== undefined && input.allWings !== before.allWings);
    if (input.wingIds) await assertWingsExist(nextWingIds);

    const after = await withTransaction(async (tx) => {
      if (rolesChanged) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: nextRoleIds.map((roleId) => ({ userId: id, roleId })) });
      }
      if (wingsChanged) {
        await tx.userWing.deleteMany({ where: { userId: id } });
        await tx.userWing.createMany({ data: nextWingIds.map((wingId) => ({ userId: id, wingId })) });
      }
      const u = await tx.user.update({
        where: { id },
        data: {
          fullName: input.fullName,
          status: input.status,
          allWings: input.allWings,
          ...(rolesChanged || statusChanged || wingsChanged ? { tokenVersion: { increment: 1 } } : {}),
        },
        include: userInclude,
      });
      if (statusChanged && input.status === 'DISABLED') {
        await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await writeAudit(
        { action: 'UPDATE_USER', entityType: 'User', entityId: id, previousData: snapshot(before), newData: snapshot(u) },
        tx,
      );
      if (rolesChanged) {
        await writeAudit(
          {
            action: 'CHANGE_ROLE',
            entityType: 'User',
            entityId: id,
            previousData: { roles: snapshot(before).roles },
            newData: { roles: snapshot(u).roles },
          },
          tx,
        );
      }
      return u;
    });
    invalidateAuthz(id);
    return toUserDto(after);
  },

  async resetPassword(id: string, newPassword: string): Promise<void> {
    const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundError('User');
    const passwordHash = await hashPassword(newPassword);
    await withTransaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true, tokenVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await writeAudit({ action: 'UPDATE_USER', entityType: 'User', entityId: id, newData: { passwordReset: true } }, tx);
    });
    invalidateAuthz(id);
  },
};
