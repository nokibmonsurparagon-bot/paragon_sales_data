import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import AddIcon from '@mui/icons-material/Add';
import type { GridColDef } from '@mui/x-data-grid';
import type { UserDto } from '@paragon/shared';
import { api } from '../../api/endpoints';
import { Can } from '../../components/Can';
import { ErrorState } from '../../components/Feedback';
import { errorText, useNotifier } from '../../components/Notifier';
import { PageHeader } from '../../components/PageHeader';
import { MasterSelect } from '../../components/Pickers';
import { ServerGrid } from '../../components/ServerGrid';
import { useDebounced, useMasterOptions, useUrlState } from '../../hooks';
import { useAuth } from '../../store/auth';
import { formatDateTime } from '../../utils/format';

const DEFAULTS = { page: '1', limit: '20', sort: 'fullName:asc' };

export default function UsersPage() {
  const { state, update } = useUrlState(DEFAULTS);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [editing, setEditing] = useState<UserDto | 'new' | null>(null);
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles.list });
  const params = { page: state.page, limit: state.limit, sort: state.sort, q, status: state.status, roleId: state.roleId, wingId: state.wingId };
  const list = useQuery({ queryKey: ['users', params], queryFn: () => api.users.list(params), placeholderData: keepPreviousData });

  const columns: GridColDef<UserDto>[] = [
    { field: 'fullName', headerName: 'Name', flex: 1, minWidth: 170 },
    { field: 'email', headerName: 'Email', flex: 1, minWidth: 200 },
    {
      field: 'roles',
      headerName: 'Roles',
      flex: 1,
      minWidth: 200,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%' }}>
          {row.roles.map((r) => (
            <Chip key={r.id} size="small" label={r.name} />
          ))}
        </Stack>
      ),
    },
    {
      field: 'wings',
      headerName: 'Wings',
      flex: 1,
      minWidth: 160,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%' }}>
          {row.allWings ? (
            <Chip size="small" color="primary" variant="outlined" label="All wings" />
          ) : row.wings.length ? (
            row.wings.map((w) => <Chip key={w.id} size="small" variant="outlined" label={w.name} />)
          ) : (
            '—'
          )}
        </Stack>
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 150,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%' }}>
          <Chip size="small" variant="outlined" label={row.status === 'ACTIVE' ? 'Active' : 'Disabled'} color={row.status === 'ACTIVE' ? 'success' : 'default'} />
          {row.lockedUntil && <Chip size="small" label="Locked" color="warning" />}
        </Stack>
      ),
    },
    { field: 'lastLoginAt', headerName: 'Last sign-in', width: 170, valueFormatter: (v: string | null) => formatDateTime(v) },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        actions={
          <Can any={['USER_CREATE']}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
              New user
            </Button>
          </Can>
        }
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
        <TextField select label="Role" value={state.roleId ?? ''} onChange={(e) => update({ roleId: e.target.value || undefined })} sx={{ maxWidth: { sm: 220 } }}>
          <MenuItem value="">All roles</MenuItem>
          {roles.data?.map((r) => (
            <MenuItem key={r.id} value={r.id}>
              {r.name}
            </MenuItem>
          ))}
        </TextField>
        <Box sx={{ width: { sm: 200 }, flexShrink: 0 }}>
          <MasterSelect entity="wings" label="Wing" allowEmpty="All wings" value={state.wingId ?? ''} onChange={(v) => update({ wingId: v || undefined })} />
        </Box>
        <TextField select label="Status" value={state.status ?? ''} onChange={(e) => update({ status: e.target.value || undefined })} sx={{ maxWidth: { sm: 180 } }}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="ACTIVE">Active</MenuItem>
          <MenuItem value="DISABLED">Disabled</MenuItem>
        </TextField>
      </Stack>
      {list.error && <ErrorState error={list.error} />}
      <ServerGrid
        rows={list.data?.items ?? []}
        columns={columns}
        total={list.data?.total ?? 0}
        loading={list.isFetching}
        page={Number(state.page)}
        limit={Number(state.limit)}
        sort={state.sort}
        onChange={(p) => update(p as Record<string, string | number | undefined>, false)}
        onRowClick={(row) => setEditing(row)}
      />
      <UserDialog item={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function UserDialog({ item, onClose }: { item: UserDto | 'new' | null; onClose(): void }) {
  const { user: me, can } = useAuth();
  const qc = useQueryClient();
  const { notify } = useNotifier();
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles.list });
  const wings = useMasterOptions('wings');
  const isNew = item === 'new';
  const existing = isNew ? null : item;
  const isSelf = existing?.id === me?.id;
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [wingIds, setWingIds] = useState<string[]>([]);
  const [allWings, setAllWings] = useState(false);
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');

  useEffect(() => {
    setError(null);
    setPassword('');
    setResetPw('');
    setEmail(existing?.email ?? '');
    setFullName(existing?.fullName ?? '');
    setRoleIds(existing?.roles.map((r) => r.id) ?? []);
    setWingIds(existing?.wings.map((w) => w.id) ?? []);
    setAllWings(existing?.allWings ?? false);
    setActive(existing ? existing.status === 'ACTIVE' : true);
  }, [item, existing]);

  const done = (msg: string) => {
    notify(msg);
    void qc.invalidateQueries({ queryKey: ['users'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () =>
      isNew
        ? api.users.create({ email, fullName, password, roleIds, wingIds: allWings ? [] : wingIds, allWings })
        : api.users.update(existing!.id, {
            ...(can('USER_UPDATE') ? { fullName, wingIds: allWings ? [] : wingIds, allWings, ...(isSelf ? {} : { roleIds }) } : {}),
            ...(can('USER_DISABLE') && !isSelf ? { status: active ? 'ACTIVE' : 'DISABLED' } : {}),
          }),
    onSuccess: () => done(isNew ? 'User created – they must change the password at first sign-in' : 'User updated'),
    onError: (e) => setError(errorText(e)),
  });
  const reset = useMutation({
    mutationFn: () => api.users.resetPassword(existing!.id, resetPw),
    onSuccess: () => done('Password reset'),
    onError: (e) => setError(errorText(e)),
  });

  return (
    <Dialog open={!!item} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isNew ? 'New user' : existing?.fullName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {isSelf && <Alert severity="info">You cannot change your own roles or status.</Alert>}
          <TextField label="Email" type="email" required value={email} disabled={!isNew} onChange={(e) => setEmail(e.target.value)} />
          <TextField label="Full name" required value={fullName} disabled={!can('USER_UPDATE', 'USER_CREATE')} onChange={(e) => setFullName(e.target.value)} />
          {isNew && (
            <TextField
              label="Temporary password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              helperText="At least 10 characters with upper, lower case and a digit. The user must change it at first sign-in."
            />
          )}
          <TextField
            select
            label="Roles"
            required
            value={roleIds}
            disabled={isSelf || !can('USER_UPDATE', 'USER_CREATE')}
            slotProps={{ select: { multiple: true, renderValue: (v) => roles.data?.filter((r) => (v as string[]).includes(r.id)).map((r) => r.name).join(', ') } }}
            onChange={(e) => setRoleIds(e.target.value as unknown as string[])}
          >
            {roles.data?.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                <Checkbox size="small" checked={roleIds.includes(r.id)} />
                <ListItemText primary={r.name} secondary={r.description} />
              </MenuItem>
            ))}
          </TextField>
          <Stack spacing={0.5}>
            <FormControlLabel
              control={<Switch checked={allWings} disabled={!can('USER_UPDATE', 'USER_CREATE')} onChange={(e) => setAllWings(e.target.checked)} />}
              label="All wings (including wings added later) – e.g. central finance, auditors"
            />
            <TextField
              select
              label="Wings"
              value={allWings ? [] : wingIds}
              disabled={allWings || !can('USER_UPDATE', 'USER_CREATE')}
              helperText={
                allWings
                  ? 'Works on every wing'
                  : 'Field Force create, and reviewers see and approve, transactions of these wings only'
              }
              slotProps={{
                select: {
                  multiple: true,
                  renderValue: (v) => (existing?.wings ?? []).concat(wings.data ?? []).filter((w, i, all) => (v as string[]).includes(w.id) && all.findIndex((x) => x.id === w.id) === i).map((w) => w.name).join(', '),
                },
              }}
              onChange={(e) => setWingIds(e.target.value as unknown as string[])}
            >
              {wings.data?.map((w) => (
                <MenuItem key={w.id} value={w.id}>
                  <Checkbox size="small" checked={wingIds.includes(w.id)} />
                  <ListItemText primary={w.name} secondary={w.code} />
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          {!isNew && (
            <FormControlLabel
              control={<Switch checked={active} disabled={isSelf || !can('USER_DISABLE')} onChange={(e) => setActive(e.target.checked)} />}
              label={active ? 'Active' : 'Disabled (signs the user out everywhere)'}
            />
          )}
          {!isNew && can('USER_UPDATE') && !isSelf && (
            <Stack direction="row" spacing={1}>
              <TextField label="New temporary password" type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
              <Button onClick={() => reset.mutate()} disabled={resetPw.length < 10 || reset.isPending} sx={{ flexShrink: 0 }}>
                Reset password
              </Button>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !fullName || (isNew && (!email || !password || !roleIds.length))}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
