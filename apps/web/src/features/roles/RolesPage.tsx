import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import type { Permission, PermissionDto, RoleDto } from '@paragon/shared';
import { api } from '../../api/endpoints';
import { Can } from '../../components/Can';
import { ErrorState, Loading } from '../../components/Feedback';
import { errorText, useNotifier } from '../../components/Notifier';
import { PageHeader } from '../../components/PageHeader';
import { useAuth } from '../../store/auth';

export default function RolesPage() {
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles.list });
  const [editing, setEditing] = useState<RoleDto | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Roles & permissions"
        subtitle="Authorization is database-driven: a role is a named set of permissions, and users may hold several roles."
        actions={
          <Can any={['ROLE_CREATE']}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
              New role
            </Button>
          </Can>
        }
      />
      {roles.isLoading && <Loading />}
      {roles.error && <ErrorState error={roles.error} />}
      <Grid container spacing={2}>
        {roles.data?.map((r) => (
          <Grid key={r.id} size={{ xs: 12, sm: 6, lg: 4 }}>
            <Card sx={{ height: '100%' }}>
              <CardActionArea onClick={() => setEditing(r)} sx={{ height: '100%', alignItems: 'flex-start' }}>
                <CardContent>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                    <Typography variant="h6">{r.name}</Typography>
                    {r.isSystem && <Chip size="small" label="System" variant="outlined" />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {r.code} · {r.userCount} user(s) · {r.permissions.length} permission(s)
                  </Typography>
                  <Typography variant="body2">{r.description}</Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
      <RoleDialog item={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function RoleDialog({ item, onClose }: { item: RoleDto | 'new' | null; onClose(): void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { notify } = useNotifier();
  const perms = useQuery({ queryKey: ['permissions'], queryFn: api.roles.permissions });
  const isNew = item === 'new';
  const role = isNew ? null : item;
  const locked = role?.code === 'ADMIN';
  const editable = isNew ? can('ROLE_CREATE') : can('ROLE_UPDATE');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<Permission>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setCode(role?.code ?? '');
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setSelected(new Set(role?.permissions ?? []));
  }, [item, role]);

  const byModule = useMemo(() => {
    const m = new Map<string, PermissionDto[]>();
    for (const p of perms.data ?? []) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [perms.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description: description || null, ...(locked ? {} : { permissions: [...selected] }) };
      return isNew ? api.roles.create({ ...body, code }) : api.roles.update(role!.id, body);
    },
    onSuccess: () => {
      notify('Role saved. Changes apply to signed-in users within 30 seconds.');
      void qc.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });

  const toggle = (p: Permission) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  return (
    <Dialog open={!!item} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{isNew ? 'New role' : role?.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {locked && <Alert severity="info">The Administrator role always holds every administrative permission (prevents lock-out).</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Code" required value={code} disabled={!isNew} onChange={(e) => setCode(e.target.value.toUpperCase())} helperText="e.g. REGIONAL_MANAGER" />
            <TextField label="Name" required value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} />
          </Stack>
          <TextField label="Description" value={description} disabled={!editable} onChange={(e) => setDescription(e.target.value)} />
          {byModule.map(([module, list]) => (
            <Box key={module}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {module}
              </Typography>
              <Grid container>
                {list.map((p) => (
                  <Grid key={p.code} size={{ xs: 12, sm: 6 }}>
                    <FormControlLabel
                      control={<Checkbox size="small" checked={selected.has(p.code)} disabled={!editable || locked} onChange={() => toggle(p.code)} />}
                      label={
                        <span>
                          <b style={{ fontSize: 13 }}>{p.code}</b>
                          <br />
                          <span style={{ fontSize: 12, opacity: 0.75 }}>{p.description}</span>
                        </span>
                      }
                      sx={{ alignItems: 'flex-start', '& .MuiCheckbox-root': { pt: 0.5 } }}
                    />
                  </Grid>
                ))}
              </Grid>
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {editable && (
          <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !name || (isNew && !code)}>
            Save
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
