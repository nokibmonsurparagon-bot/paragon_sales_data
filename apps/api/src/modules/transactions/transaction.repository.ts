import { Prisma } from '@prisma/client';
import {
  TRANSACTION_STATUS_LABELS,
  MONEY_REGEX,
  formatTransactionNumber,
  type TransactionFilter,
  type TransactionStatus,
} from '@paragon/shared';
import { hasPermission, type AuthenticatedUser } from '../../core/context.js';
import type { Db } from '../../core/db.js';
import { NotFoundError } from '../../core/errors.js';

const refSelect = { select: { id: true, code: true, name: true } } as const;
const userSelect = { select: { id: true, fullName: true, email: true } } as const;

export const transactionListInclude = {
  wing: refSelect,
  line: refSelect,
  branch: refSelect,
  cvCode: refSelect,
  party: refSelect,
  bank: refSelect,
  account: refSelect,
  salesType: refSelect,
  fieldForce: userSelect,
  assignedRole: { select: { id: true, code: true, name: true } },
  assignedUser: userSelect,
  _count: { select: { attachments: { where: { deletedAt: null } } } },
} satisfies Prisma.SalesTransactionInclude;

export const transactionDetailInclude = {
  ...transactionListInclude,
  salesType: { select: { id: true, code: true, name: true, isSpecial: true } },
  createdBy: userSelect,
  updatedBy: userSelect,
  duplicateOf: { select: { id: true, transactionNumber: true } },
  attachments: {
    where: { deletedAt: null },
    orderBy: { uploadedAt: 'asc' },
    include: { uploadedBy: userSelect },
  },
  workflow: true,
} satisfies Prisma.SalesTransactionInclude;

export type TransactionListRow = Prisma.SalesTransactionGetPayload<{ include: typeof transactionListInclude }>;
export type TransactionDetailRow = Prisma.SalesTransactionGetPayload<{ include: typeof transactionDetailInclude }>;

/** Transactions of the wings the user works on. */
export function wingWhere(user: Pick<AuthenticatedUser, 'allWings' | 'wings'>): Prisma.SalesTransactionWhereInput {
  return user.allWings ? {} : { wingId: { in: user.wings.map((w) => w.id) } };
}

// ---- Data scope (§33) – the single source of truth for "which transactions can this user see" ----
export function scopeWhere(user: AuthenticatedUser): Prisma.SalesTransactionWhereInput {
  if (hasPermission(user, 'SALES_VIEW_ALL')) return {};
  const or: Prisma.SalesTransactionWhereInput[] = [];
  if (hasPermission(user, 'SALES_VIEW_OWN')) or.push({ createdById: user.id }, { fieldForceUserId: user.id });
  // Reviewers see what awaits their stage, but only in their own wings.
  if (hasPermission(user, 'SALES_ADMIN_REVIEW')) or.push({ status: 'SALES_ADMIN_REVIEW', ...wingWhere(user) });
  if (hasPermission(user, 'FINANCE_REVIEW')) {
    or.push({ status: 'FINANCE_REVIEW', assignedRoleId: { in: user.roles.map((r) => r.id) }, ...wingWhere(user) });
  }
  if (hasPermission(user, 'SALES_ADMIN_REVIEW', 'FINANCE_REVIEW')) {
    // Anything the reviewer has acted on stays visible to them.
    or.push({ history: { some: { actorUserId: user.id } } });
  }
  return or.length ? { OR: or } : { id: { in: [] } };
}

/** Transactions awaiting an action by this user (review queue). */
export function queueWhere(user: AuthenticatedUser): Prisma.SalesTransactionWhereInput {
  const or: Prisma.SalesTransactionWhereInput[] = [];
  const notOwner: Prisma.SalesTransactionWhereInput = { createdById: { not: user.id }, fieldForceUserId: { not: user.id } };
  const claimable: Prisma.SalesTransactionWhereInput = { OR: [{ assignedUserId: null }, { assignedUserId: user.id }] };
  const wing = wingWhere(user);
  if (hasPermission(user, 'SALES_ADMIN_REVIEW')) or.push({ status: 'SALES_ADMIN_REVIEW', ...wing, ...notOwner, AND: [claimable] });
  if (hasPermission(user, 'FINANCE_REVIEW')) {
    or.push({ status: 'FINANCE_REVIEW', assignedRoleId: { in: user.roles.map((r) => r.id) }, ...wing, ...notOwner, AND: [claimable] });
  }
  return or.length ? { OR: or } : { id: { in: [] } };
}

export function toDbDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Filters shared by list, dashboard and reports. */
export function filterWhere(f: Partial<TransactionFilter>): Prisma.SalesTransactionWhereInput {
  const and: Prisma.SalesTransactionWhereInput[] = [];
  if (f.status) and.push({ status: { in: f.status.split(',') as TransactionStatus[] } });
  if (f.dateFrom || f.dateTo) {
    and.push({
      transactionDate: {
        ...(f.dateFrom ? { gte: toDbDate(f.dateFrom) } : {}),
        ...(f.dateTo ? { lte: toDbDate(f.dateTo) } : {}),
      },
    });
  }
  if (f.wingId) and.push({ wingId: f.wingId });
  if (f.fieldForceUserId) and.push({ fieldForceUserId: f.fieldForceUserId });
  if (f.lineId) and.push({ lineId: f.lineId });
  if (f.branchId) and.push({ branchId: f.branchId });
  if (f.cvCodeId) and.push({ cvCodeId: f.cvCodeId });
  if (f.partyId) and.push({ partyId: f.partyId });
  if (f.bankId) and.push({ bankId: f.bankId });
  if (f.accountId) and.push({ accountId: f.accountId });
  if (f.salesTypeId) and.push({ salesTypeId: f.salesTypeId });
  if (f.duplicateStatus) and.push({ duplicateStatus: f.duplicateStatus });
  if (f.amountMin || f.amountMax) {
    and.push({
      amount: {
        ...(f.amountMin ? { gte: new Prisma.Decimal(f.amountMin) } : {}),
        ...(f.amountMax ? { lte: new Prisma.Decimal(f.amountMax) } : {}),
      },
    });
  }
  if (f.q) {
    const q = f.q.trim();
    const or: Prisma.SalesTransactionWhereInput[] = [
      { transactionNumber: { contains: q, mode: 'insensitive' } },
      { paymentReference: { contains: q, mode: 'insensitive' } },
      { party: { name: { contains: q, mode: 'insensitive' } } },
      { party: { code: { contains: q, mode: 'insensitive' } } },
      { wing: { name: { contains: q, mode: 'insensitive' } } },
      { line: { name: { contains: q, mode: 'insensitive' } } },
      { branch: { code: { contains: q, mode: 'insensitive' } } },
      { cvCode: { code: { contains: q, mode: 'insensitive' } } },
      { bankDetails: { contains: q, mode: 'insensitive' } },
      { remarks: { contains: q, mode: 'insensitive' } },
      { fieldForce: { fullName: { contains: q, mode: 'insensitive' } } },
    ];
    const amount = q.replace(/,/g, '');
    if (MONEY_REGEX.test(amount)) or.push({ amount: new Prisma.Decimal(amount) });
    const statuses = (Object.entries(TRANSACTION_STATUS_LABELS) as [TransactionStatus, string][])
      .filter(([code, label]) => label.toLowerCase().includes(q.toLowerCase()) || code === q.toUpperCase())
      .map(([code]) => code);
    if (statuses.length) or.push({ status: { in: statuses } });
    and.push({ OR: or });
  }
  return and.length ? { AND: and } : {};
}

export const transactionRepository = {
  /** Row-level lock for the remainder of the DB transaction (serialises concurrent workflow actions). */
  async lock(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales_transactions WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new NotFoundError('Transaction');
  },

  async assertInScope(db: Db, id: string, user: AuthenticatedUser): Promise<void> {
    const count = await db.salesTransaction.count({ where: { AND: [{ id }, scopeWhere(user)] } });
    if (!count) throw new NotFoundError('Transaction'); // 404, not 403: do not reveal existence
  },

  findDetail(db: Db, id: string) {
    return db.salesTransaction.findUnique({ where: { id }, include: transactionDetailInclude });
  },

  /** Sales Admin approvers of the current cycle for many transactions at once (review queue). */
  async salesAdminApprovers(db: Db, items: { id: string; cycle: number }[]): Promise<Map<string, string>> {
    if (!items.length) return new Map();
    const recs = await db.approvalRecord.findMany({
      where: { stage: 'SALES_ADMIN', decision: 'APPROVED', OR: items.map((i) => ({ transactionId: i.id, cycle: i.cycle })) },
      orderBy: { createdAt: 'asc' },
      select: { transactionId: true, approverId: true },
    });
    // Ascending order: the latest approval of a cycle wins.
    return new Map(recs.map((r) => [r.transactionId, r.approverId]));
  },

  /** Approver of the Sales Admin stage in the given cycle (segregation-of-duties guard). */
  async salesAdminApprover(db: Db, transactionId: string, cycle: number): Promise<string | null> {
    const rec = await db.approvalRecord.findFirst({
      where: { transactionId, cycle, stage: 'SALES_ADMIN', decision: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      select: { approverId: true },
    });
    return rec?.approverId ?? null;
  },

  /** Race-free yearly counter → SAL-2026-000001. */
  async nextNumber(tx: Prisma.TransactionClient, year: number, prefix = 'SAL'): Promise<string> {
    const rows = await tx.$queryRaw<{ last_value: number }[]>`
      INSERT INTO sequence_counters (name, year, last_value) VALUES (${prefix}, ${year}, 1)
      ON CONFLICT (name, year) DO UPDATE SET last_value = sequence_counters.last_value + 1
      RETURNING last_value`;
    return formatTransactionNumber(prefix, year, Number(rows[0]!.last_value));
  },

  countAttachments(db: Db, transactionId: string) {
    return db.salesTransactionAttachment.count({ where: { transactionId, deletedAt: null } });
  },
};
