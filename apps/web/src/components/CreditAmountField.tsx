import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import { bankCharge, creditAmountSchema } from '@paragon/shared';
import { formatMoney } from '../utils/format';

/**
 * Checks an Amount (CR) against the deposit amount. Returns an error message, or null when valid.
 * An empty value counts as an error: the final approval needs it.
 */
export function creditAmountError(deposit: string | null, value: string): string | null {
  if (!value.trim()) return 'Enter the amount credited by the bank';
  const parsed = creditAmountSchema.safeParse(value);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid amount';
  if (deposit && bankCharge(deposit, parsed.data) === null) return 'Cannot be more than the deposit amount';
  return null;
}

/** Bank charge for display, or null while the input is incomplete/invalid. */
export function chargeFor(deposit: string | null, value: string): string | null {
  return deposit && !creditAmountError(deposit, value) ? bankCharge(deposit, value.trim()) : null;
}

/** Amount (CR) input with the resulting bank charge (deposit − Amount (CR)) shown live. */
export function CreditAmountField({
  deposit,
  value,
  onChange,
  currency,
  showError,
  size,
  compact,
}: {
  deposit: string | null;
  value: string;
  onChange(v: string): void;
  currency: string;
  /** Show validation errors (after the user tried to confirm, or once they typed). */
  showError?: boolean;
  size?: 'small' | 'medium';
  /** Table-cell variant: no label or helper text (the bank charge has its own column); errors show on hover. */
  compact?: boolean;
}) {
  const error = creditAmountError(deposit, value);
  const charge = chargeFor(deposit, value);
  const shownError = (showError || (compact && value !== '')) && error;
  const help = compact ? undefined : shownError ? error : charge !== null ? `Bank charge: ${formatMoney(charge, currency)}` : 'Bank charge = deposit − Amount (CR)';
  return (
    <TextField
      label={compact ? undefined : 'Amount (CR)'}
      placeholder={compact ? 'Amount (CR)' : undefined}
      required={!compact}
      size={size}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
      error={!!shownError}
      helperText={help}
      title={compact && shownError ? error : undefined}
      // Typing inside a data-grid cell must not trigger row navigation or grid keyboard shortcuts.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      slotProps={{
        htmlInput: { inputMode: 'decimal', maxLength: 18, 'aria-label': 'Amount (CR)' },
        input: compact ? undefined : { startAdornment: <InputAdornment position="start">{currency}</InputAdornment> },
      }}
    />
  );
}
