/** Exact money arithmetic on decimal strings via integer cents (no floating point). */
export function toCents(value: string): bigint {
  const [whole = '0', frac = ''] = value.trim().split('.');
  return BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
}

export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const x = toCents(a);
  const y = toCents(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Bank charge = deposit amount − Amount (CR) credited by the bank; 0 when they are equal.
 * Returns null when the credited amount exceeds the deposit (not allowed).
 */
export function bankCharge(depositAmount: string, creditAmount: string): string | null {
  const charge = toCents(depositAmount) - toCents(creditAmount);
  return charge < 0n ? null : fromCents(charge);
}
