import type { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  routingConditionsSchema,
  type RoutingConditions,
  type WorkflowRuleCreateInput,
  type WorkflowRuleDto,
  type WorkflowRuleUpdateInput,
  type WorkflowSimulateInput,
} from '@paragon/shared';
import { writeAudit } from '../../core/audit.js';
import type { AuthenticatedUser } from '../../core/context.js';
import { prisma, toJson, withTransaction, type Db } from '../../core/db.js';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../core/errors.js';
import { businessToday } from '../../core/settings.js';
import { toDbDate } from '../transactions/transaction.repository.js';
import { dateOnly } from '../transactions/transaction.mapper.js';
import { isCatchAll, matchRoutingRule, type RoutingInput, type RoutingRuleDef } from './routing.js';

const include = { targetRole: { select: { id: true, code: true, name: true } } } satisfies Prisma.WorkflowRuleInclude;
type RuleRow = Prisma.WorkflowRuleGetPayload<{ include: typeof include }>;

function conditionsOf(json: Prisma.JsonValue): RoutingConditions {
  const parsed = routingConditionsSchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : {};
}

function toDef(r: RuleRow): RoutingRuleDef {
  return {
    id: r.id,
    name: r.name,
    priority: r.priority,
    conditions: conditionsOf(r.conditions),
    targetRoleId: r.targetRoleId,
    isActive: r.isActive,
    effectiveFrom: dateOnly(r.effectiveFrom),
    effectiveTo: dateOnly(r.effectiveTo),
  };
}

function toDto(r: RuleRow): WorkflowRuleDto {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    priority: r.priority,
    conditions: conditionsOf(r.conditions),
    targetRole: r.targetRole,
    isActive: r.isActive,
    effectiveFrom: dateOnly(r.effectiveFrom),
    effectiveTo: dateOnly(r.effectiveTo),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** The target role must be able to review at the finance stage. */
async function assertFinanceRole(db: Db, roleId: string): Promise<void> {
  const role = await db.role.findFirst({
    where: { id: roleId, permissions: { some: { permission: { code: 'FINANCE_REVIEW' } } } },
    select: { id: true },
  });
  if (!role) {
    throw new ValidationError('Validation failed', [
      { path: 'targetRoleId', message: 'Target role must exist and hold the FINANCE_REVIEW permission' },
    ]);
  }
}

/** Invariant: at least one active, catch-all rule so every transaction can be routed. */
async function assertDefaultRuleExists(db: Db): Promise<void> {
  const active = await db.workflowRule.findMany({ where: { isActive: true, effectiveTo: null } });
  if (!active.some((r) => isCatchAll(conditionsOf(r.conditions)))) {
    throw new BusinessRuleError(
      'At least one active catch-all routing rule (no conditions, no end date) is required',
      ERROR_CODES.DEFAULT_RULE_REQUIRED,
    );
  }
}

function assertRange(from: string | null | undefined, to: string | null | undefined) {
  if (from && to && to < from) {
    throw new ValidationError('Validation failed', [{ path: 'effectiveTo', message: 'Must be on or after the start date' }]);
  }
}

export const routingService = {
  async resolve(db: Db, input: Omit<RoutingInput, 'onDate'>): Promise<RoutingRuleDef> {
    const rules = await db.workflowRule.findMany({ where: { isActive: true }, include });
    const match = matchRoutingRule(rules.map(toDef), { ...input, onDate: await businessToday() });
    if (!match) {
      throw new BusinessRuleError('No workflow routing rule matches this transaction', ERROR_CODES.NO_ROUTING_RULE);
    }
    return match;
  },

  async simulate(input: WorkflowSimulateInput) {
    const salesType = await prisma.salesType.findUnique({ where: { id: input.salesTypeId } });
    if (!salesType) throw new NotFoundError('Sales type');
    const rule = await this.resolve(prisma, {
      // Without a wing only wing-independent rules can match.
      wingId: input.wingId ?? '',
      salesTypeId: input.salesTypeId,
      partyId: input.partyId ?? null,
      amount: input.amount,
      isSpecial: salesType.isSpecial,
    });
    const row = await prisma.workflowRule.findUniqueOrThrow({ where: { id: rule.id }, include });
    return { rule: toDto(row) };
  },

  async list(): Promise<WorkflowRuleDto[]> {
    const rows = await prisma.workflowRule.findMany({ include, orderBy: [{ isActive: 'desc' }, { priority: 'asc' }] });
    return rows.map(toDto);
  },

  async create(input: WorkflowRuleCreateInput, actor: AuthenticatedUser): Promise<WorkflowRuleDto> {
    assertRange(input.effectiveFrom, input.effectiveTo);
    return withTransaction(async (tx) => {
      await assertFinanceRole(tx, input.targetRoleId);
      const r = await tx.workflowRule.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          priority: input.priority,
          conditions: toJson(input.conditions),
          targetRoleId: input.targetRoleId,
          isActive: input.isActive,
          effectiveFrom: input.effectiveFrom ? toDbDate(input.effectiveFrom) : null,
          effectiveTo: input.effectiveTo ? toDbDate(input.effectiveTo) : null,
          createdById: actor.id,
          updatedById: actor.id,
        },
        include,
      });
      await assertDefaultRuleExists(tx);
      await writeAudit({ action: 'CHANGE_WORKFLOW_RULE', entityType: 'WorkflowRule', entityId: r.id, newData: toDto(r) }, tx);
      return toDto(r);
    });
  },

  async update(id: string, input: WorkflowRuleUpdateInput, actor: AuthenticatedUser): Promise<WorkflowRuleDto> {
    return withTransaction(async (tx) => {
      const before = await tx.workflowRule.findUnique({ where: { id }, include });
      if (!before) throw new NotFoundError('Workflow rule');
      if (input.targetRoleId) await assertFinanceRole(tx, input.targetRoleId);
      const from = input.effectiveFrom !== undefined ? input.effectiveFrom : dateOnly(before.effectiveFrom);
      const to = input.effectiveTo !== undefined ? input.effectiveTo : dateOnly(before.effectiveTo);
      assertRange(from, to);
      const r = await tx.workflowRule.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          priority: input.priority,
          conditions: input.conditions ? toJson(input.conditions) : undefined,
          targetRoleId: input.targetRoleId,
          isActive: input.isActive,
          effectiveFrom: input.effectiveFrom === undefined ? undefined : input.effectiveFrom ? toDbDate(input.effectiveFrom) : null,
          effectiveTo: input.effectiveTo === undefined ? undefined : input.effectiveTo ? toDbDate(input.effectiveTo) : null,
          updatedById: actor.id,
        },
        include,
      });
      await assertDefaultRuleExists(tx);
      await writeAudit(
        { action: 'CHANGE_WORKFLOW_RULE', entityType: 'WorkflowRule', entityId: id, previousData: toDto(before), newData: toDto(r) },
        tx,
      );
      return toDto(r);
    });
  },
};
