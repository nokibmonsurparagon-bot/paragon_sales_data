/** `SAL-2026-000001` */
export function formatTransactionNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

/** Canonical form used for duplicate matching: upper-case, no whitespace/punctuation. */
export function normalizePaymentReference(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const norm = ref.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return norm.length ? norm : null;
}

/**
 * Prevents CSV / spreadsheet formula injection: cells starting with = + - @ tab or CR
 * are prefixed with a single quote so spreadsheet apps treat them as text.
 */
export function neutralizeSpreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsvRow(values: unknown[]): string {
  return values
    .map((v) => {
      const s = neutralizeSpreadsheetCell(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}
