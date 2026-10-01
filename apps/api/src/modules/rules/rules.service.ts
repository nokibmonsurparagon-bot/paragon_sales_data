import type { BusinessRule } from '@prisma/client';
import {
  ERROR_CODES,
  businessRuleParamsSchemas,
  type BusinessRuleCreateInput,
  type BusinessRuleDto,
  type BusinessRuleUpdateInput,
  type RuleTrigger,
} from '@paragon/shared';
import { writeAudit } from '../../core/audit.js';
import { prisma, toJson, withTransaction, type Db } from '../../core/db.js';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../core/errors.js';
import { evaluateRules, type RuleContext, type RuleDef, type RuleResult } from './rule-engine.js';

function toDto(r: BusinessRule): BusinessRuleDto {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    type: r.type,
    params: r.params as Record<string, unknown>,
    trigger: r.trigger,
    severity: r.severity,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function validateParams(type: BusinessRule['type'], params: unknown): Record<string, unknown> {
  const parsed = businessRuleParamsSchemas[type].safeParse(params);
  if (!parsed.success) {
    throw new ValidationError(
      'Invalid rule parameters',
      parsed.error.issues.map((i) => ({ path: ['params', ...i.path].join('.'), message: i.message })),
    );
  }
  return parsed.data as Record<string, unknown>;
}

export const rulesService = {
  async evaluate(db: Db, ctx: RuleContext, at: RuleTrigger): Promise<RuleResult> {
    const rules = await db.businessRule.findMany({ where: { isActive: true } });
    return evaluateRules(rules as RuleDef[], ctx, at);
  },

  /** Evaluates and throws 422 with all violations if any ERROR-severity rule fails. Returns warnings. */
  async enforce(db: Db, ctx: RuleContext, at: RuleTrigger): Promise<string[]> {
    const result = await this.evaluate(db, ctx, at);
    if (result.errors.length) {
      throw new BusinessRuleError(
        result.errors.map((e) => e.message).join('; '),
        ERROR_CODES.BUSINESS_RULE_VIOLATION,
        result.errors.map((e) => ({ path: e.path, message: e.message, code: e.rule })),
      );
    }
    return result.warnings.map((w) => w.message);
  },

  async list(): Promise<BusinessRuleDto[]> {
    const rows = await prisma.businessRule.findMany({ orderBy: [{ trigger: 'asc' }, { name: 'asc' }] });
    return rows.map(toDto);
  },

  async create(input: BusinessRuleCreateInput): Promise<BusinessRuleDto> {
    const params = validateParams(input.type, input.params);
    return withTransaction(async (tx) => {
      const r = await tx.businessRule.create({
        data: { ...input, description: input.description ?? null, params: toJson(params) },
      });
      await writeAudit({ action: 'CHANGE_BUSINESS_RULE', entityType: 'BusinessRule', entityId: r.id, newData: toDto(r) }, tx);
      return toDto(r);
    });
  },

  async update(id: string, input: BusinessRuleUpdateInput): Promise<BusinessRuleDto> {
    return withTransaction(async (tx) => {
      const before = await tx.businessRule.findUnique({ where: { id } });
      if (!before) throw new NotFoundError('Business rule');
      const params = input.params !== undefined ? validateParams(before.type, input.params) : undefined;
      const r = await tx.businessRule.update({
        where: { id },
        data: { ...input, params: params ? toJson(params) : undefined },
      });
      await writeAudit(
        { action: 'CHANGE_BUSINESS_RULE', entityType: 'BusinessRule', entityId: id, previousData: toDto(before), newData: toDto(r) },
        tx,
      );
      return toDto(r);
    });
  },
};
