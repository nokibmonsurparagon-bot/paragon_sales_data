import type { ReactNode } from 'react';
import { Link as RouterLink, useMatches } from 'react-router';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

interface Crumb {
  crumb?: string;
}

/** Page title + breadcrumbs (from route `handle.crumb`) + right-aligned actions. */
export function PageHeader({ title, subtitle, actions, lastCrumb }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; lastCrumb?: string }) {
  const matches = useMatches().filter((m) => (m.handle as Crumb | undefined)?.crumb);
  return (
    <Box sx={{ mb: 2.5 }}>
      <Breadcrumbs sx={{ mb: 0.5, fontSize: 13 }} aria-label="breadcrumb">
        {matches.map((m, i) => {
          const label = i === matches.length - 1 && lastCrumb ? lastCrumb : (m.handle as Crumb).crumb;
          return i === matches.length - 1 ? (
            <Typography key={m.id} color="text.primary" fontSize={13}>
              {label}
            </Typography>
          ) : (
            <Link key={m.id} component={RouterLink} to={m.pathname} underline="hover" color="inherit">
              {label}
            </Link>
          );
        })}
      </Breadcrumbs>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1" sx={{ overflowWrap: 'anywhere' }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography color="text.secondary" variant="body2" component="div" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {actions && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, '& > *': { m: '0 !important' } }}>
            {actions}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
