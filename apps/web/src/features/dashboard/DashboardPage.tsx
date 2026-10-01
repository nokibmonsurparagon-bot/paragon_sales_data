import { Link as RouterLink, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import { HISTORY_ACTION_LABELS, type DashboardWidget } from '@paragon/shared';
import { api } from '../../api/endpoints';
import { Can } from '../../components/Can';
import { EmptyState, ErrorState, Loading } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { useUrlState } from '../../hooks';
import { useAuth } from '../../store/auth';
import { formatDateTime, humanize } from '../../utils/format';
import { TransactionFilters, apiFilters } from '../transactions/TransactionFilters';

const TONE_COLOR: Record<NonNullable<DashboardWidget['tone']>, string> = {
  default: 'text.disabled',
  info: 'info.main',
  success: 'success.main',
  warning: 'warning.main',
  error: 'error.main',
};

function KpiCard({ w, onClick }: { w: DashboardWidget; onClick?: () => void }) {
  const body = (
    <CardContent sx={{ borderLeft: 4, borderColor: TONE_COLOR[w.tone ?? 'default'], height: '100%' }}>
      <Typography variant="body2" color="text.secondary" sx={{ minHeight: 40 }}>
        {w.label}
      </Typography>
      <Typography variant="h4" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {w.value.toLocaleString()}
      </Typography>
    </CardContent>
  );
  return <Card sx={{ height: '100%' }}>{onClick ? <CardActionArea onClick={onClick} sx={{ height: '100%' }}>{body}</CardActionArea> : body}</Card>;
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const { state, update, reset } = useUrlState();
  const filters = apiFilters(state);
  delete filters.q;
  const q = useQuery({ queryKey: ['dashboard', filters], queryFn: () => api.dashboard(filters) });
  const canList = can('SALES_VIEW_OWN', 'SALES_VIEW_ALL', 'SALES_ADMIN_REVIEW', 'FINANCE_REVIEW');

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.fullName.split(' ')[0] ?? ''}`}
        subtitle="Your workload at a glance"
        actions={
          <Can any={['SALES_CREATE']}>
            <Button variant="contained" startIcon={<AddIcon />} component={RouterLink} to="/transactions/new">
              New transaction
            </Button>
          </Can>
        }
      />
      <TransactionFilters state={state} update={update} reset={reset} showSearch={false} />
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.sections.length === 0 && <EmptyState title="No dashboard widgets for your role" />}
      {q.data?.sections.map((s) => (
        <Box key={s.key} component="section" sx={{ mb: 3 }} aria-labelledby={`sec-${s.key}`}>
          <Typography id={`sec-${s.key}`} variant="h6" sx={{ mb: 1.5 }}>
            {s.title}
          </Typography>
          <Grid container spacing={2}>
            {s.widgets.map((w) => (
              <Grid key={w.key} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
                <KpiCard
                  w={w}
                  onClick={
                    w.status && canList
                      ? () => navigate(`/transactions?status=${w.status}${s.key === 'field-force' ? '&view=mine' : ''}`)
                      : w.wingId && canList
                        ? () => navigate(`/transactions?wingId=${w.wingId}`)
                        : undefined
                  }
                />
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}
      {q.data?.recentActivity && (
        <Card>
          <CardHeader title="Recent activity" titleTypographyProps={{ variant: 'h6' }} />
          {q.data.recentActivity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <List dense>
              {q.data.recentActivity.map((a) => (
                <ListItem key={a.id} divider>
                  <ListItemText
                    primary={
                      <>
                        <Link component={RouterLink} to={`/transactions/${a.transactionId}`}>
                          {a.transactionNumber}
                        </Link>{' '}
                        — {HISTORY_ACTION_LABELS[a.action] ?? humanize(a.action)}
                      </>
                    }
                    secondary={`${a.actor.fullName}${a.actorRole ? ` (${humanize(a.actorRole)})` : ''} · ${formatDateTime(a.createdAt)}${a.comment ? ` · ${a.comment}` : ''}`}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Card>
      )}
    </>
  );
}
