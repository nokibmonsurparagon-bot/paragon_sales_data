/**
 * Configurable business-rule engine. Rules live in the `business_rules` table; evaluation is pure.
 * A rule's trigger decides from which stage on it applies: SAVE ⊂ SUBMIT ⊂ APPROVE.
 */
import {
  ATTACHMENTS_FIELD,
  TRANSACTION_FIELD_LABELS,
  businessRuleParamsSchemas,
  type ApprovalStage,
  type BusinessRuleType,
  type RuleSeverity,
  type RuleTrigger,
  type TransactionEditableField,
} from '@paragon/shared';
import { compareMoney } from './money.js';

export interface RuleDef {
  id: string;
  name: string;
  type: BusinessRuleType;
  params: unknown;
  trigger: RuleTrigger;
  severity: RuleSeverity;
}

export interface RuleContext {
  fields: Partial<Record<TransactionEditableField, unknown>>;
  attachmentCount: number;
  /** Set when evaluating at APPROVE. */
  stage?: ApprovalStage;
  approverRoleCodes?: readonly string[];
}

export interface RuleViolation {
  ruleId: string;
  rule: string;
  message: string;
  path?: string;
}

export interface RuleResult {
  errors: RuleViolation[];
  warnings: RuleViolation[];
}

const ORDER: Record<RuleTrigger, number> = { SAVE: 0, SUBMIT: 1, APPROVE: 2 };

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Returns a message when the rule is violated, otherwise null. */
function evaluateOne(rule: RuleDef, ctx: RuleContext): { message: string; path?: string } | null {
  const amount = typeof ctx.fields.amount === 'string' ? ctx.fields.amount : null;

  switch (rule.type) {
    case 'MIN_AMOUNT': {
      const p = businessRuleParamsSchemas.MIN_AMOUNT.parse(rule.params);
      return amount && compareMoney(amount, p.amount) < 0 ? { message: `Amount must be at least ${p.amount}`, path: 'amount' } : null;
    }
    case 'MAX_AMOUNT': {
      const p = businessRuleParamsSchemas.MAX_AMOUNT.parse(rule.params);
      return amount && compareMoney(amount, p.amount) > 0 ? { message: `Amount must not exceed ${p.amount}`, path: 'amount' } : null;
    }
    case 'REQUIRED_FIELD': {
      const p = businessRuleParamsSchemas.REQUIRED_FIELD.parse(rule.params);
      const missing = p.fields.filter((f) =>
        f === ATTACHMENTS_FIELD ? ctx.attachmentCount === 0 : isBlank(ctx.fields[f as TransactionEditableField]),
      );
      if (!missing.length) return null;
      const labels = missing.map((f) => TRANSACTION_FIELD_LABELS[f]);
      return { message: `Required: ${labels.join(', ')}`, path: missing[0] };
    }
    case 'PARTY_RESTRICTION': {
      const p = businessRuleParamsSchemas.PARTY_RESTRICTION.parse(rule.params);
      const partyId = ctx.fields.partyId as string | null | undefined;
      if (!partyId) return null;
      const listed = p.partyIds.includes(partyId);
      return (p.mode === 'DENY' && listed) || (p.mode === 'ALLOW' && !listed)
        ? { message: 'This party is not permitted for sales transactions', path: 'partyId' }
        : null;
    }
    case 'ACCOUNT_RESTRICTION': {
      const p = businessRuleParamsSchemas.ACCOUNT_RESTRICTION.parse(rule.params);
      const accountId = ctx.fields.accountId as string | null | undefined;
      if (!accountId) return null;
      const listed = p.accountIds.includes(accountId);
      return (p.mode === 'DENY' && listed) || (p.mode === 'ALLOW' && !listed)
        ? { message: 'This account is not permitted for sales transactions', path: 'accountId' }
        : null;
    }
    case 'APPROVAL_LEVEL': {
      // Applies to the final (finance) approval only.
      if (ctx.stage !== 'FINANCE') return null;
      const p = businessRuleParamsSchemas.APPROVAL_LEVEL.parse(rule.params);
      if (!amount || compareMoney(amount, p.minAmount) < 0) return null;
      return ctx.approverRoleCodes?.includes(p.requiredRoleCode)
        ? null
        : { message: `Amounts of ${p.minAmount} or more require approval by role ${p.requiredRoleCode}` };
    }
  }
}

export function evaluateRules(rules: readonly RuleDef[], ctx: RuleContext, at: RuleTrigger): RuleResult {
  const result: RuleResult = { errors: [], warnings: [] };
  for (const rule of rules) {
    if (ORDER[rule.trigger] > ORDER[at]) continue;
    let violation: { message: string; path?: string } | null;
    try {
      violation = evaluateOne(rule, ctx);
    } catch {
      // A mis-configured rule must not silently pass or crash the request: surface it as an error.
      violation = { message: `Business rule "${rule.name}" is misconfigured` };
    }
    if (!violation) continue;
    const v: RuleViolation = { ruleId: rule.id, rule: rule.name, message: violation.message, path: violation.path };
    (rule.severity === 'ERROR' ? result.errors : result.warnings).push(v);
  }
  return result;
}
