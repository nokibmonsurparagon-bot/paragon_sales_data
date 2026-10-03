import { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  TRANSACTION_SORT_FIELDS,
  normalizePaymentReference,
  transactionSubmitSchema,
  type HistoryAction,
  type HistoryEntry,
  type Paginated,
  type Permission,
  type TransactionCreateInput,
  type TransactionDetail,
  type TransactionEditableField,
  type TransactionListItem,
  type TransactionListQuery,
  type TransactionUpdateInput,
} from '@paragon/shared';
import { writeAudit } from '../../core/audit.js';
import { hasPermission, roleFor, type AuthenticatedUser } from '../../core/context.js';
import { prisma, withTransaction, type Db } from '../../core/db.js';
import { AuthorizationError, BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { pageArgs, sortOrder } from '../../core/http.js';
import { businessToday } from '../../core/settings.js';
import { duplicatesService } from '../duplicates/duplicates.service.js';
import { rulesService } from '../rules/rules.service.js';
import { WORKFLOW_DEFINITION_CODE, allowedActions, editableFields, stageOf } from '../workflow/state-machine.js';
import { businessFields, toDetail, toListItem } from './transaction.mapper.js';
import {
  filterWhere,
  queueWhere,
  scopeWhere,
  toDbDate,
  transactionListInclude,
  transactionRepository as repo,
} from './transaction.repository.js';
import {
  assertReferences,
  assertTransactionDate,
  assertWingMember,
  editPolicy,
  guardActor,
  guardSubject,
} from './transaction.validation.js';

type Fields = Record<TransactionEditableField, string | null>;

const DUPLICATE_KEYS: TransactionEditableField[] = ['transactionDate', 'partyId', 'amount', 'bankId', 'accountId', 'paymentReference'];
const EDITABLE_STATUSES = ['DRAFT', 'CORRECTION_REQUIRED', 'SALES_ADMIN_REVIEW', 'FINANCE_REVIEW'];

function normalizeValue(key: TransactionEditableField, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (key === 'amount') return new Prisma.Decimal(String(v)).toFixed(2);
  const s = String(v);
  return (key === 'remarks' || key === 'bankDetails') && s.trim() === '' ? null : s;
}

function toDbPatch(after: Fields, keys: TransactionEditableField[]): Prisma.SalesTransactionUncheckedUpdateInput {
  const data: Prisma.SalesTransactionUncheckedUpdateInput = {};
  for (const k of keys) {
    const v = after[k];
    switch (k) {
      case 'transactionDate':
        data.transactionDate = v ? toDbDate(v) : null;
        break;
      case 'amount':
        data.amount = v ? new Prisma.Decimal(v) : null;
        break;
      case 'paymentReference':
        data.paymentReference = v;
        data.paymentReferenceNorm = normalizePaymentReference(v);
        break;
      case 'fieldForceUserId':
        if (!v) throw new ValidationError('Validation failed', [{ path: 'fieldForceUserId', message: 'Field Force is required' }]);
        data.fieldForceUserId = v;
        break;
      case 'wingId':
        if (!v) throw new ValidationError('Validation failed', [{ path: 'wingId', message: 'Wing is required' }]);
        data.wingId = v;
        break;
      default:
        data[k] = v;
    }
  }
  return data;
}

/** Human-readable diff for the timeline (reference ids are shown as "CODE – Name"). */
async function describeChanges(db: Db, before: Fields, after: Fields, keys: TransactionEditableField[]) {
  const label = async (k: TransactionEditableField, id: string | null): Promise<string | null> => {
    if (!id) return null;
    const ref = (r: { code: string; name: string } | null) => (r ? `${r.code} – ${r.name}` : id);
    switch (k) {
      case 'wingId':
        return ref(await db.wing.findUnique({ where: { id }, select: { code: true, name: true } }));
      case 'lineId':
        return ref(await db.line.findUnique({ where: { id }, select: { code: true, name: true } }));
      case 'branchId':
        return ref(await db.branch.findUnique({ where: { id }, select: { code: true, name: true } }));
      case 'partyId':
        return ref(await db.party.findUnique({ where: { id }, select: { code: true, name: true } }));
      case 'bankId':
        return ref(await db.bank.findUnique({ where: { id }, select: { code: true, name: true } }));
      case 'accountId':
        return ref(await db.account.findUnique({ where: { id }, select: { code: true, name: true } }));
      case 'salesTypeId':
        return ref(await db.salesType.findUnique({ where: { id }, select: { code: true, name: true } }));
      case 'fieldForceUserId':
        return (await db.user.findUnique({ where: { id }, select: { fullName: true } }))?.fullName ?? id;
      default:
        return id;
    }
  };
  const out: Record<string, { from: string | null; to: string | null }> = {};
  for (const k of keys) out[k] = { from: await label(k, before[k]), to: await label(k, after[k]) };
  return out;
}

function editPermissionFor(status: string): Permission {
  if (status === 'SALES_ADMIN_REVIEW') return 'SALES_ADMIN_EDIT';
  if (status === 'FINANCE_REVIEW') return 'FINANCE_EDIT';
  return 'SALES_EDIT';
}

/** Strictly increasing timestamps so timeline entries written in one DB transaction keep their order. */
let lastTs = 0;
export function monotonicNow(): Date {
  lastTs = Math.max(Date.now(), lastTs + 1);
  return new Date(lastTs);
}

export async function addHistory(
  db: Db,
  entry: {
    transactionId: string;
    action: HistoryAction;
    previousStatus: Prisma.SalesTransactionHistoryCreateInput['previousStatus'];
    newStatus: Prisma.SalesTransactionHistoryCreateInput['newStatus'];
    actor: AuthenticatedUser;
    actorRole: string | null;
    comment?: string | null;
    changes?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await db.salesTransactionHistory.create({
    data: {
      transactionId: entry.transactionId,
      action: entry.action,
      previousStatus: entry.previousStatus,
      newStatus: entry.newStatus,
      actorUserId: entry.actor.id,
      actorRole: entry.actorRole,
      comment: entry.comment ?? null,
      changes: entry.changes,
      createdAt: monotonicNow(),
    },
  });
}

export const transactionsService = {
  async list(q: TransactionListQuery, user: AuthenticatedUser): Promise<Paginated<TransactionListItem>> {
    const viewWhere: Prisma.SalesTransactionWhereInput =
      q.view === 'mine'
        ? { OR: [{ createdById: user.id }, { fieldForceUserId: user.id }] }
        : q.view === 'queue'
          ? queueWhere(user)
          : {};
    const where: Prisma.SalesTransactionWhereInput = { AND: [scopeWhere(user), filterWhere(q), viewWhere] };
    const { field, dir } = sortOrder(q.sort, TRANSACTION_SORT_FIELDS, { field: 'createdAt', dir: 'desc' });
    const [rows, total] = await prisma.$transaction([
      prisma.salesTransaction.findMany({
        where,
        include: { ...transactionListInclude, workflow: { select: { cycle: true } } },
        // `nulls` is only valid on nullable columns (drafts may lack date/amount).
        orderBy: [
          field === 'transactionDate' || field === 'amount' ? { [field]: { sort: dir, nulls: 'last' } } : { [field]: dir },
          { id: 'asc' },
        ],
        ...pageArgs(q),
      }),
      prisma.salesTransaction.count({ where }),
    ]);
    const items = rows.map(toListItem);
    if (q.view === 'queue') {
      // Per-row approve / reject buttons: same guards as the detail page, computed in one batch.
      const approvers = await repo.salesAdminApprovers(
        prisma,
        rows.filter((r) => r.status === 'FINANCE_REVIEW').map((r) => ({ id: r.id, cycle: r.workflow?.cycle ?? 1 })),
      );
      const actor = guardActor(user);
      const policy = await editPolicy();
      rows.forEach((r, i) => {
        items[i]!.allowedActions = allowedActions(guardSubject(r, approvers.get(r.id) ?? null), actor, policy);
      });
    }
    return { items, page: q.page, limit: q.limit, total };
  },

  /** Detail + the actions/fields available to this user right now. */
  async detail(db: Db, id: string, user: AuthenticatedUser, warnings: string[] = []): Promise<TransactionDetail> {
    const row = await repo.findDetail(db, id);
    if (!row) throw new NotFoundError('Transaction');
    const saApprover = await repo.salesAdminApprover(db, id, row.workflow?.cycle ?? 1);
    const subject = guardSubject(row, saApprover);
    const actor = guardActor(user);
    const policy = await editPolicy();
    return toDetail(row, {
      allowedActions: allowedActions(subject, actor, policy),
      editableFields: editableFields(subject, actor, policy),
      warnings,
    });
  },

  async get(id: string, user: AuthenticatedUser): Promise<TransactionDetail> {
    await repo.assertInScope(prisma, id, user);
    return this.detail(prisma, id, user);
  },

  async create(input: TransactionCreateInput, user: AuthenticatedUser): Promise<TransactionDetail> {
    if (input.fieldForceUserId && input.fieldForceUserId !== user.id && !hasPermission(user, 'SALES_VIEW_ALL')) {
      throw new AuthorizationError('You cannot create transactions on behalf of another user', ERROR_CODES.FIELD_NOT_EDITABLE);
    }
    const fields = Object.fromEntries(
      (Object.keys(input) as TransactionEditableField[]).map((k) => [k, normalizeValue(k, input[k])]),
    ) as Partial<Fields>;
    const after: Fields = {
      wingId: null,
      transactionDate: null,
      lineId: null,
      branchId: null,
      partyId: null,
      amount: null,
      bankId: null,
      accountId: null,
      bankDetails: null,
      paymentReference: null,
      salesTypeId: null,
      remarks: null,
      ...fields,
      fieldForceUserId: fields.fieldForceUserId ?? user.id,
    };
    const provided = new Set(Object.keys(fields));
    await assertReferences(prisma, after, provided, false);
    await assertWingMember(prisma, after.wingId, after.fieldForceUserId!);
    await assertTransactionDate(after.transactionDate);
    const warnings = await rulesService.enforce(prisma, { fields: after, attachmentCount: 0 }, 'SAVE');
    const year = Number((await businessToday()).slice(0, 4));

    const id = await withTransaction(async (tx) => {
      const transactionNumber = await repo.nextNumber(tx, year);
      const keys = Object.keys(after) as TransactionEditableField[];
      const t = await tx.salesTransaction.create({
        data: {
          ...(toDbPatch(after, keys) as Prisma.SalesTransactionUncheckedCreateInput),
          transactionNumber,
          fieldForceUserId: after.fieldForceUserId!,
          createdById: user.id,
          updatedById: user.id,
          workflow: { create: { definitionCode: WORKFLOW_DEFINITION_CODE } },
        },
      });
      await addHistory(tx, {
        transactionId: t.id,
        action: 'CREATED',
        previousStatus: null,
        newStatus: 'DRAFT',
        actor: user,
        actorRole: roleFor(user, 'SALES_CREATE'),
      });
      await writeAudit(
        { action: 'CREATE_TRANSACTION', entityType: 'SalesTransaction', entityId: t.id, newData: { transactionNumber, ...after } },
        tx,
      );
      return t.id;
    });
    return this.detail(prisma, id, user, warnings);
  },

  async update(id: string, input: TransactionUpdateInput, user: AuthenticatedUser): Promise<TransactionDetail> {
    const { version, ...changes } = input;
    const provided = (Object.keys(changes) as TransactionEditableField[]).filter((k) => changes[k] !== undefined);
    const policy = await editPolicy();
    let warnings: string[] = [];

    await withTransaction(async (tx) => {
      await repo.lock(tx, id);
      await repo.assertInScope(tx, id, user);
      const t = await tx.salesTransaction.findUniqueOrThrow({ where: { id }, include: { workflow: true } });
      if (t.version !== version) throw new ConflictError();

      if (!EDITABLE_STATUSES.includes(t.status)) {
        throw new BusinessRuleError(`A ${t.status} transaction cannot be edited`, ERROR_CODES.TRANSACTION_NOT_EDITABLE);
      }
      const saApprover = await repo.salesAdminApprover(tx, id, t.workflow?.cycle ?? 1);
      const allowed = editableFields(guardSubject(t, saApprover), guardActor(user), policy);
      if (!allowed.length) throw new AuthorizationError('You cannot edit this transaction in its current status');
      const forbidden = provided.filter((k) => !allowed.includes(k));
      if (forbidden.length) {
        throw new AuthorizationError(
          `You cannot edit: ${forbidden.join(', ')}`,
          ERROR_CODES.FIELD_NOT_EDITABLE,
          forbidden.map((f) => ({ path: f, message: 'Not editable at this stage' })),
        );
      }

      const before = businessFields(t);
      const after: Fields = { ...before };
      for (const k of provided) after[k] = normalizeValue(k, changes[k]);
      const changed = provided.filter((k) => before[k] !== after[k]);
      if (!changed.length) return;

      // Once submitted, required fields can no longer be blanked. Only the changed fields are checked, so
      // transactions submitted before a field became required can still be edited during review.
      if (stageOf(t.status)) {
        const complete = transactionSubmitSchema.safeParse(after);
        const issues = complete.error?.issues.filter((i) => changed.includes(i.path[0] as TransactionEditableField)) ?? [];
        if (issues.length) {
          throw new ValidationError(
            'Validation failed',
            issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          );
        }
      }
      await assertReferences(tx, after, new Set(changed), false);
      if (changed.includes('wingId') || changed.includes('fieldForceUserId')) {
        await assertWingMember(tx, after.wingId, after.fieldForceUserId!);
      }
      if (changed.includes('transactionDate')) await assertTransactionDate(after.transactionDate);
      warnings = await rulesService.enforce(
        tx,
        { fields: after, attachmentCount: await repo.countAttachments(tx, id) },
        'SAVE',
      );

      const updated = await tx.salesTransaction.update({
        where: { id },
        data: { ...toDbPatch(after, changed), version: { increment: 1 }, updatedById: user.id },
      });

      const actorRole = roleFor(user, editPermissionFor(t.status));
      await addHistory(tx, {
        transactionId: id,
        action: 'UPDATED',
        previousStatus: t.status,
        newStatus: t.status,
        actor: user,
        actorRole,
        changes: await describeChanges(tx, before, after, changed),
      });

      if (stageOf(t.status) && changed.some((k) => DUPLICATE_KEYS.includes(k))) {
        const dup = await duplicatesService.detectAndStore(tx, updated);
        if (dup.changed) {
          await addHistory(tx, {
            transactionId: id,
            action: 'DUPLICATE_DETECTED',
            previousStatus: t.status,
            newStatus: t.status,
            actor: user,
            actorRole,
            comment: dup.status === 'NO_DUPLICATE' ? 'No duplicates found' : `${dup.status} of ${dup.duplicateOfNumber}`,
          });
        }
      }

      const pick = (f: Fields) => Object.fromEntries(changed.map((k) => [k, f[k]]));
      await writeAudit(
        { action: 'UPDATE_TRANSACTION', entityType: 'SalesTransaction', entityId: id, previousData: pick(before), newData: pick(after) },
        tx,
      );
    });
    return this.detail(prisma, id, user, warnings);
  },

  async history(id: string, user: AuthenticatedUser): Promise<HistoryEntry[]> {
    await repo.assertInScope(prisma, id, user);
    const rows = await prisma.salesTransactionHistory.findMany({
      where: { transactionId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { actor: { select: { id: true, fullName: true, email: true } } },
    });
    return rows.map((h) => ({
      id: h.id,
      action: h.action as HistoryAction,
      previousStatus: h.previousStatus,
      newStatus: h.newStatus,
      actor: h.actor,
      actorRole: h.actorRole,
      comment: h.comment,
      changes: (h.changes as HistoryEntry['changes']) ?? null,
      createdAt: h.createdAt.toISOString(),
    }));
  },
};
