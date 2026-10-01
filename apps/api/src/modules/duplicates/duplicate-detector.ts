/** Duplicate classification. Pure – the service supplies candidate rows. */
import type { DuplicateStatus } from '@paragon/shared';

export interface DuplicateFields {
  id: string;
  transactionDate: string | null; // YYYY-MM-DD
  partyId: string | null;
  amount: string | null; // decimal string, 2dp
  bankId: string | null;
  accountId: string | null;
  paymentReferenceNorm: string | null;
}

export interface DuplicateMatch {
  classification: DuplicateStatus;
  matchedOn: string[];
}

const KEYS = ['transactionDate', 'partyId', 'amount', 'bankId', 'accountId', 'paymentReferenceNorm'] as const;
const LABEL: Record<(typeof KEYS)[number], string> = {
  transactionDate: 'transactionDate',
  partyId: 'party',
  amount: 'amount',
  bankId: 'bank',
  accountId: 'account',
  paymentReferenceNorm: 'paymentReference',
};

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * EXACT_DUPLICATE    – date, party, amount, bank, account and payment reference all equal.
 * POSSIBLE_DUPLICATE – same party and amount within ±windowDays, or same payment reference at the same bank.
 */
export function classifyDuplicate(a: DuplicateFields, b: DuplicateFields, windowDays: number): DuplicateMatch {
  const matchedOn = KEYS.filter((k) => a[k] !== null && a[k] === b[k]).map((k) => LABEL[k]);

  if (matchedOn.length === KEYS.length) return { classification: 'EXACT_DUPLICATE', matchedOn };

  const partyAmountClose =
    a.partyId !== null &&
    a.partyId === b.partyId &&
    a.amount !== null &&
    a.amount === b.amount &&
    a.transactionDate !== null &&
    b.transactionDate !== null &&
    dayDiff(a.transactionDate, b.transactionDate) <= windowDays;

  const sameReference =
    a.paymentReferenceNorm !== null && a.paymentReferenceNorm === b.paymentReferenceNorm && a.bankId !== null && a.bankId === b.bankId;

  if (partyAmountClose || sameReference) return { classification: 'POSSIBLE_DUPLICATE', matchedOn };
  return { classification: 'NO_DUPLICATE', matchedOn: [] };
}

const RANK: Record<DuplicateStatus, number> = { NO_DUPLICATE: 0, POSSIBLE_DUPLICATE: 1, EXACT_DUPLICATE: 2 };

export function strongest<T extends { match: DuplicateMatch }>(items: T[]): T | null {
  return items.reduce<T | null>((best, it) => (!best || RANK[it.match.classification] > RANK[best.match.classification] ? it : best), null);
}
