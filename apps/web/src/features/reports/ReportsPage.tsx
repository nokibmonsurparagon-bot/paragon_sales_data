import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import DownloadIcon from '@mui/icons-material/Download';
import type { GridColDef } from '@mui/x-data-grid';
import { APPROVAL_STAGES, AUDIT_ACTIONS, TRANSACTION_STATUSES, TRANSACTION_STATUS_LABELS, type ReportType, type UserRef } from '@paragon/shared';
import { api } from '../../api/endpoints';
import { Can } from '../../components/Can';
import { ErrorState } from '../../components/Feedback';
import { useNotifier } from '../../components/Notifier';
import { PageHeader } from '../../components/PageHeader';
import { MasterPicker, MasterSelect, UserPicker, type SearchableEntity } from '../../components/Pickers';
import { ServerGrid } from '../../components/ServerGrid';
import { useUrlState } from '../../hooks';
import { useAuth } from '../../store/auth';
import { humanize } from '../../utils/format';

const REPORTS: { type: ReportType; label: string; audit?: boolean }[] = [
  { type: 'sales', label: 'Sales transactions' },
  { type: 'approvals', label: 'Approvals' },
  { type: 'rejections', label: 'Rejections & returns' },
  { type: 'user-activity', label: 'User activity', audit: true },
  { type: 'audit', label: 'Audit', audit: true },
];
const DEFAULTS = { type: 'sales', page: '1', limit: '20' };
const FILTERS = ['dateFrom', 'dateTo', 'wingId', 'lineId', 'branchId', 'partyId', 'status', 'bankId', 'salesTypeId', 'stage', 'userId', 'action'] as const;
const MONEY_COLUMNS = new Set(['amount', 'creditAmount', 'bankCharge']);
const PICKED: [string, SearchableEntity, string][] = [
  ['lineId', 'lines', 'Line'],
  ['branchId', 'branches', 'Branch'],
  ['partyId', 'parties', 'CV code / farmer'],
];

export default function ReportsPage() {
  const { can } = useAuth();
  const { notifyError } = useNotifier();
  const { state, update } = useUrlState(DEFAULTS);
  const [user, setUser] = useState<UserRef | null>(null);
  const [exporting, setExporting] = useState(false);
  const type = state.type as ReportType;
  const isAudit = type === 'audit' || type === 'user-activity';
  const isDecision = type === 'approvals' || type === 'rejections';
  const filters = Object.fromEntries(FILTERS.map((k) => [k, state[k]]));
  const params = { ...filters, page: state.page, limit: state.limit };
  const q = useQuery({ queryKey: ['report', type, params], queryFn: () => api.reports.page(type, params), placeholderData: keepPreviousData });

  const columns: GridColDef[] = (q.data?.columns ?? []).map((c) => ({
    field: c.key,
    headerName: c.label,
    minWidth: 130,
    flex: 1,
    sortable: false,
    align: MONEY_COLUMNS.has(c.key) ? 'right' : 'left',
    headerAlign: MONEY_COLUMNS.has(c.key) ? 'right' : 'left',
  }));

  const exportAs = async (format: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      await api.reports.export(type, filters, format);
    } catch (e) {
      notifyError(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Reports only include data you are allowed to see. Exports are logged."
        actions={
          <Can any={['REPORT_EXPORT']}>
            <Button startIcon={<DownloadIcon />} onClick={() => void exportAs('csv')} disabled={exporting}>
              CSV
            </Button>
            <Button startIcon={<DownloadIcon />} variant="contained" onClick={() => void exportAs('xlsx')} disabled={exporting}>
              Excel
            </Button>
          </Can>
        }
      />
      <Tabs value={type} onChange={(_e, v: string) => update({ type: v })} variant="scrollable" sx={{ mb: 2 }}>
        {REPORTS.filter((r) => !r.audit || can('AUDIT_VIEW')).map((r) => (
          <Tab key={r.type} value={r.type} label={r.label} />
        ))}
      </Tabs>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 6, md: 2 }}>
            <TextField label={isAudit ? 'From' : 'Txn date from'} type="date" value={state.dateFrom ?? ''} onChange={(e) => update({ dateFrom: e.target.value || undefined })} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <TextField label={isAudit ? 'To' : 'Txn date to'} type="date" value={state.dateTo ?? ''} onChange={(e) => update({ dateTo: e.target.value || undefined })} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          {!isAudit && (
            <>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <MasterSelect entity="wings" label="Wing" allowEmpty="Any wing" value={state.wingId ?? ''} onChange={(v) => update({ wingId: v || undefined })} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <TextField select label="Status" value={state.status ?? ''} onChange={(e) => update({ status: e.target.value || undefined })}>
                  <MenuItem value="">Any status</MenuItem>
                  {TRANSACTION_STATUSES.map((s) => (
                    <MenuItem key={s} value={s}>
                      {TRANSACTION_STATUS_LABELS[s]}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <MasterSelect entity="banks" label="Bank" allowEmpty="Any bank" value={state.bankId ?? ''} onChange={(v) => update({ bankId: v || undefined })} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <MasterSelect entity="sales-types" label="Sales type" allowEmpty="Any type" value={state.salesTypeId ?? ''} onChange={(v) => update({ salesTypeId: v || undefined })} />
              </Grid>
              {PICKED.map(([key, entity, label]) => (
                <Grid key={key} size={{ xs: 12, sm: 4, md: 2 }}>
                  <MasterPicker
                    entity={entity}
                    label={label}
                    value={state[key] ? { id: state[key], name: state[`${key}Name`] ?? label } : null}
                    onChange={(v) => update({ [key]: v?.id, [`${key}Name`]: v?.name })}
                  />
                </Grid>
              ))}
            </>
          )}
          {isDecision && (
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField select label="Stage" value={state.stage ?? ''} onChange={(e) => update({ stage: e.target.value || undefined })}>
                <MenuItem value="">Any stage</MenuItem>
                {APPROVAL_STAGES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {humanize(s)}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          )}
          {(isAudit || isDecision) && (
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <UserPicker
                label={isDecision ? 'Reviewer' : 'User'}
                value={user}
                onChange={(u) => {
                  setUser(u);
                  update({ userId: u?.id });
                }}
              />
            </Grid>
          )}
          {isAudit && (
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
          )}
        </Grid>
      </Paper>
      {q.error && <ErrorState error={q.error} />}
      <ServerGrid
        rows={(q.data?.rows ?? []).map((r, i) => ({ __id: `${state.page}-${i}`, ...r }))}
        getRowId={(r) => String(r.__id)}
        columns={columns}
        total={q.data?.total ?? 0}
        loading={q.isFetching}
        page={Number(state.page)}
        limit={Number(state.limit)}
        onChange={(p) => update(p as Record<string, string | number | undefined>, false)}
      />
    </>
  );
}
