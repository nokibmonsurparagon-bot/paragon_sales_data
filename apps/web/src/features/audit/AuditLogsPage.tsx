import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import type { GridColDef } from '@mui/x-data-grid';
import { AUDIT_ACTIONS, type AuditLogDto, type UserRef } from '@paragon/shared';
import { api } from '../../api/endpoints';
import { ErrorState } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { UserPicker } from '../../components/Pickers';
import { ServerGrid } from '../../components/ServerGrid';
import { useUrlState } from '../../hooks';
import { formatDateTime, humanize } from '../../utils/format';

const DEFAULTS = { page: '1', limit: '50' };

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2">{label}</Typography>
      <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: 12, overflow: 'auto', maxHeight: 320 }}>
        {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
      </Box>
    </Box>
  );
}

export default function AuditLogsPage() {
  const { state, update } = useUrlState(DEFAULTS);
  const [selected, setSelected] = useState<AuditLogDto | null>(null);
  const [user, setUser] = useState<UserRef | null>(null);
  const params = {
    page: state.page,
    limit: state.limit,
    userId: state.userId,
    action: state.action,
    entityType: state.entityType,
    entityId: state.entityId,
    requestId: state.requestId,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
  };
  const q = useQuery({ queryKey: ['audit', params], queryFn: () => api.audit(params), placeholderData: keepPreviousData });

  const columns: GridColDef<AuditLogDto>[] = [
    { field: 'createdAt', headerName: 'Time', width: 170, sortable: false, valueFormatter: (v: string) => formatDateTime(v) },
    { field: 'user', headerName: 'User', width: 170, sortable: false, valueGetter: (_v, r) => r.user?.fullName ?? 'System / anonymous' },
    { field: 'role', headerName: 'Role', width: 150, sortable: false, valueFormatter: (v: string | null) => v ?? '—' },
    { field: 'action', headerName: 'Action', width: 200, sortable: false, valueFormatter: (v: string) => humanize(v) },
    { field: 'entityType', headerName: 'Entity', width: 150, sortable: false },
    { field: 'entityId', headerName: 'Entity ID', flex: 1, minWidth: 200, sortable: false },
    { field: 'ipAddress', headerName: 'IP', width: 130, sortable: false },
  ];

  return (
    <>
      <PageHeader title="Audit logs" subtitle="Append-only record of security-relevant and business actions. Records cannot be edited or deleted." />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <UserPicker
              label="User"
              value={user}
              onChange={(u) => {
                setUser(u);
                update({ userId: u?.id });
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField select label="Action" value={state.action ?? ''} onChange={(e) => update({ action: e.target.value || undefined })}>
              <MenuItem value="">All actions</MenuItem>
              {AUDIT_ACTIONS.map((a) => (
                <MenuItem key={a} value={a}>
                  {humanize(a)}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <TextField label="From" type="date" value={state.dateFrom ?? ''} onChange={(e) => update({ dateFrom: e.target.value || undefined })} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <TextField label="To" type="date" value={state.dateTo ?? ''} onChange={(e) => update({ dateTo: e.target.value || undefined })} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Entity type" value={state.entityType ?? ''} onChange={(e) => update({ entityType: e.target.value || undefined })} placeholder="e.g. SalesTransaction" />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Entity ID" value={state.entityId ?? ''} onChange={(e) => update({ entityId: e.target.value.trim() || undefined })} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Request ID" value={state.requestId ?? ''} onChange={(e) => update({ requestId: e.target.value.trim() || undefined })} />
          </Grid>
        </Grid>
      </Paper>
      {q.error && <ErrorState error={q.error} />}
      <ServerGrid<AuditLogDto>
        rows={q.data?.items ?? []}
        columns={columns}
        total={q.data?.total ?? 0}
        loading={q.isFetching}
        page={Number(state.page)}
        limit={Number(state.limit)}
        onChange={(p) => update(p as Record<string, string | number | undefined>, false)}
        onRowClick={setSelected}
      />
      <Drawer anchor="right" open={!!selected} onClose={() => setSelected(null)} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 }, p: 2 } } }}>
        {selected && (
          <>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="h6">{humanize(selected.action)}</Typography>
              <IconButton onClick={() => setSelected(null)} aria-label="Close">
                <CloseIcon />
              </IconButton>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {formatDateTime(selected.createdAt)} · {selected.user?.fullName ?? 'anonymous'} · {selected.role ?? '—'}
              <br />
              IP {selected.ipAddress ?? '—'} · request {selected.requestId ?? '—'}
              <br />
              {selected.userAgent}
            </Typography>
            <Json label="Previous data" value={selected.previousData} />
            <Json label="New data" value={selected.newData} />
          </>
        )}
      </Drawer>
    </>
  );
}
