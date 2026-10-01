import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { changePasswordSchema, type ChangePasswordInput } from '@paragon/shared';
import { api } from '../../api/endpoints';
import { useNotifier, errorText } from '../../components/Notifier';
import { useAuth } from '../../store/auth';
import { useState } from 'react';

export function ChangePasswordDialog({ open, forced, onClose }: { open: boolean; forced: boolean; onClose(): void }) {
  const { applySession, logout } = useAuth();
  const { notify } = useNotifier();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      const { data } = await api.auth.changePassword(v.currentPassword, v.newPassword);
      applySession(data);
      notify('Password changed. Other sessions were signed out.');
      reset();
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  });

  return (
    <Dialog open={open} onClose={forced ? undefined : onClose} fullWidth maxWidth="xs">
      <form onSubmit={submit} noValidate>
        <DialogTitle>{forced ? 'Set a new password' : 'Change password'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {forced && <Alert severity="info">Your password was set by an administrator. Choose a new one to continue.</Alert>}
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Current password"
              type="password"
              autoComplete="current-password"
              required
              {...register('currentPassword')}
              error={!!formState.errors.currentPassword}
              helperText={formState.errors.currentPassword?.message}
            />
            <TextField
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              {...register('newPassword')}
              error={!!formState.errors.newPassword}
              helperText={formState.errors.newPassword?.message ?? 'At least 10 characters with upper, lower case and a digit'}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {forced ? <Button onClick={() => void logout()}>Sign out</Button> : <Button onClick={onClose}>Cancel</Button>}
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
            Save password
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
