import { Prisma, type TransactionStatus } from '@prisma/client';
import {
  CORRECTION_CATEGORY_LABELS,
  ERROR_CODES,
  bankCharge,
  transactionSubmitSchema,
  type BulkActionResult,
  type CorrectionCategory,
  type WorkflowAction,
  type WorkflowResult,
} from '@paragon/shared';
import { writeAudit } from '../../core/audit.js';
import { loadAuthz } from '../../core/authz.js';
import { roleFor, type AuthenticatedUser } from '../../core/context.js';
import { prisma, toJson, withTransaction } from '../../core/db.js';
import { AppError, AuthorizationError, BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { DOMAIN_EVENTS, publishDomainEvent } from '../../core/outbox.js';
import { duplicatesService } from '../duplicates/duplicates.service.js';
import { notificationsService } from '../notifications/notifications.service.js';
import { rulesService } from '../rules/rules.service.js';
import { businessFields, dateOnly, money } from '../transactions/transaction.mapper.js';
import { scopeWhere, transactionRepository as repo } from '../transactions/transaction.repository.js';
import { addHistory, monotonicNow, transactionsService } from '../transactions/transactions.service.js';
import {
  assertReferences,
  assertTransactionDate,
  assertWingMember,
  guardActor,
  guardSubject,
} from '../transactions/transaction.validation.js';
import { routingService } from './routing.service.js';
import { TRANSITIONS, checkTransition, isStageReviewer, resolveReviewAction, stageOf } from './state-machine.js';

export interface ActionInput {
  version: number;
  comment?: string;
  reason?: string;
  correctionCategory?: CorrectionCategory;
  /** Amount (CR) - final (finance) approval only. */
  creditAmount?: string;
  /** Set when the action comes from a bulk approve / reject (recorded in the audit log). */
  bulk?: boolean;
}

export type ReviewVerb = 'approve' | 'reject' | 'return';

const TERMINAL = new Set(['READY_FOR_PROCESSING', 'REJECTED', 'CANCELLED']);

async function loadForUpdate(tx: Prisma.TransactionClient, id: string, user: AuthenticatedUser, version: number) {
  await repo.lock(tx, id);
  await repo.assertInScope(tx, id, user);
  const t = await tx.salesTransaction.findUniqueOrThrow({
    where: { id },
    include: {
      workflow: true,
      salesType: true,
      wing: { select: { id: true, code: true, name: true } },
      fieldForce: { select: { id: true, fullName: true } },
    },
  });
  if (t.version !== version) throw new ConflictError();
  if (!t.workflow) throw new NotFoundError('Workflow instance');
  return t;
}

/** Frozen, integration-ready view of an approved transaction (§49). */
async function buildApprovedSnapshot(tx: Prisma.TransactionClient, id: string, approvedAt: Date, approver: AuthenticatedUser) {
  const t = await tx.salesTransaction.findUniqueOrThrow({
    where: { id },
    include: {
      wing: { select: { id: true, code: true, name: true } },
      fieldForce: { select: { id: true, fullName: true, email: true } },
      line: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
      cvCode: { select: { id: true, code: true, name: true } },
      party: { select: { id: true, code: true, name: true } },
      bank: { select: { id: true, code: true, name: true } },
      account: { select: { id: true, code: true, name: true } },
      salesType: { select: { id: true, code: true, name: true } },
      attachments: { where: { deletedAt: null } },
      approvalRecords: { orderBy: { createdAt: 'asc' }, include: { approver: { select: { id: true, fullName: true } } } },
    },
  });
  return {
    // v2 adds line, branch, CV code, bank details, Amount (CR) and bank charge.
    schemaVersion: 2,
    transactionId: t.id,
    transactionNumber: t.transactionNumber,
    finalApprovedAt: approvedAt.toISOString(),
    finalApprovedBy: { id: approver.id, fullName: approver.fullName },
    approvedData: {
      wing: t.wing,
      transactionDate: dateOnly(t.transactionDate),
      fieldForce: t.fieldForce,
      line: t.line,
      branch: t.branch,
      cvCode: t.cvCode,
      /** Farmer / customer. */
      party: t.party,
      /** Deposit amount. */
      amount: money(t.amount),
      creditAmount: money(t.creditAmount),
      bankCharge: money(t.bankCharge),
      bank: t.bank,
      account: t.account,
      bankDetails: t.bankDetails,
      paymentReference: t.paymentReference,
      salesType: t.salesType,
      /** Narration. */
      remarks: t.remarks,
      extraData: t.extraData,
    },
    approvalHistory: t.approvalRecords.map((a) => ({
      stage: a.stage,
      decision: a.decision,
      approver: a.approver,
      role: a.approverRole,
      reason: a.reason,
      cycle: a.cycle,
      at: a.createdAt.toISOString(),
    })),
    attachments: t.attachments.map((a) => ({
      id: a.id,
      originalName: a.originalName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      sha256: a.sha256,
      storageProvider: a.storageProvider,
      storageKey: a.storageKey,
    })),
  };
}

export const workflowService = {
  /**
   * Executes a workflow action atomically:
   * lock → scope → version → transition + guards → business rules → status update →
   * workflow action → approval record → history → notifications → audit → outbox.
   */
  async execute(id: string, action: WorkflowAction, input: ActionInput, user: AuthenticatedUser): Promise<WorkflowResult> {
    const def = TRANSITIONS[action];
    if (def.requiresReason && !input.reason) {
      throw new ValidationError('Validation failed', [{ path: 'reason', message: 'A reason is required' }]);
    }
    if (def.requiresCategory && !input.correctionCategory) {
      throw new ValidationError('Validation failed', [{ path: 'correctionCategory', message: 'A correction category is required' }]);
    }
    if (input.creditAmount && action !== 'FIN_APPROVE') {
      throw new ValidationError('Validation failed', [
        { path: 'creditAmount', message: 'Amount (CR) is entered by Accountant / Treasury at the final approval' },
      ]);
    }
    const warnings: string[] = [];

    await withTransaction(async (tx) => {
      const t = await loadForUpdate(tx, id, user, input.version);
      const instance = t.workflow!;
      const saApprover = await repo.salesAdminApprover(tx, id, instance.cycle);
      const guard = checkTransition(action, guardSubject(t, saApprover), guardActor(user));
      if (!guard.ok) {
        throw guard.status === 403
          ? new AuthorizationError(guard.message, guard.code)
          : new BusinessRuleError(guard.message, guard.code);
      }

      const now = new Date();
      const fields = businessFields(t);
      const attachmentCount = await repo.countAttachments(tx, id);
      const actorRole = roleFor(user, def.permission);
      const comment = input.reason ?? input.comment ?? null;
      const data: Prisma.SalesTransactionUncheckedUpdateInput = {
        status: def.to,
        version: { increment: 1 },
        updatedById: user.id,
        assignedUserId: null,
        ...(comment ? { latestComment: comment } : {}),
      };
      let cycle = instance.cycle;
      let routedRoleName: string | null = null;
      let duplicateNote: string | null = null;
      let creditNote: string | null = null;

      switch (action) {
        case 'SUBMIT':
        case 'RESUBMIT': {
          const complete = transactionSubmitSchema.safeParse(fields);
          if (!complete.success) {
            throw new ValidationError(
              'The transaction is incomplete',
              complete.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
            );
          }
          await assertReferences(tx, fields, new Set(), true);
          await assertWingMember(tx, t.wingId, t.fieldForceUserId);
          await assertTransactionDate(fields.transactionDate);
          warnings.push(...(await rulesService.enforce(tx, { fields, attachmentCount }, 'SUBMIT')));
          const dup = await duplicatesService.detectAndStore(tx, t);
          if (dup.status !== 'NO_DUPLICATE') {
            duplicateNote = `${dup.status} of ${dup.duplicateOfNumber}`;
            warnings.push(`Potential duplicate detected (${dup.status.replace('_', ' ').toLowerCase()} of ${dup.duplicateOfNumber})`);
          }
          const saRole = await tx.role.findUnique({ where: { code: 'SALES_ADMIN' }, select: { id: true } });
          data.assignedRoleId = saRole?.id ?? null;
          data.submittedAt = now;
          if (action === 'RESUBMIT') {
            cycle += 1;
            data.rejectionReason = null;
            data.correctionCategory = null;
          }
          break;
        }
        case 'SA_APPROVE': {
          warnings.push(...(await rulesService.enforce(tx, { fields, attachmentCount, stage: 'SALES_ADMIN' }, 'APPROVE')));
          const rule = await routingService.resolve(tx, {
            wingId: t.wingId,
            salesTypeId: t.salesTypeId!,
            partyId: t.partyId,
            amount: fields.amount!,
            isSpecial: t.salesType?.isSpecial ?? false,
          });
          data.assignedRoleId = rule.targetRoleId;
          data.workflowRuleId = rule.id;
          routedRoleName = (await tx.role.findUnique({ where: { id: rule.targetRoleId }, select: { name: true } }))?.name ?? null;
          break;
        }
        case 'FIN_APPROVE': {
          const credit = input.creditAmount ?? money(t.creditAmount);
          if (!credit) {
            throw new ValidationError('Amount (CR) is required for the final approval', [
              { path: 'creditAmount', message: 'Enter the amount credited by the bank' },
            ]);
          }
          const charge = bankCharge(fields.amount!, credit);
          if (charge === null) {
            throw new BusinessRuleError('Amount (CR) cannot be more than the deposit amount', ERROR_CODES.BUSINESS_RULE_VIOLATION, [
              { path: 'creditAmount', message: `Must not exceed the deposit amount ${fields.amount}` },
            ]);
          }
          data.creditAmount = new Prisma.Decimal(credit);
          data.bankCharge = new Prisma.Decimal(charge);
          creditNote = `Amount (CR) ${credit} · bank charge ${charge}`;
          warnings.push(
            ...(await rulesService.enforce(
              tx,
              { fields, attachmentCount, stage: 'FINANCE', approverRoleCodes: user.roles.map((r) => r.code) },
              'APPROVE',
            )),
          );
          data.assignedRoleId = null;
          data.finalApprovedAt = now;
          break;
        }
        case 'SA_RETURN':
        case 'FIN_RETURN':
        case 'SA_REJECT':
        case 'FIN_REJECT':
          data.assignedRoleId = null;
          data.rejectionReason = input.reason!;
          data.correctionCategory = input.correctionCategory ?? null;
          break;
        case 'CANCEL':
          data.assignedRoleId = null;
          break;
      }

      await tx.salesTransaction.update({ where: { id }, data });
      await tx.workflowInstance.update({
        where: { id: instance.id },
        data: { cycle, ...(TERMINAL.has(def.to) ? { completedAt: now } : {}) },
      });

      if (action === 'FIN_APPROVE') {
        const snapshot = await buildApprovedSnapshot(tx, id, now, user);
        // The final approval record is created here so it is part of the frozen snapshot.
        await tx.approvalRecord.create({
          data: { transactionId: id, stage: 'FINANCE', decision: 'APPROVED', approverId: user.id, approverRole: actorRole ?? 'UNKNOWN', reason: comment, cycle },
        });
        snapshot.approvalHistory.push({
          stage: 'FINANCE',
          decision: 'APPROVED',
          approver: { id: user.id, fullName: user.fullName },
          role: actorRole ?? 'UNKNOWN',
          reason: comment,
          cycle,
          at: now.toISOString(),
        });
        await tx.salesTransaction.update({ where: { id }, data: { approvedSnapshot: toJson(snapshot) } });
        await publishDomainEvent(tx, {
          type: DOMAIN_EVENTS.TRANSACTION_READY_FOR_PROCESSING,
          aggregateType: 'SalesTransaction',
          aggregateId: id,
          payload: snapshot,
        });
      } else if (def.decision && def.stage) {
        await tx.approvalRecord.create({
          data: {
            transactionId: id,
            stage: def.stage,
            decision: def.decision,
            approverId: user.id,
            approverRole: actorRole ?? 'UNKNOWN',
            reason: comment,
            correctionCategory: input.correctionCategory ?? null,
            cycle,
          },
        });
      }

      await tx.workflowAction.create({
        data: {
          instanceId: instance.id,
          transactionId: id,
          action,
          fromStatus: t.status,
          toStatus: def.to,
          actorUserId: user.id,
          actorRole,
          cycle,
          comment,
          createdAt: monotonicNow(),
        },
      });

      const categoryLabel = input.correctionCategory ? CORRECTION_CATEGORY_LABELS[input.correctionCategory] : null;
      await addHistory(tx, {
        transactionId: id,
        action: def.history,
        previousStatus: t.status,
        newStatus: def.to,
        actor: user,
        actorRole,
        comment:
          [categoryLabel, comment, creditNote].filter(Boolean).join(': ') || (routedRoleName ? `Routed to ${routedRoleName}` : null),
      });
      if (duplicateNote) {
        await addHistory(tx, {
          transactionId: id,
          action: 'DUPLICATE_DETECTED',
          previousStatus: def.to,
          newStatus: def.to,
          actor: user,
          actorRole,
          comment: duplicateNote,
        });
      }

      // ---- notifications ----
      const owners = [t.fieldForceUserId, t.createdById];
      const ref = { entityType: 'SalesTransaction', entityId: id };
      const num = t.transactionNumber;
      switch (action) {
        case 'SUBMIT':
        case 'RESUBMIT':
          await notificationsService.notify(
            tx,
            (await notificationsService.usersWithPermission(tx, 'SALES_ADMIN_REVIEW', { wingId: t.wingId })).filter((u) => !owners.includes(u)),
            { type: 'REVIEW_REQUIRED', title: 'New transaction requires your review', message: `${num} (${t.wing.name}) was ${action === 'SUBMIT' ? 'submitted' : 'resubmitted'} by ${t.fieldForce.fullName}.`, ...ref },
            user.id,
          );
          break;
        case 'SA_APPROVE':
          await notificationsService.notify(
            tx,
            (
              await notificationsService.usersWithPermission(tx, 'FINANCE_REVIEW', { roleId: data.assignedRoleId as string, wingId: t.wingId })
            ).filter((u) => !owners.includes(u)),
            { type: 'REVIEW_REQUIRED', title: 'New transaction requires your review', message: `${num} (${t.wing.name}) was approved by Sales Admin and routed to ${routedRoleName ?? 'finance'}.`, ...ref },
            user.id,
          );
          await notificationsService.notify(tx, owners, { type: 'TRANSACTION_APPROVED', title: 'Transaction has been approved', message: `${num} was approved by Sales Admin and sent to ${routedRoleName ?? 'finance'} for review.`, ...ref }, user.id);
          break;
        case 'FIN_APPROVE':
          await notificationsService.notify(tx, owners, { type: 'READY_FOR_PROCESSING', title: 'Transaction is ready for processing', message: `${num} received final approval.`, ...ref }, user.id);
          break;
        case 'SA_RETURN':
        case 'FIN_RETURN':
          await notificationsService.notify(tx, owners, { type: 'CORRECTION_REQUIRED', title: 'Transaction requires correction', message: `${num}: ${categoryLabel ?? ''} – ${input.reason}`, ...ref }, user.id);
          break;
        case 'SA_REJECT':
        case 'FIN_REJECT':
          await notificationsService.notify(tx, owners, { type: 'TRANSACTION_REJECTED', title: 'Transaction was rejected', message: `${num}: ${input.reason}`, ...ref }, user.id);
          break;
        default:
          break;
      }

      await writeAudit(
        {
          action: def.audit,
          entityType: 'SalesTransaction',
          entityId: id,
          previousData: { status: t.status, version: t.version, assignedRoleId: t.assignedRoleId },
          newData: {
            workflowAction: action,
            status: def.to,
            version: t.version + 1,
            assignedRoleId: data.assignedRoleId ?? null,
            reason: input.reason,
            correctionCategory: input.correctionCategory,
            comment: input.comment,
            ...(action === 'FIN_APPROVE' ? { creditAmount: String(data.creditAmount), bankCharge: String(data.bankCharge) } : {}),
            ...(input.bulk ? { bulk: true } : {}),
          },
        },
        tx,
      );
      await publishDomainEvent(tx, {
        type: DOMAIN_EVENTS.TRANSACTION_STATUS_CHANGED,
        aggregateType: 'SalesTransaction',
        aggregateId: id,
        payload: { transactionNumber: num, wing: t.wing.code, action, from: t.status, to: def.to, actorId: user.id, at: now.toISOString() },
      });
    });

    return { transaction: await transactionsService.detail(prisma, id, user, warnings), warnings };
  },

  /** approve / reject / return are stage-agnostic; the current status decides Sales Admin vs finance. */
  async review(id: string, verb: ReviewVerb, input: ActionInput, user: AuthenticatedUser): Promise<WorkflowResult> {
    await repo.assertInScope(prisma, id, user);
    const { status } = await prisma.salesTransaction.findUniqueOrThrow({ where: { id }, select: { status: true } });
    const action = resolveReviewAction(verb, status);
    if (!action) throw new BusinessRuleError(`Cannot ${verb} a transaction in status ${status}`, ERROR_CODES.INVALID_TRANSITION);
    return this.execute(id, action, input, user);
  },

  /**
   * Bulk approve / reject from the review queue. Every item runs through exactly the same checks as a
   * single action, in its own DB transaction, so one failure never blocks or rolls back the others.
   */
  async bulk(
    verb: 'approve' | 'reject',
    items: { id: string; version: number; creditAmount?: string }[],
    common: Omit<ActionInput, 'version' | 'creditAmount' | 'bulk'>,
    user: AuthenticatedUser,
  ): Promise<BulkActionResult> {
    const inScope = await prisma.salesTransaction.findMany({
      where: { AND: [{ id: { in: items.map((i) => i.id) } }, scopeWhere(user)] },
      select: { id: true, transactionNumber: true },
    });
    const numbers = new Map(inScope.map((t) => [t.id, t.transactionNumber]));
    const results: BulkActionResult['results'] = [];
    for (const item of items) {
      const transactionNumber = numbers.get(item.id) ?? null;
      try {
        const input: ActionInput = { ...common, version: item.version, bulk: true };
        if (item.creditAmount) input.creditAmount = item.creditAmount;
        const r = await this.review(item.id, verb, input, user);
        results.push({ id: item.id, transactionNumber, ok: true, status: r.transaction.status, warnings: r.warnings });
      } catch (e) {
        if (!(e instanceof AppError)) logger.error({ err: e, transactionId: item.id }, 'Bulk review item failed');
        const error =
          e instanceof AppError
            ? { code: e.code, message: e.code === ERROR_CODES.VALIDATION_ERROR && e.details[0] ? e.details[0].message : e.message }
            : { code: ERROR_CODES.INTERNAL_ERROR, message: 'Unexpected error - please try this transaction again' };
        results.push({ id: item.id, transactionNumber, ok: false, error, warnings: [] });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    return { succeeded, failed: results.length - succeeded, results };
  },

  // ---- Assignment (does not change status) ------------------------------------------------------

  async claim(id: string, version: number, user: AuthenticatedUser) {
    await withTransaction(async (tx) => {
      const t = await loadForUpdate(tx, id, user, version);
      const subject = guardSubject(t, null);
      if (!stageOf(t.status) || !isStageReviewer(subject, guardActor(user))) {
        throw new AuthorizationError('You are not a reviewer for this transaction');
      }
      if (t.assignedUserId && t.assignedUserId !== user.id) {
        throw new AuthorizationError('This transaction is already claimed by another reviewer', ERROR_CODES.CLAIMED_BY_OTHER);
      }
      if (t.assignedUserId === user.id) return;
      await this.assign(tx, t, user.id, user, 'CLAIMED', null);
    });
    return transactionsService.detail(prisma, id, user);
  },

  async release(id: string, version: number, user: AuthenticatedUser) {
    await withTransaction(async (tx) => {
      const t = await loadForUpdate(tx, id, user, version);
      if (!t.assignedUserId) return;
      if (t.assignedUserId !== user.id && !user.permissions.has('TRANSACTION_ASSIGN')) {
        throw new AuthorizationError('Only the claiming reviewer or an administrator can release this transaction');
      }
      await this.assign(tx, t, null, user, 'RELEASED', null);
    });
    return transactionsService.detail(prisma, id, user);
  },

  async reassign(id: string, version: number, targetUserId: string, user: AuthenticatedUser) {
    if (!user.permissions.has('TRANSACTION_ASSIGN')) throw new AuthorizationError();
    const target = await loadAuthz(targetUserId);
    if (!target || target.status !== 'ACTIVE') {
      throw new ValidationError('Validation failed', [{ path: 'userId', message: 'User does not exist or is inactive' }]);
    }
    await withTransaction(async (tx) => {
      const t = await loadForUpdate(tx, id, user, version);
      if (!stageOf(t.status)) throw new BusinessRuleError('Only transactions under review can be reassigned', ERROR_CODES.INVALID_TRANSITION);
      if (!isStageReviewer(guardSubject(t, null), guardActor(target.user))) {
        throw new ValidationError('Validation failed', [
          { path: 'userId', message: 'User is not an eligible reviewer for this stage and wing' },
        ]);
      }
      await this.assign(tx, t, targetUserId, user, 'REASSIGNED', `Assigned to ${target.user.fullName}`);
      await notificationsService.notify(
        tx,
        [targetUserId],
        { type: 'TRANSACTION_ASSIGNED', title: 'Transaction assigned to you', message: `${t.transactionNumber} was assigned to you by ${user.fullName}.`, entityType: 'SalesTransaction', entityId: id },
        user.id,
      );
    });
    return transactionsService.detail(prisma, id, user);
  },

  async assign(
    tx: Prisma.TransactionClient,
    t: { id: string; status: TransactionStatus; assignedUserId: string | null },
    assignedUserId: string | null,
    user: AuthenticatedUser,
    action: 'CLAIMED' | 'RELEASED' | 'REASSIGNED',
    comment: string | null,
  ) {
    await tx.salesTransaction.update({
      where: { id: t.id },
      data: { assignedUserId, version: { increment: 1 }, updatedById: user.id },
    });
    await addHistory(tx, {
      transactionId: t.id,
      action,
      previousStatus: t.status,
      newStatus: t.status,
      actor: user,
      actorRole: roleFor(user),
      comment,
    });
    await writeAudit(
      {
        action: 'ASSIGN_TRANSACTION',
        entityType: 'SalesTransaction',
        entityId: t.id,
        previousData: { assignedUserId: t.assignedUserId },
        newData: { assignedUserId, action },
      },
      tx,
    );
  },
};
