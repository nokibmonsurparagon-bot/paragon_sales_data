import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import FormControlLabel from '@mui/material/FormControlLabel';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Pagination from '@mui/material/Pagination';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Chip from '@mui/material/Chip';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { api } from '../../api/endpoints';
import { EmptyState, ErrorState, Loading } from '../../components/Feedback';
import { useNotifier } from '../../components/Notifier';
import { PageHeader } from '../../components/PageHeader';
import { useUrlState } from '../../hooks';
import { formatDateTime, humanize } from '../../utils/format';
import { useOpenNotification } from './NotificationBell';

const LIMIT = 20;

export default function NotificationsPage() {
  const { state, update } = useUrlState();
  const page = Number(state.page ?? 1);
  const unreadOnly = state.unreadOnly === 'true';
  const qc = useQueryClient();
  const { notify, notifyError } = useNotifier();
  const open = useOpenNotification();

  const q = useQuery({
    queryKey: ['notifications', 'list', page, unreadOnly],
    queryFn: () => api.notifications.list({ page, limit: LIMIT, unreadOnly: unreadOnly ? 'true' : undefined }),
  });
  const readAll = useMutation({
    mutationFn: api.notifications.readAll,
    onSuccess: (r) => {
      notify(`${r.data.updated} notification(s) marked as read`);
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: notifyError,
  });

  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <Button startIcon={<DoneAllIcon />} onClick={() => readAll.mutate()} disabled={readAll.isPending}>
            Mark all as read
          </Button>
        }
      />
      <FormControlLabel
        control={<Switch checked={unreadOnly} onChange={(e) => update({ unreadOnly: e.target.checked ? 'true' : undefined })} />}
        label="Unread only"
        sx={{ mb: 1 }}
      />
      <Card>
        {q.isLoading && <Loading />}
        {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
        {q.data?.items.length === 0 && <EmptyState title="No notifications" />}
        <List disablePadding>
          {q.data?.items.map((n) => (
            <ListItemButton key={n.id} divider onClick={() => open(n)} sx={{ bgcolor: n.isRead ? undefined : 'action.hover' }}>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <span style={{ fontWeight: n.isRead ? 400 : 600 }}>{n.title}</span>
                    <Chip size="small" label={humanize(n.type)} variant="outlined" />
                    {!n.isRead && <Chip size="small" label="Unread" color="primary" />}
                  </Stack>
                }
                secondary={`${n.message} · ${formatDateTime(n.createdAt)}`}
              />
            </ListItemButton>
          ))}
        </List>
      </Card>
      {q.data && q.data.total > LIMIT && (
        <Stack sx={{ alignItems: 'center', mt: 2 }}>
          <Pagination count={Math.ceil(q.data.total / LIMIT)} page={page} onChange={(_e, p) => update({ page: p }, false)} />
        </Stack>
      )}
    </>
  );
}
