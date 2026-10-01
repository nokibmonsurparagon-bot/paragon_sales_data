import type { ReactElement } from 'react';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DoNotDisturbOnIcon from '@mui/icons-material/DoNotDisturbOn';
import EditNoteIcon from '@mui/icons-material/EditNote';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import type { TransactionStatus } from '@paragon/shared';
import { TRANSACTION_STATUS_LABELS } from '@paragon/shared';

export type Tone = 'default' | 'info' | 'primary' | 'secondary' | 'success' | 'warning' | 'error';

/** Status presentation: colour is never the only signal – every badge has an icon and a text label. */
export const STATUS_META: Record<TransactionStatus, { label: string; color: Tone; icon: ReactElement; variant: 'filled' | 'outlined' }> = {
  DRAFT: { label: TRANSACTION_STATUS_LABELS.DRAFT, color: 'default', icon: <EditNoteIcon />, variant: 'outlined' },
  SALES_ADMIN_REVIEW: { label: TRANSACTION_STATUS_LABELS.SALES_ADMIN_REVIEW, color: 'info', icon: <HourglassTopIcon />, variant: 'outlined' },
  FINANCE_REVIEW: { label: TRANSACTION_STATUS_LABELS.FINANCE_REVIEW, color: 'secondary', icon: <AccountBalanceIcon />, variant: 'outlined' },
  CORRECTION_REQUIRED: { label: TRANSACTION_STATUS_LABELS.CORRECTION_REQUIRED, color: 'warning', icon: <ReportProblemIcon />, variant: 'filled' },
  REJECTED: { label: TRANSACTION_STATUS_LABELS.REJECTED, color: 'error', icon: <BlockIcon />, variant: 'filled' },
  READY_FOR_PROCESSING: { label: TRANSACTION_STATUS_LABELS.READY_FOR_PROCESSING, color: 'success', icon: <CheckCircleIcon />, variant: 'filled' },
  CANCELLED: { label: TRANSACTION_STATUS_LABELS.CANCELLED, color: 'default', icon: <DoNotDisturbOnIcon />, variant: 'filled' },
};
