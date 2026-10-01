import type { MasterStatus } from '@prisma/client';
import type {
  masterDataCreateSchemas,
  masterDataUpdateSchemas} from '@paragon/shared';
import {
  type MasterDataEntity,
  type MasterDataItem,
  type MasterDataListQuery,
  type Paginated,
} from '@paragon/shared';
import type { z } from 'zod';
import { writeAudit } from '../../core/audit.js';
import { prisma, withTransaction, type Db } from '../../core/db.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { pageArgs, sortOrder } from '../../core/http.js';

interface Row {
  id: string;
  code: string;
  name: string;
  status: MasterStatus;
  createdAt: Date;
  updatedAt: Date;
  bankId?: string;
  bank?: { id: string; code: string; name: string };
  isSpecial?: boolean;
}

/** The master-data delegates share the same shape; this narrow interface lets one service serve all. */
interface Delegate {
  findMany(args: object): Promise<Row[]>;
  count(args: object): Promise<number>;
  findUnique(args: object): Promise<Row | null>;
  create(args: object): Promise<Row>;
  update(args: object): Promise<Row>;
}

const CONFIG: Record<MasterDataEntity, { label: string; delegate: (db: Db) => Delegate; include?: object }> = {
  wings: { label: 'Wing', delegate: (db) => db.wing as unknown as Delegate },
  lines: { label: 'Line', delegate: (db) => db.line as unknown as Delegate },
  branches: { label: 'Branch', delegate: (db) => db.branch as unknown as Delegate },
  'cv-codes': { label: 'CvCode', delegate: (db) => db.cvCode as unknown as Delegate },
  banks: { label: 'Bank', delegate: (db) => db.bank as unknown as Delegate },
  accounts: {
    label: 'Account',
    delegate: (db) => db.account as unknown as Delegate,
    include: { bank: { select: { id: true, code: true, name: true } } },
  },
  parties: { label: 'Party', delegate: (db) => db.party as unknown as Delegate },
  'sales-types': { label: 'SalesType', delegate: (db) => db.salesType as unknown as Delegate },
};

function toDto(r: Row): MasterDataItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...(r.bankId !== undefined ? { bankId: r.bankId } : {}),
    ...(r.bank ? { bank: r.bank } : {}),
    ...(r.isSpecial !== undefined ? { isSpecial: r.isSpecial } : {}),
  };
}

async function assertBank(bankId: string | undefined): Promise<void> {
  if (!bankId) return;
  const bank = await prisma.bank.findUnique({ where: { id: bankId }, select: { id: true } });
  if (!bank) throw new ValidationError('Validation failed', [{ path: 'bankId', message: 'Bank does not exist' }]);
}

export function masterDataService(entity: MasterDataEntity) {
  const cfg = CONFIG[entity];
  const include = cfg.include ? { include: cfg.include } : {};

  return {
    async list(q: MasterDataListQuery): Promise<Paginated<MasterDataItem>> {
      const where: Record<string, unknown> = {};
      if (q.q) {
        where.OR = [
          { code: { contains: q.q, mode: 'insensitive' } },
          { name: { contains: q.q, mode: 'insensitive' } },
        ];
      }
      if (q.status) where.status = q.status;
      if (q.bankId && entity === 'accounts') where.bankId = q.bankId;
      const { field, dir } = sortOrder(q.sort, ['code', 'name', 'status', 'createdAt', 'updatedAt'] as const, {
        field: 'name',
        dir: 'asc',
      });
      const d = cfg.delegate(prisma);
      const [items, total] = await Promise.all([
        d.findMany({ where, orderBy: { [field]: dir }, ...pageArgs(q), ...include }),
        d.count({ where }),
      ]);
      return { items: items.map(toDto), page: q.page, limit: q.limit, total };
    },

    async get(id: string): Promise<MasterDataItem> {
      const row = await cfg.delegate(prisma).findUnique({ where: { id }, ...include });
      if (!row) throw new NotFoundError(cfg.label);
      return toDto(row);
    },

    async create(input: z.infer<(typeof masterDataCreateSchemas)[MasterDataEntity]>): Promise<MasterDataItem> {
      await assertBank((input as { bankId?: string }).bankId);
      return withTransaction(async (tx) => {
        const row = await cfg.delegate(tx).create({ data: { ...input, code: input.code.toUpperCase() }, ...include });
        await writeAudit({ action: 'CHANGE_MASTER_DATA', entityType: cfg.label, entityId: row.id, newData: toDto(row) }, tx);
        return toDto(row);
      });
    },

    async update(id: string, input: z.infer<(typeof masterDataUpdateSchemas)[MasterDataEntity]>): Promise<MasterDataItem> {
      await assertBank((input as { bankId?: string }).bankId);
      return withTransaction(async (tx) => {
        const d = cfg.delegate(tx);
        const before = await d.findUnique({ where: { id }, ...include });
        if (!before) throw new NotFoundError(cfg.label);
        const data = { ...input, ...(input.code ? { code: input.code.toUpperCase() } : {}) };
        const row = await d.update({ where: { id }, data, ...include });
        await writeAudit(
          { action: 'CHANGE_MASTER_DATA', entityType: cfg.label, entityId: id, previousData: toDto(before), newData: toDto(row) },
          tx,
        );
        return toDto(row);
      });
    },
  };
}
