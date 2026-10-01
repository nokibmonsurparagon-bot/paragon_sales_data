import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import AddIcon from '@mui/icons-material/Add';
import type { GridColDef } from '@mui/x-data-grid';
import { MASTER_DATA_ENTITIES, type MasterDataEntity, type MasterDataItem } from '@paragon/shared';
import { api } from '../../api/endpoints';
import { ErrorState } from '../../components/Feedback';
import { errorText, useNotifier } from '../../components/Notifier';
import { PageHeader } from '../../components/PageHeader';
import { MasterSelect } from '../../components/Pickers';
import { ServerGrid } from '../../components/ServerGrid';
import { useDebounced, useUrlState } from '../../hooks';
import { formatDateTime } from '../../utils/format';

const LABELS: Record<MasterDataEntity, string> = {
  wings: 'Wings',
  lines: 'Lines',
  branches: 'Branches',
  'cv-codes': 'CV Codes',
  banks: 'Banks',
  accounts: 'Accounts',
  parties: 'Farmers / Customers',
  'sales-types': 'Sales Types',
};
const SINGULAR: Record<MasterDataEntity, string> = {
  wings: 'wing',
  lines: 'line',
  branches: 'branch',
  'cv-codes': 'CV code',
  banks: 'bank',
  accounts: 'account',
  parties: 'farmer / customer',
  'sales-types': 'sales type',
};
const DEFAULTS = { entity: 'wings', page: '1', limit: '20', sort: 'name:asc' };

interface Draft {
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  bankId: string;
  isSpecial: boolean;
}

export default function MasterDataPage() {
  const { state, update } = useUrlState(DEFAULTS);
  const entity = state.entity as MasterDataEntity;
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [editing, setEditing] = useState<MasterDataItem | 'new' | null>(null);

  const params = { page: state.page, limit: state.limit, sort: state.sort, q, status: state.status };
  const list = useQuery({
    queryKey: ['master', entity, params],
    queryFn: () => api.master.list(entity, params),
    placeholderData: keepPreviousData,
  });

  const columns: GridColDef<MasterDataItem>[] = [
    { field: 'code', headerName: 'Code', width: 150 },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
    ...(entity === 'accounts' ? [{ field: 'bank', headerName: 'Bank', width: 220, sortable: false, valueGetter: (_v: unknown, r: MasterDataItem) => r.bank?.name ?? '' } as GridColDef<MasterDataItem>] : []),
    ...(entity === 'sales-types'
      ? [{ field: 'isSpecial', headerName: 'Special', width: 110, sortable: false, renderCell: ({ row }) => (row.isSpecial ? <Chip size="small" label="Special" color="secondary" /> : '—') } as GridColDef<MasterDataItem>]
      : []),
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: ({ row }) => <Chip size="small" label={row.status === 'ACTIVE' ? 'Active' : 'Inactive'} color={row.status === 'ACTIVE' ? 'success' : 'default'} variant="outlined" />,
    },
    { field: 'updatedAt', headerName: 'Updated', width: 170, valueFormatter: (v: string) => formatDateTime(v) },
  ];

  return (
    <>
      <PageHeader
        title="Master Data"
        subtitle="Records are never deleted – set them to Inactive to hide them from new transactions."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
            New {SINGULAR[entity]}
          </Button>
        }
      />
      <Tabs value={entity} onChange={(_e, v: string) => update({ entity: v, sort: 'name:asc', status: undefined })} variant="scrollable" sx={{ mb: 2 }}>
        {MASTER_DATA_ENTITIES.map((e) => (
          <Tab key={e} value={e} label={LABELS[e]} />
        ))}
      </Tabs>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField placeholder="Search code or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        <TextField select label="Status" value={state.status ?? ''} onChange={(e) => update({ status: e.target.value || undefined })} sx={{ maxWidth: { sm: 200 } }}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="ACTIVE">Active</MenuItem>
          <MenuItem value="INACTIVE">Inactive</MenuItem>
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
      <MasterDialog entity={entity} item={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function MasterDialog({ entity, item, onClose }: { entity: MasterDataEntity; item: MasterDataItem | 'new' | null; onClose(): void }) {
  const qc = useQueryClient();
  const { notify } = useNotifier();
  const isNew = item === 'new';
  const [v, setV] = useState<Draft>({ code: '', name: '', status: 'ACTIVE', bankId: '', isSpecial: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (item && item !== 'new') setV({ code: item.code, name: item.name, status: item.status, bankId: item.bankId ?? '', isSpecial: !!item.isSpecial });
    else setV({ code: '', name: '', status: 'ACTIVE', bankId: '', isSpecial: false });
  }, [item]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { code: v.code, name: v.name, status: v.status };
      if (entity === 'accounts') body.bankId = v.bankId;
      if (entity === 'sales-types') body.isSpecial = v.isSpecial;
      return isNew ? api.master.create(entity, body) : api.master.update(entity, (item as MasterDataItem).id, body);
    },
    onSuccess: () => {
      notify('Saved');
      void qc.invalidateQueries({ queryKey: ['master'] });
      void qc.invalidateQueries({ queryKey: ['master-options'] });
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });

  return (
    <Dialog open={!!item} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isNew ? `New ${SINGULAR[entity]}` : `Edit ${(item as MasterDataItem | null)?.code ?? ''}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <ErrorState error={new Error(error)} />}
          <TextField label="Code" required value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} helperText="Letters, digits, - and _ (stored upper-case)" />
          <TextField label="Name" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          {entity === 'accounts' && <MasterSelect entity="banks" label="Bank" required value={v.bankId} onChange={(bankId) => setV({ ...v, bankId })} />}
          {entity === 'sales-types' && (
            <FormControlLabel
              control={<Switch checked={v.isSpecial} onChange={(e) => setV({ ...v, isSpecial: e.target.checked })} />}
              label="Special transaction type (used by routing rules)"
            />
          )}
          <FormControlLabel
            control={<Switch checked={v.status === 'ACTIVE'} onChange={(e) => setV({ ...v, status: e.target.checked ? 'ACTIVE' : 'INACTIVE' })} />}
            label={v.status === 'ACTIVE' ? 'Active' : 'Inactive'}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !v.code || !v.name || (entity === 'accounts' && !v.bankId)}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
