import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import NotificationsIcon from '@mui/icons-material/Notifications';
import type { NotificationDto } from '@paragon/shared';
import { api } from '../../api/endpoints';
import { formatDateTime } from '../../utils/format';

export function useOpenNotification() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const read = useMutation({
    mutationFn: (id: string) => api.notifications.read(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (n: NotificationDto) => {
    if (!n.isRead) read.mutate(n.id);
    if (n.entityType === 'SalesTransaction' && n.entityId) navigate(`/transactions/${n.entityId}`);
  };
}

export function NotificationBell() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const open = useOpenNotification();
  const count = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: api.notifications.unreadCount,
    refetchInterval: 30_000,
  });
  const latest = useQuery({
    queryKey: ['notifications', 'latest'],
    queryFn: () => api.notifications.list({ limit: 6 }),
    enabled: !!anchor,
  });
  const unread = count.data?.count ?? 0;

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label={`Notifications, ${unread} unread`}>
          <Badge badgeContent={unread} color="error" max={99}>
            <NotificationsIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 360, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography fontWeight={600}>Notifications</Typography>
        </Box>
        <Divider />
        <List dense disablePadding>
          {latest.data?.items.length === 0 && (
            <Typography sx={{ p: 2 }} color="text.secondary" variant="body2">
              You are all caught up.
            </Typography>
          )}
          {latest.data?.items.map((n) => (
            <ListItemButton
              key={n.id}
              onClick={() => {
                setAnchor(null);
                open(n);
              }}
              sx={{ alignItems: 'flex-start', bgcolor: n.isRead ? undefined : 'action.hover' }}
            >
              <ListItemText
                primary={n.title}
                secondary={
                  <>
                    <span style={{ display: 'block' }}>{n.message}</span>
                    <span style={{ fontSize: 12 }}>{formatDateTime(n.createdAt)}</span>
                  </>
                }
                slotProps={{ primary: { fontWeight: n.isRead ? 400 : 600, fontSize: 14 } }}
              />
            </ListItemButton>
          ))}
        </List>
        <Divider />
        <Box sx={{ p: 1, textAlign: 'right' }}>
          <Button
            size="small"
            onClick={() => {
              setAnchor(null);
              navigate('/notifications');
            }}
          >
            View all
          </Button>
        </Box>
      </Popover>
    </>
  );
}
