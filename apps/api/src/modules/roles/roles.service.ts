import type { Prisma } from '@prisma/client';
import type { Permission, PermissionDto, RoleCreateInput, RoleDto, RoleUpdateInput } from '@paragon/shared';
import { writeAudit } from '../../core/audit.js';
import { invalidateAuthz } from '../../core/authz.js';
import { prisma, withTransaction, type Db } from '../../core/db.js';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../core/errors.js';

/** The ADMIN role's permissions are locked to prevent administrators locking themselves out. */
const LOCKED_ROLE = 'ADMIN';

const roleInclude = {
  permissions: { include: { permission: true } },
  _count: { select: { userRoles: true } },
} satisfies Prisma.RoleInclude;
type RoleWithPerms = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

function toRoleDto(r: RoleWithPerms): RoleDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissions: r.permissions.map((p) => p.permission.code as Permission).sort(),
    userCount: r._count.userRoles,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function permissionIds(db: Db, codes: string[]): Promise<string[]> {
  const unique = [...new Set(codes)];
  const rows = await db.permission.findMany({ where: { code: { in: unique } }, select: { id: true } });
  if (rows.length !== unique.length) {
    throw new ValidationError('Validation failed', [{ path: 'permissions', message: 'Unknown permission code' }]);
  }
  return rows.map((r) => r.id);
}

export const rolesService = {
  async list(): Promise<RoleDto[]> {
    const roles = await prisma.role.findMany({ include: roleInclude, orderBy: { name: 'asc' } });
    return roles.map(toRoleDto);
  },

  async get(id: string): Promise<RoleDto> {
    const r = await prisma.role.findUnique({ where: { id }, include: roleInclude });
    if (!r) throw new NotFoundError('Role');
    return toRoleDto(r);
  },

  async listPermissions(): Promise<PermissionDto[]> {
    const rows = await prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] });
    return rows.map((p) => ({ id: p.id, code: p.code as Permission, module: p.module, description: p.description }));
  },

  async create(input: RoleCreateInput): Promise<RoleDto> {
    return withTransaction(async (tx) => {
      const ids = await permissionIds(tx, input.permissions);
      const r = await tx.role.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          permissions: { create: ids.map((permissionId) => ({ permissionId })) },
        },
        include: roleInclude,
      });
      const dto = toRoleDto(r);
      await writeAudit({ action: 'CHANGE_ROLE', entityType: 'Role', entityId: r.id, newData: { code: dto.code, name: dto.name, permissions: dto.permissions } }, tx);
      return dto;
    });
  },

  async update(id: string, input: RoleUpdateInput): Promise<RoleDto> {
    const before = await prisma.role.findUnique({ where: { id }, include: roleInclude });
    if (!before) throw new NotFoundError('Role');
    const prev = toRoleDto(before);
    if (input.permissions && before.code === LOCKED_ROLE) {
      const same = [...new Set(input.permissions)].sort().join() === prev.permissions.join();
      if (!same) throw new BusinessRuleError('The ADMIN role permissions cannot be changed');
    }

    const dto = await withTransaction(async (tx) => {
      if (input.permissions) {
        const ids = await permissionIds(tx, input.permissions);
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId: id, permissionId })) });
      }
      const r = await tx.role.update({
        where: { id },
        data: { name: input.name, description: input.description },
        include: roleInclude,
      });
      const next = toRoleDto(r);
      await writeAudit(
        { action: 'CHANGE_ROLE', entityType: 'Role', entityId: id, previousData: { name: prev.name, description: prev.description }, newData: { name: next.name, description: next.description } },
        tx,
      );
      if (input.permissions && next.permissions.join() !== prev.permissions.join()) {
        await writeAudit(
          { action: 'CHANGE_PERMISSION', entityType: 'Role', entityId: id, previousData: { permissions: prev.permissions }, newData: { permissions: next.permissions } },
          tx,
        );
      }
      return next;
    });
    invalidateAuthz();
    return dto;
  },
};
