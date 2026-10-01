import { describe, expect, it } from 'vitest';
import { formatTransactionNumber, neutralizeSpreadsheetCell, normalizePaymentReference, toCsvRow } from './format.js';
import { bankCharge, fromCents, toCents } from './money.js';
import {
  approveSchema,
  bulkApproveSchema,
  bulkRejectSchema,
  transactionDraftSchema,
  transactionSubmitSchema,
  returnSchema,
} from '../schemas/transaction.js';
import { moneySchema } from '../schemas/common.js';
import { DEFAULT_ROLE_PERMISSIONS } from '../constants/permissions.js';

describe('formatTransactionNumber', () => {
  it('pads the sequence to six digits', () => {
    expect(formatTransactionNumber('SAL', 2026, 1)).toBe('SAL-2026-000001');
    expect(formatTransactionNumber('SAL', 2026, 1234567)).toBe('SAL-2026-1234567');
  });
});

describe('normalizePaymentReference', () => {
  it('ignores case, spaces and punctuation', () => {
    expect(normalizePaymentReference(' chq-00 12/a ')).toBe('CHQ0012A');
    expect(normalizePaymentReference('---')).toBeNull();
    expect(normalizePaymentReference(null)).toBeNull();
  });
});

describe('spreadsheet safety', () => {
  it('neutralises formula-like cells', () => {
    expect(neutralizeSpreadsheetCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(neutralizeSpreadsheetCell('@cmd')).toBe("'@cmd");
    expect(neutralizeSpreadsheetCell('normal')).toBe('normal');
  });
  it('quotes CSV cells', () => {
    expect(toCsvRow(['a,b', 'say "hi"', null, 5])).toBe('"a,b","say ""hi""",,5');
  });
});

describe('money validation', () => {
  it.each(['1', '0.01', '1500.5', '999999999999999.99'])('accepts %s', (v) => {
    expect(moneySchema.safeParse(v).success).toBe(true);
  });
  it.each(['0', '0.00', '-1', '1.234', 'abc', '1e5', ''])('rejects %s', (v) => {
    expect(moneySchema.safeParse(v).success).toBe(false);
  });
});

describe('default role permissions', () => {
  it('keeps administrators out of creation/approval (segregation of duties)', () => {
    for (const p of ['SALES_CREATE', 'SALES_ADMIN_APPROVE', 'FINANCE_APPROVE', 'FINANCE_REVIEW'] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).not.toContain(p);
    }
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).toEqual(expect.arrayContaining(['USER_UPDATE', 'SALES_VIEW_ALL', 'TRANSACTION_ASSIGN']));
  });
  it('field force cannot approve; auditor is read-only', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.FIELD_FORCE.some((p) => p.includes('APPROVE'))).toBe(false);
    const writes = DEFAULT_ROLE_PERMISSIONS.AUDITOR.filter((p) => /CREATE|UPDATE|EDIT|APPROVE|REJECT|RESOLVE|SUBMIT|MANAGE|ASSIGN|CANCEL|DISABLE/.test(p));
    expect(writes).toEqual([]);
  });
});

describe('transaction schemas', () => {
  it('draft accepts partial data', () => {
    expect(transactionDraftSchema.safeParse({ remarks: 'x' }).success).toBe(true);
  });
  it('draft rejects status and unknown fields', () => {
    const r = transactionDraftSchema.safeParse({ status: 'READY_FOR_PROCESSING' });
    expect(r.success).toBe(false);
  });
  it('draft rejects invalid dates', () => {
    expect(transactionDraftSchema.safeParse({ transactionDate: '2026-02-30' }).success).toBe(false);
  });
  it('submit requires all mandatory fields', () => {
    const r = transactionSubmitSchema.safeParse({ amount: '10' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toEqual(
        expect.arrayContaining([
          'transactionDate',
          'lineId',
          'branchId',
          'cvCodeId',
          'partyId',
          'bankId',
          'accountId',
          'bankDetails',
          'paymentReference',
          'salesTypeId',
        ]),
      );
    }
  });
  it('return requires reason and category', () => {
    expect(returnSchema.safeParse({ version: 1, reason: 'bad' }).success).toBe(false);
    expect(
      returnSchema.safeParse({ version: 1, reason: 'Account wrong', correctionCategory: 'ACCOUNT_ERROR' }).success,
    ).toBe(true);
  });
});

describe('bank charge (Amount (CR))', () => {
  it('is the deposit minus the credited amount, exactly', () => {
    expect(bankCharge('5000.00', '4975.50')).toBe('24.50');
    expect(bankCharge('0.30', '0.10')).toBe('0.20');
    expect(bankCharge('999999999999999.99', '0.01')).toBe('999999999999999.98');
  });
  it('is zero when the amounts are equal', () => {
    expect(bankCharge('700', '700.00')).toBe('0.00');
  });
  it('is not allowed when more was credited than deposited', () => {
    expect(bankCharge('100.00', '100.01')).toBeNull();
  });
  it('round-trips cents', () => {
    expect(fromCents(toCents('12.3'))).toBe('12.30');
    expect(fromCents(-5n)).toBe('-0.05');
  });
});

describe('approval schemas', () => {
  it('Amount (CR) must be a positive amount', () => {
    expect(approveSchema.safeParse({ version: 1, creditAmount: '10.00' }).success).toBe(true);
    expect(approveSchema.safeParse({ version: 1, creditAmount: '0' }).success).toBe(false);
  });
  it('bulk actions: 1–50 distinct items; reject needs a reason', () => {
    const id = '0b7e6c2e-6a8e-4a55-9a51-2f1f7d3c1a11';
    expect(bulkApproveSchema.safeParse({ items: [{ id, version: 1 }] }).success).toBe(true);
    expect(bulkApproveSchema.safeParse({ items: [{ id, version: 1 }, { id, version: 2 }] }).success).toBe(false);
    expect(bulkApproveSchema.safeParse({ items: [] }).success).toBe(false);
    expect(bulkRejectSchema.safeParse({ items: [{ id, version: 1 }] }).success).toBe(false);
    expect(bulkRejectSchema.safeParse({ items: [{ id, version: 1 }], reason: 'Wrong bank' }).success).toBe(true);
  });
});
