import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LockIcon from '@mui/icons-material/Lock';
import type { Permission } from '@paragon/shared';
import { Loading } from '../components/Feedback';
import { useAuth } from '../store/auth';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading label="Restoring your session…" />;
  if (status === 'anonymous') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

export function Forbidden() {
  return (
    <Box sx={{ textAlign: 'center', py: 8 }}>
      <LockIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
      <Typography variant="h5" sx={{ mt: 1 }}>
        Access denied
      </Typography>
      <Typography color="text.secondary">You do not have permission to view this page.</Typography>
    </Box>
  );
}

/** Route-level guard. The API enforces the same permissions server-side. */
export function RequirePermission({ any, children }: { any?: Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  if (any?.length && !can(...any)) return <Forbidden />;
  return <>{children}</>;
}
