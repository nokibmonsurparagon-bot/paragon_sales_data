/** Finance routing: which role (Accountant, Treasury, …) reviews a Sales-Admin-approved transaction. Pure. */
import type { RoutingConditions } from '@paragon/shared';
import { compareMoney } from '../rules/money.js';

export interface RoutingRuleDef {
  id: string;
  name: string;
  priority: number;
  conditions: RoutingConditions;
  targetRoleId: string;
  isActive: boolean;
  /** YYYY-MM-DD, inclusive */
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface RoutingInput {
  wingId: string;
  salesTypeId: string;
  partyId: string | null;
  amount: string;
  isSpecial: boolean;
  /** Business-zone date YYYY-MM-DD used for effective dating. */
  onDate: string;
}

export function isCatchAll(c: RoutingConditions): boolean {
  return (
    !c.wingIds?.length &&
    !c.salesTypeIds?.length &&
    !c.partyIds?.length &&
    c.minAmount === undefined &&
    c.maxAmount === undefined &&
    c.isSpecial === undefined
  );
}

export function conditionsMatch(c: RoutingConditions, input: RoutingInput): boolean {
  if (c.wingIds?.length && !c.wingIds.includes(input.wingId)) return false;
  if (c.salesTypeIds?.length && !c.salesTypeIds.includes(input.salesTypeId)) return false;
  if (c.partyIds?.length && (!input.partyId || !c.partyIds.includes(input.partyId))) return false;
  if (c.minAmount !== undefined && compareMoney(input.amount, c.minAmount) < 0) return false;
  if (c.maxAmount !== undefined && compareMoney(input.amount, c.maxAmount) > 0) return false;
  if (c.isSpecial !== undefined && c.isSpecial !== input.isSpecial) return false;
  return true;
}

function isEffective(rule: RoutingRuleDef, day: string): boolean {
  return (!rule.effectiveFrom || rule.effectiveFrom <= day) && (!rule.effectiveTo || rule.effectiveTo >= day);
}

/** Lowest priority number wins; ties broken by name for determinism. */
export function matchRoutingRule(rules: readonly RoutingRuleDef[], input: RoutingInput): RoutingRuleDef | null {
  return (
    [...rules]
      .filter((r) => r.isActive && isEffective(r, input.onDate))
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
      .find((r) => conditionsMatch(r.conditions, input)) ?? null
  );
}
