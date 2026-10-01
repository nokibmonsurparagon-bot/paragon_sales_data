import type { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  type DuplicateCandidate,
  type DuplicateStatus,
  type ResolveDuplicateInput,
} from '@paragon/shared';
import { writeAudit } from '../../core/audit.js';
import { hasWing, roleFor, type AuthenticatedUser } from '../../core/context.js';
import { prisma, withTransaction, type Db } from '../../core/db.js';
import { AuthorizationError, BusinessRuleError, ConflictError } from '../../core/errors.js';
import { getSetting } from '../../core/settings.js';
import { dateOnly, money } from '../transactions/transaction.mapper.js';
import { transactionRepository } from '../transactions/transaction.repository.js';
import { isOwner, stageOf } from '../workflow/state-machine.js';
import { classifyDuplicate, strongest, type DuplicateFields } from './duplicate-detector.js';

const candidateSelect = {
  id: true,
  transactionNumber: true,
  status: true,
  transactionDate: true,
  partyId: true,
  amount: true,
  bankId: true,
  accountId: true,
  paymentReference: true,
  paymentReferenceNorm: true,
  party: { select: { id: true, code: true, name: true } },
} satisfies Prisma.SalesTransactionSelect;

type CandidateRow = Prisma.SalesTransactionGetPayload<{ select: typeof candidateSelect }>;

interface Subject {
  id: string;
  transactionDate: Date | null;
  partyId: string | null;
  amount: Prisma.Decimal | null;
  bankId: string | null;
  accountId: string | null;
  paymentReferenceNorm: string | null;
}

function fields(t: Subject | CandidateRow): DuplicateFields {
  return {
    id: t.id,
    transactionDate: dateOnly(t.transactionDate),
    partyId: t.partyId,
    amount: money(t.amount),
    bankId: t.bankId,
    accountId: t.accountId,
    paymentReferenceNorm: t.paymentReferenceNorm,
  };
}

async function findMatches(db: Db, t: Subject) {
  const windowDays = await getSetting('duplicate.possibleWindowDays');
  const or: Prisma.SalesTransactionWhereInput[] = [];
  if (t.partyId && t.amount && t.transactionDate) {
    const d = t.transactionDate.getTime();
    or.push({
      partyId: t.partyId,
      amount: t.amount,
      transactionDate: { gte: new Date(d - windowDays * 86_400_000), lte: new Date(d + windowDays * 86_400_000) },
    });
  }
  if (t.paymentReferenceNorm && t.bankId) or.push({ paymentReferenceNorm: t.paymentReferenceNorm, bankId: t.bankId });
  if (!or.length) return [];

  const rows = await db.salesTransaction.findMany({
    where: { id: { not: t.id }, status: { notIn: ['DRAFT', 'CANCELLED', 'REJECTED'] }, OR: or },
    select: candidateSelect,
    orderBy: { createdAt: 'asc' },
    take: 25,
  });
  const me = fields(t);
  return rows
    .map((row) => ({ row, match: classifyDuplicate(me, fields(row), windowDays) }))
    .filter((m) => m.match.classification !== 'NO_DUPLICATE');
}

export const duplicatesService = {
  /**
   * Re-classifies the transaction and stores the result. A previous resolution is kept when the
   * outcome (status + matched transaction) is unchanged; otherwise it is reset to PENDING.
   */
  async detectAndStore(
    tx: Prisma.TransactionClient,
    t: Subject & { duplicateStatus: DuplicateStatus; duplicateOfId: string | null },
  ): Promise<{ changed: boolean; status: DuplicateStatus; duplicateOfNumber: string | null }> {
    const best = strongest(await findMatches(tx, t));
    const status: DuplicateStatus = best?.match.classification ?? 'NO_DUPLICATE';
    const duplicateOfId = best?.row.id ?? null;
    const changed = status !== t.duplicateStatus || duplicateOfId !== t.duplicateOfId;
    if (changed) {
      await tx.salesTransaction.update({
        where: { id: t.id },
        data: {
          duplicateStatus: status,
          duplicateOfId,
          duplicateResolution: status === 'NO_DUPLICATE' ? null : 'PENDING',
          duplicateResolutionNote: null,
          duplicateResolvedById: null,
          duplicateResolvedAt: null,
        },
      });
    }
    return { changed, status, duplicateOfNumber: best?.row.transactionNumber ?? null };
  },

  /** Live list of matching transactions (summary data only). */
  async candidates(id: string, user: AuthenticatedUser): Promise<DuplicateCandidate[]> {
    await transactionRepository.assertInScope(prisma, id, user);
    const t = await prisma.salesTransaction.findUniqueOrThrow({ where: { id } });
    const matches = await findMatches(prisma, t);
    return matches.map(({ row, match }) => ({
      id: row.id,
      transactionNumber: row.transactionNumber,
      classification: match.classification as DuplicateCandidate['classification'],
      matchedOn: match.matchedOn,
      status: row.status,
      transactionDate: dateOnly(row.transactionDate),
      amount: money(row.amount),
      party: row.party,
      paymentReference: row.paymentReference,
    }));
  },

  async resolve(id: string, input: ResolveDuplicateInput, user: AuthenticatedUser): Promise<void> {
    await withTransaction(async (tx) => {
      await transactionRepository.lock(tx, id);
      await transactionRepository.assertInScope(tx, id, user);
      const t = await tx.salesTransaction.findUniqueOrThrow({ where: { id } });
      if (t.version !== input.version) throw new ConflictError();
      if (!user.permissions.has('EXCEPTION_RESOLVE')) throw new AuthorizationError();
      if (isOwner(t, user)) throw new AuthorizationError('You cannot resolve duplicates on your own transaction', ERROR_CODES.SELF_APPROVAL_FORBIDDEN);
      if (!hasWing(user, t.wingId)) throw new AuthorizationError('This transaction belongs to a wing you are not assigned to', ERROR_CODES.WING_NOT_ASSIGNED);
      if (!stageOf(t.status)) throw new BusinessRuleError('Duplicates can only be resolved while the transaction is under review', ERROR_CODES.INVALID_TRANSITION);
      if (t.duplicateStatus === 'NO_DUPLICATE' || t.duplicateResolution !== 'PENDING') {
        throw new BusinessRuleError('There is no pending duplicate warning on this transaction', ERROR_CODES.INVALID_TRANSITION);
      }

      await tx.salesTransaction.update({
        where: { id },
        data: {
          duplicateResolution: input.resolution,
          duplicateResolutionNote: input.note,
          duplicateResolvedById: user.id,
          duplicateResolvedAt: new Date(),
          version: { increment: 1 },
          updatedById: user.id,
        },
      });
      await tx.salesTransactionHistory.create({
        data: {
          transactionId: id,
          action: 'DUPLICATE_RESOLVED',
          previousStatus: t.status,
          newStatus: t.status,
          actorUserId: user.id,
          actorRole: roleFor(user, 'EXCEPTION_RESOLVE'),
          comment: `${input.resolution === 'NOT_DUPLICATE' ? 'Not a duplicate' : 'Confirmed duplicate'}: ${input.note}`,
        },
      });
      await writeAudit(
        {
          action: 'RESOLVE_DUPLICATE',
          entityType: 'SalesTransaction',
          entityId: id,
          previousData: { duplicateStatus: t.duplicateStatus, duplicateResolution: t.duplicateResolution },
          newData: { duplicateResolution: input.resolution, note: input.note },
        },
        tx,
      );
    });
  },
};
