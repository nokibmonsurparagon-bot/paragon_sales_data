import Chip from '@mui/material/Chip';
import type { DuplicateStatus, TransactionStatus } from '@paragon/shared';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { STATUS_META } from '../constants/status';

export function StatusBadge({ status, size = 'small' }: { status: TransactionStatus; size?: 'small' | 'medium' }) {
  const m = STATUS_META[status];
  return <Chip size={size} label={m.label} color={m.color} icon={m.icon} variant={m.variant} data-status={status} />;
}

export function DuplicateBadge({ status }: { status: DuplicateStatus }) {
  if (status === 'NO_DUPLICATE') return null;
  return (
    <Chip
      size="small"
      icon={<ContentCopyIcon />}
      color={status === 'EXACT_DUPLICATE' ? 'error' : 'warning'}
      variant="outlined"
      label={status === 'EXACT_DUPLICATE' ? 'Exact duplicate' : 'Possible duplicate'}
    />
  );
}
