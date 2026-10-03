import { describe, expect, it } from 'vitest';
import { ApprovalDecision, CorrectionCategory, DuplicateStatus, TransactionStatus } from '@prisma/client';
import { APPROVAL_DECISIONS, CORRECTION_CATEGORIES, TRANSACTION_STATUSES, DUPLICATE_STATUSES } from '@paragon/shared';
import { evaluateRules, type RuleDef } from '../../src/modules/rules/rule-engine.js';
import { compareMoney, toCents } from '../../src/modules/rules/money.js';
import { conditionsMatch, isCatchAll, matchRoutingRule, type RoutingRuleDef } from '../../src/modules/workflow/routing.js';
import { classifyDuplicate, type DuplicateFields } from '../../src/modules/duplicates/duplicate-detector.js';
import { dateInZone, startOfDayInZone } from '../../src/core/settings.js';

describe('shared enums mirror the Prisma schema', () => {
  it('statuses, categories, decisions, duplicates', () => {
    expect(Object.keys(TransactionStatus)).toEqual([...TRANSACTION_STATUSES]);
    expect(Object.keys(CorrectionCategory)).toEqual([...CORRECTION_CATEGORIES]);
    expect(Object.keys(ApprovalDecision)).toEqual([...APPROVAL_DECISIONS]);
    expect(Object.keys(DuplicateStatus)).toEqual([...DUPLICATE_STATUSES]);
  });
});

describe('money', () => {
  it('compares exactly', () => {
    expect(toCents('10.5')).toBe(1050n);
    expect(compareMoney('0.1', '0.10')).toBe(0);
    expect(compareMoney('999999999999999.99', '999999999999999.98')).toBe(1);
  });
});

const rule = (over: Partial<RuleDef>): RuleDef => ({
  id: 'r',
  name: 'rule',
  type: 'MAX_AMOUNT',
  params: { amount: '100.00' },
  trigger: 'SUBMIT',
  severity: 'ERROR',
  ...over,
});

describe('business rule engine', () => {
  it('max amount', () => {
    const r = evaluateRules([rule({})], { fields: { amount: '100.01' }, attachmentCount: 0 }, 'SUBMIT');
    expect(r.errors).toHaveLength(1);
    expect(evaluateRules([rule({})], { fields: { amount: '100.00' }, attachmentCount: 0 }, 'SUBMIT').errors).toHaveLength(0);
  });

  it('min amount as warning', () => {
    const r = evaluateRules(
      [rule({ type: 'MIN_AMOUNT', params: { amount: '50' }, severity: 'WARNING' })],
      { fields: { amount: '10' }, attachmentCount: 0 },
      'SUBMIT',
    );
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
  });

  it('respects trigger ordering (SUBMIT rules do not run on SAVE)', () => {
    expect(evaluateRules([rule({})], { fields: { amount: '999' }, attachmentCount: 0 }, 'SAVE').errors).toHaveLength(0);
    expect(evaluateRules([rule({})], { fields: { amount: '999' }, attachmentCount: 0 }, 'APPROVE').errors).toHaveLength(1);
  });

  it('required fields including attachments', () => {
    const req = rule({ type: 'REQUIRED_FIELD', params: { fields: ['partyId', 'attachments'] } });
    const r = evaluateRules([req], { fields: { partyId: null }, attachmentCount: 0 }, 'SUBMIT');
    expect(r.errors[0]?.message).toContain('CV Code / Farmer');
    expect(r.errors[0]?.message).toContain('Supporting Document');
    expect(evaluateRules([req], { fields: { partyId: 'p' }, attachmentCount: 1 }, 'SUBMIT').errors).toHaveLength(0);
  });

  it('party and account restrictions', () => {
    const deny = rule({ type: 'PARTY_RESTRICTION', params: { mode: 'DENY', partyIds: ['11111111-1111-4111-8111-111111111111'] } });
    expect(evaluateRules([deny], { fields: { partyId: '11111111-1111-4111-8111-111111111111' }, attachmentCount: 0 }, 'SUBMIT').errors).toHaveLength(1);
    const allow = rule({ type: 'ACCOUNT_RESTRICTION', params: { mode: 'ALLOW', accountIds: ['11111111-1111-4111-8111-111111111111'] } });
    expect(evaluateRules([allow], { fields: { accountId: '22222222-2222-4222-8222-222222222222' }, attachmentCount: 0 }, 'SUBMIT').errors).toHaveLength(1);
  });

  it('approval level applies to finance stage only', () => {
    const lvl = rule({ type: 'APPROVAL_LEVEL', trigger: 'APPROVE', params: { minAmount: '1000', requiredRoleCode: 'TREASURY' } });
    const ctx = { fields: { amount: '5000' }, attachmentCount: 1 };
    expect(evaluateRules([lvl], { ...ctx, stage: 'SALES_ADMIN' }, 'APPROVE').errors).toHaveLength(0);
    expect(evaluateRules([lvl], { ...ctx, stage: 'FINANCE', approverRoleCodes: ['ACCOUNTANT'] }, 'APPROVE').errors).toHaveLength(1);
    expect(evaluateRules([lvl], { ...ctx, stage: 'FINANCE', approverRoleCodes: ['TREASURY'] }, 'APPROVE').errors).toHaveLength(0);
  });

  it('misconfigured rules fail closed', () => {
    const bad = rule({ params: { nonsense: true } });
    expect(evaluateRules([bad], { fields: { amount: '1' }, attachmentCount: 0 }, 'SUBMIT').errors[0]?.message).toContain('misconfigured');
  });
});

describe('routing', () => {
  const base: Omit<RoutingRuleDef, 'id' | 'name' | 'priority' | 'conditions' | 'targetRoleId'> = {
    isActive: true,
    effectiveFrom: null,
    effectiveTo: null,
  };
  const rules: RoutingRuleDef[] = [
    { ...base, id: 'special', name: 'special', priority: 10, conditions: { isSpecial: true }, targetRoleId: 'ACC' },
    { ...base, id: 'high', name: 'high', priority: 20, conditions: { minAmount: '1000000' }, targetRoleId: 'TRS' },
    { ...base, id: 'corp', name: 'corp', priority: 30, conditions: { salesTypeIds: ['CORP'] }, targetRoleId: 'TRS' },
    { ...base, id: 'feed', name: 'feed', priority: 40, conditions: { wingIds: ['FEED'] }, targetRoleId: 'TRS' },
    { ...base, id: 'default', name: 'default', priority: 1000, conditions: {}, targetRoleId: 'ACC' },
  ];
  const input = { wingId: 'DOC', salesTypeId: 'CASH', partyId: null, amount: '100', isSpecial: false, onDate: '2026-09-26' };

  it('falls through to the catch-all', () => expect(matchRoutingRule(rules, input)?.id).toBe('default'));
  it('threshold → Treasury', () => expect(matchRoutingRule(rules, { ...input, amount: '1000000.00' })?.id).toBe('high'));
  it('sales type → Treasury', () => expect(matchRoutingRule(rules, { ...input, salesTypeId: 'CORP' })?.id).toBe('corp'));
  it('wing → Treasury', () => expect(matchRoutingRule(rules, { ...input, wingId: 'FEED' })?.id).toBe('feed'));
  it('priority wins: special high-value → Accountant', () =>
    expect(matchRoutingRule(rules, { ...input, isSpecial: true, amount: '5000000' })?.id).toBe('special'));
  it('ignores inactive / not yet effective rules', () => {
    const r = [{ ...rules[1]!, isActive: false }, { ...rules[3]!, effectiveFrom: '2027-01-01' }];
    expect(matchRoutingRule(r, { ...input, amount: '2000000' })).toBeNull();
  });
  it('detects catch-alls', () => {
    expect(isCatchAll({})).toBe(true);
    expect(isCatchAll({ salesTypeIds: [] })).toBe(true);
    expect(isCatchAll({ maxAmount: '5' })).toBe(false);
    expect(isCatchAll({ wingIds: ['FEED'] })).toBe(false);
    expect(conditionsMatch({ maxAmount: '5' }, { ...input, amount: '5.01' })).toBe(false);
  });
});

describe('duplicate classification', () => {
  const a: DuplicateFields = {
    id: 'a',
    transactionDate: '2026-09-20',
    partyId: 'p',
    amount: '100.00',
    bankId: 'b',
    accountId: 'acc',
    paymentReferenceNorm: 'CHQ1',
  };
  it('exact when all six fields match', () => {
    expect(classifyDuplicate(a, { ...a, id: 'b' }, 3).classification).toBe('EXACT_DUPLICATE');
  });
  it('possible when party+amount within window', () => {
    const r = classifyDuplicate(a, { ...a, id: 'b', transactionDate: '2026-09-23', paymentReferenceNorm: 'X' }, 3);
    expect(r.classification).toBe('POSSIBLE_DUPLICATE');
    expect(classifyDuplicate(a, { ...a, id: 'b', transactionDate: '2026-09-24', paymentReferenceNorm: 'X' }, 3).classification).toBe('NO_DUPLICATE');
  });
  it('possible when same reference at same bank', () => {
    expect(classifyDuplicate(a, { ...a, id: 'b', partyId: 'q', amount: '5.00' }, 3).classification).toBe('POSSIBLE_DUPLICATE');
  });
  it('none otherwise, and nulls never match', () => {
    expect(classifyDuplicate(a, { ...a, id: 'b', partyId: 'q', paymentReferenceNorm: null }, 3).classification).toBe('NO_DUPLICATE');
    const empty: DuplicateFields = { id: 'e', transactionDate: null, partyId: null, amount: null, bankId: null, accountId: null, paymentReferenceNorm: null };
    expect(classifyDuplicate(empty, { ...empty, id: 'f' }, 3).classification).toBe('NO_DUPLICATE');
  });
});

describe('time zone helpers', () => {
  it('computes the business-zone calendar date and day start', () => {
    const instant = new Date('2026-09-26T20:30:00Z');
    expect(dateInZone(instant, 'UTC')).toBe('2026-09-26');
    expect(dateInZone(instant, 'Asia/Dhaka')).toBe('2026-09-27');
    expect(startOfDayInZone('2026-09-27', 'Asia/Dhaka').toISOString()).toBe('2026-09-26T18:00:00.000Z');
  });
});
