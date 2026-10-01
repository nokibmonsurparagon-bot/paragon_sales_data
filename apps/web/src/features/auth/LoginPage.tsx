import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { loginSchema, type LoginInput } from '@paragon/shared';
import { errorText } from '../../components/Notifier';
import { useAuth } from '../../store/auth';

export default function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const next = params.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  if (status === 'authenticated') return <Navigate to={target} replace />;

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await login(v.email, v.password);
      navigate(target, { replace: true });
    } catch (e) {
      setError(errorText(e));
    }
  });

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={0.5} sx={{ alignItems: 'center', mb: 3 }}>
            <Box component="img" src="/favicon.svg" alt="" sx={{ width: 44, height: 44 }} />
            <Typography variant="h5" component="h1">
              Paragon Sales Approvals
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Sign in to continue
            </Typography>
          </Stack>
          <form onSubmit={onSubmit} noValidate>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="Email"
                type="email"
                autoComplete="username"
                autoFocus
                required
                {...register('email')}
                error={!!formState.errors.email}
                helperText={formState.errors.email?.message}
              />
              <TextField
                label="Password"
                type="password"
                autoComplete="current-password"
                required
                {...register('password')}
                error={!!formState.errors.password}
                helperText={formState.errors.password?.message}
              />
              <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting || status === 'loading'}>
                {formState.isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
