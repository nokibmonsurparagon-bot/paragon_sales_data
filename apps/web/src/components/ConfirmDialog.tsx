import { useEffect, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { CORRECTION_CATEGORIES, CORRECTION_CATEGORY_LABELS, type CorrectionCategory } from '@paragon/shared';

export interface ConfirmResult {
  text?: string;
  category?: CorrectionCategory;
}

interface Props {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  confirmColor?: 'primary' | 'success' | 'error' | 'warning';
  /** 'comment' = optional text, 'reason' = required text (≥5 chars) */
  input?: 'none' | 'comment' | 'reason';
  inputLabel?: string;
  category?: 'none' | 'optional' | 'required';
  /** Extra inputs owned by the caller (e.g. Amount (CR)); `touched` = the user tried to confirm. */
  extra?: (touched: boolean) => ReactNode;
  /** Blocks confirmation while set (validation error of the extra inputs). */
  extraError?: string | null;
  busy?: boolean;
  onClose(): void;
  onConfirm(result: ConfirmResult): void;
}

/** Confirmation modal used for every approval / rejection / submission (spec §8, §16). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  confirmColor = 'primary',
  input = 'none',
  inputLabel,
  category = 'none',
  extra,
  extraError,
  busy,
  onClose,
  onConfirm,
}: Props) {
  const [text, setText] = useState('');
  const [cat, setCat] = useState<CorrectionCategory | ''>('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setText('');
      setCat('');
      setTouched(false);
    }
  }, [open]);

  const reasonError = input === 'reason' && text.trim().length < 5 ? 'Please give a reason (at least 5 characters)' : '';
  const categoryError = category === 'required' && !cat ? 'Select a correction category' : '';
  const invalid = !!reasonError || !!categoryError || !!extraError;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {message && <DialogContentText component="div">{message}</DialogContentText>}
          {extra?.(touched)}
          {category !== 'none' && (
            <TextField
              select
              label="Correction category"
              required={category === 'required'}
              value={cat}
              onChange={(e) => setCat(e.target.value as CorrectionCategory)}
              error={touched && !!categoryError}
              helperText={touched ? categoryError : ' '}
            >
              {category === 'optional' && <MenuItem value="">None</MenuItem>}
              {CORRECTION_CATEGORIES.map((c) => (
                <MenuItem key={c} value={c}>
                  {CORRECTION_CATEGORY_LABELS[c]}
                </MenuItem>
              ))}
            </TextField>
          )}
          {input !== 'none' && (
            <TextField
              label={inputLabel ?? (input === 'reason' ? 'Reason' : 'Comment (optional)')}
              required={input === 'reason'}
              multiline
              minRows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              error={touched && !!reasonError}
              helperText={touched && reasonError ? reasonError : `${text.length}/1000`}
              slotProps={{ htmlInput: { maxLength: 1000 } }}
              autoFocus
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          Back
        </Button>
        <Button
          variant="contained"
          color={confirmColor}
          disabled={busy}
          onClick={() => {
            setTouched(true);
            if (invalid) return;
            onConfirm({ text: text.trim() || undefined, category: cat || undefined });
          }}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
