import { ERROR_CODES, type TransactionEditableField } from '@paragon/shared';
import type { Db } from '../../core/db.js';
import { BusinessRuleError, ValidationError } from '../../core/errors.js';
import { businessToday, getSetting } from '../../core/settings.js';
import type { AuthenticatedUser } from '../../core/context.js';
import type { EditPolicy, GuardActor, GuardSubject } from '../workflow/state-machine.js';

type Refs = Partial<
  Record<'wingId' | 'lineId' | 'branchId' | 'cvCodeId' | 'partyId' | 'bankId' | 'accountId' | 'salesTypeId' | 'fieldForceUserId', string | null>
>;

/**
 * Master-data references must exist and be ACTIVE, and the account must belong to the bank.
 * Only `changed` references are checked for ACTIVE (an existing reference may have been deactivated
 * later), unless `requireActive` is set (submission).
 */
export async function assertReferences(db: Db, refs: Refs, changed: Set<string>, requireActive: boolean): Promise<void> {
  const problems: { path: string; message: string }[] = [];
  const check = async (
    key: keyof Refs,
    label: string,
    find: (id: string) => Promise<{ status: string } | null>,
  ) => {
    const id = refs[key];
    if (!id) return;
    const row = await find(id);
    if (!row) problems.push({ path: key, message: `${label} does not exist` });
    else if ((requireActive || changed.has(key)) && row.status !== 'ACTIVE') problems.push({ path: key, message: `${label} is inactive` });
  };
  await check('wingId', 'Wing', (id) => db.wing.findUnique({ where: { id }, select: { status: true } }));
  await check('lineId', 'Line', (id) => db.line.findUnique({ where: { id }, select: { status: true } }));
  await check('branchId', 'Branch', (id) => db.branch.findUnique({ where: { id }, select: { status: true } }));
  await check('cvCodeId', 'CV code', (id) => db.cvCode.findUnique({ where: { id }, select: { status: true } }));
  await check('partyId', 'Farmer / customer', (id) => db.party.findUnique({ where: { id }, select: { status: true } }));
  await check('bankId', 'Bank', (id) => db.bank.findUnique({ where: { id }, select: { status: true } }));
  await check('salesTypeId', 'Sales type', (id) => db.salesType.findUnique({ where: { id }, select: { status: true } }));
  await check('fieldForceUserId', 'Field Force user', (id) => db.user.findUnique({ where: { id }, select: { status: true } }));
  if (refs.accountId) {
    const account = await db.account.findUnique({ where: { id: refs.accountId }, select: { status: true, bankId: true } });
    if (!account) problems.push({ path: 'accountId', message: 'Account does not exist' });
    else {
      if ((requireActive || changed.has('accountId')) && account.status !== 'ACTIVE') {
        problems.push({ path: 'accountId', message: 'Account is inactive' });
      }
      if (refs.bankId && account.bankId !== refs.bankId) {
        problems.push({ path: 'accountId', message: 'Account does not belong to the selected bank' });
      }
    }
  }
  if (problems.length) throw new ValidationError('Validation failed', problems);
}

/** The Field Force user of a transaction must work on its wing. */
export async function assertWingMember(db: Db, wingId: string | null | undefined, userId: string): Promise<void> {
  if (!wingId) return;
  const member = await db.user.count({
    where: { id: userId, OR: [{ allWings: true }, { wings: { some: { wingId } } }] },
  });
  if (!member) {
    throw new BusinessRuleError('The Field Force user is not assigned to this wing', ERROR_CODES.WING_NOT_ASSIGNED, [
      { path: 'wingId', message: 'Not one of the Field Force user’s wings' },
    ]);
  }
}

/** Transaction date must not be in the future (unless allowed) nor older than the back-dating limit. */
export async function assertTransactionDate(day: string | null | undefined): Promise<void> {
  if (!day) return;
  const [today, allowFuture, maxBack] = await Promise.all([
    businessToday(),
    getSetting('transaction.allowFutureDate'),
    getSetting('transaction.maxBackdateDays'),
  ]);
  if (!allowFuture && day > today) {
    throw new BusinessRuleError('Transaction date cannot be in the future', undefined, [
      { path: 'transactionDate', message: 'Transaction date cannot be in the future' },
    ]);
  }
  const earliest = new Date(Date.parse(`${today}T00:00:00Z`) - maxBack * 86_400_000).toISOString().slice(0, 10);
  if (day < earliest) {
    throw new BusinessRuleError(`Transaction date cannot be more than ${maxBack} days in the past`, undefined, [
      { path: 'transactionDate', message: `Must be on or after ${earliest}` },
    ]);
  }
}

export async function editPolicy(): Promise<EditPolicy> {
  const [sa, fin] = await Promise.all([
    getSetting('workflow.salesAdminEditableFields'),
    getSetting('workflow.financeEditableFields'),
  ]);
  return { salesAdminEditableFields: sa as TransactionEditableField[], financeEditableFields: fin as TransactionEditableField[] };
}

export function guardActor(user: AuthenticatedUser): GuardActor {
  return {
    id: user.id,
    permissions: user.permissions,
    roleIds: user.roles.map((r) => r.id),
    wingIds: user.wings.map((w) => w.id),
    allWings: user.allWings,
  };
}

export function guardSubject(
  t: Omit<GuardSubject, 'salesAdminApproverId'>,
  salesAdminApproverId: string | null,
): GuardSubject {
  return {
    status: t.status,
    wingId: t.wingId,
    createdById: t.createdById,
    fieldForceUserId: t.fieldForceUserId,
    assignedRoleId: t.assignedRoleId,
    assignedUserId: t.assignedUserId,
    duplicateStatus: t.duplicateStatus,
    duplicateResolution: t.duplicateResolution,
    salesAdminApproverId,
  };
}
