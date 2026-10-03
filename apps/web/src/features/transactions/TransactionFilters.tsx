import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Collapse from '@mui/material/Collapse';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import { TRANSACTION_STATUSES, TRANSACTION_STATUS_LABELS, type TransactionStatus } from '@paragon/shared';
import { MasterPicker, MasterSelect, PartyPicker, UserPicker, type SearchableEntity } from '../../components/Pickers';
import { useDebounced } from '../../hooks';
import { useAuth } from '../../store/auth';

export const FILTER_KEYS = [
  'q',
  'status',
  'dateFrom',
  'dateTo',
  'wingId',
  'fieldForceUserId',
  'lineId',
  'branchId',
  'partyId',
  'bankId',
  'accountId',
  'salesTypeId',
  'amountMin',
  'amountMax',
] as const;

/** Searchable master-data filters: [URL key, entity, label]. The chosen name is kept in `<key>Name`. */
const PICKED_FILTERS: [string, SearchableEntity, string][] = [
  ['lineId', 'lines', 'Line'],
  ['branchId', 'branches', 'Branch'],
];

interface Props {
  state: Record<string, string | undefined>;
  update(patch: Record<string, string | undefined>): void;
  reset(): void;
  showSearch?: boolean;
  showStatus?: boolean;
}

/** Server-side filters (spec §21, §25), stored in the URL. Names shown for selected ids are kept in the URL too. */
export function TransactionFilters({ state, update, reset, showSearch = true, showStatus = true }: Props) {
  const { can } = useAuth();
  const [q, setQ] = useState(state.q ?? '');
  const debounced = useDebounced(q);
  const advancedCount = FILTER_KEYS.filter((k) => k !== 'q' && k !== 'status' && state[k]).length;
  const [open, setOpen] = useState(advancedCount > 0);

  useEffect(() => {
    if ((state.q ?? '') !== debounced) update({ q: debounced || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => setQ(state.q ?? ''), [state.q]);

  const statuses = state.status ? (state.status.split(',') as TransactionStatus[]) : [];

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
        {showSearch && (
          <TextField
            placeholder="Search number, farmer, CV code, reference, bank details, narration, amount or status"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search transactions"
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
          />
        )}
        {showStatus && (
          <TextField
            select
            label="Status"
            sx={{ minWidth: 220 }}
            value={statuses}
            slotProps={{
              select: {
                multiple: true,
                renderValue: (v) => (v as TransactionStatus[]).map((s) => TRANSACTION_STATUS_LABELS[s]).join(', '),
              },
            }}
            onChange={(e) => {
              const v = e.target.value as unknown as TransactionStatus[];
              update({ status: v.length ? v.join(',') : undefined });
            }}
          >
            {TRANSACTION_STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                <Checkbox size="small" checked={statuses.includes(s)} />
                <ListItemText primary={TRANSACTION_STATUS_LABELS[s]} />
              </MenuItem>
            ))}
          </TextField>
        )}
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Button startIcon={<FilterListIcon />} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Filters{advancedCount ? ` (${advancedCount})` : ''}
          </Button>
          <Button
            color="inherit"
            onClick={() => {
              setQ('');
              reset();
            }}
          >
            Reset
          </Button>
        </Stack>
      </Stack>
      <Collapse in={open}>
        <Box sx={{ pt: 2 }}>
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <DatePicker
                label="Date from"
                value={state.dateFrom ? dayjs(state.dateFrom) : null}
                onChange={(d) => update({ dateFrom: d?.isValid() ? d.format('YYYY-MM-DD') : undefined })}
                slotProps={{ textField: { size: 'small', fullWidth: true }, field: { clearable: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <DatePicker
                label="Date to"
                value={state.dateTo ? dayjs(state.dateTo) : null}
                onChange={(d) => update({ dateTo: d?.isValid() ? d.format('YYYY-MM-DD') : undefined })}
                slotProps={{ textField: { size: 'small', fullWidth: true }, field: { clearable: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 2 }}>
              <MasterSelect entity="wings" label="Wing" allowEmpty="Any wing" value={state.wingId ?? ''} onChange={(v) => update({ wingId: v || undefined })} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <PartyPicker
                value={state.partyId ? { id: state.partyId, name: state.partyName ?? 'Selected CV code / farmer' } : null}
                onChange={(p) => update({ partyId: p?.id, partyName: p?.name })}
              />
            </Grid>
            {PICKED_FILTERS.map(([key, entity, label]) => (
              <Grid key={key} size={{ xs: 12, sm: 4, md: 2 }}>
                <MasterPicker
                  entity={entity}
                  label={label}
                  value={state[key] ? { id: state[key], name: state[`${key}Name`] ?? label } : null}
                  onChange={(v) => update({ [key]: v?.id, [`${key}Name`]: v?.name })}
                />
              </Grid>
            ))}
            {can('SALES_VIEW_ALL', 'SALES_ADMIN_REVIEW', 'FINANCE_REVIEW') && (
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <UserPicker
                  label="Field Force"
                  permission="SALES_CREATE"
                  value={state.fieldForceUserId ? { id: state.fieldForceUserId, fullName: state.fieldForceName ?? 'Selected user', email: '' } : null}
                  onChange={(u) => update({ fieldForceUserId: u?.id, fieldForceName: u?.fullName })}
                />
              </Grid>
            )}
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <MasterSelect entity="banks" label="Bank" allowEmpty="Any bank" value={state.bankId ?? ''} onChange={(v) => update({ bankId: v || undefined, accountId: undefined })} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <MasterSelect entity="accounts" label="Account" allowEmpty="Any account" bankId={state.bankId} value={state.accountId ?? ''} onChange={(v) => update({ accountId: v || undefined })} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <MasterSelect entity="sales-types" label="Sales type" allowEmpty="Any type" value={state.salesTypeId ?? ''} onChange={(v) => update({ salesTypeId: v || undefined })} />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField label="Min amount" value={state.amountMin ?? ''} inputMode="decimal" onChange={(e) => update({ amountMin: e.target.value.replace(/[^\d.]/g, '') || undefined })} />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField label="Max amount" value={state.amountMax ?? ''} inputMode="decimal" onChange={(e) => update({ amountMax: e.target.value.replace(/[^\d.]/g, '') || undefined })} />
            </Grid>
          </Grid>
        </Box>
      </Collapse>
    </Paper>
  );
}

/** Only the keys the API understands. */
export function apiFilters(state: Record<string, string | undefined>) {
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, state[k]]));
}
