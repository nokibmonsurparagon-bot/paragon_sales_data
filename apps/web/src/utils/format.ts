import dayjs from 'dayjs';

export function formatMoney(amount: string | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export const formatDate = (d: string | null | undefined): string => (d ? dayjs(d).format('DD MMM YYYY') : '—');

export const formatDateTime = (d: string | null | undefined): string => (d ? dayjs(d).format('DD MMM YYYY, HH:mm') : '—');

export const formatBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

export const humanize = (code: string): string => code.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
