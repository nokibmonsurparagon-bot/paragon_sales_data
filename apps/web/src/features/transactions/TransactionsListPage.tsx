import { useMemo } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import AddIcon from '@mui/icons-material/Add';
import type { GridColDef } from '@mui/x-data-grid';
import type { TransactionListItem } from '@paragon/shared';
import { api } from '../../api/endpoints';
import { Can } from '../../components/Can';
import { ErrorState } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { ServerGrid } from '../../components/ServerGrid';
import { DuplicateBadge, StatusBadge } from '../../components/StatusBadge';
import { useCurrency, useUrlState } from '../../hooks';
import { useAuth } from '../../store/auth';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format';
import { TransactionFilters, apiFilters } from './TransactionFilters';

export function useTransactionColumns(basePath: string): GridColDef<TransactionListItem>[] {
  const currency = useCurrency();
  return useMemo(
    () => [
      {
        field: 'transactionNumber',
        headerName: 'Number',
        minWidth: 150,
        flex: 1,
        renderCell: ({ row }) => (
          <Link component={RouterLink} to={`${basePath}/${row.id}`} onClick={(e) => e.stopPropagation()} fontWeight={600}>
            {row.transactionNumber}
          </Link>
        ),
      },
      { field: 'transactionDate', headerName: 'Date', width: 115, valueFormatter: (v: string | null) => formatDate(v) },
      { field: 'wing', headerName: 'Wing', width: 100, sortable: false, valueGetter: (_v, row) => row.wing.name },
      { field: 'line', headerName: 'Line', width: 110, sortable: false, valueGetter: (_v, row) => row.line?.name ?? '—' },
      { field: 'branch', headerName: 'Branch', width: 100, sortable: false, valueGetter: (_v, row) => row.branch?.code ?? '—' },
      { field: 'cvCode', headerName: 'CV Code', width: 110, sortable: false, valueGetter: (_v, row) => row.party?.code ?? '—' },
      { field: 'party', headerName: 'Farmer / Customer', minWidth: 160, flex: 1.2, sortable: false, valueGetter: (_v, row) => row.party?.name ?? '—' },
      {
        field: 'amount',
        headerName: 'Deposit',
        width: 140,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (v: string | null) => formatMoney(v, currency),
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 210,
        flex: 1,
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%' }}>
            <StatusBadge status={row.status} />
            <DuplicateBadge status={row.duplicateStatus} />
          </Stack>
        ),
      },
      { field: 'fieldForce', headerName: 'Field Force', minWidth: 140, flex: 1, sortable: false, valueGetter: (_v, row) => row.fieldForce.fullName },
      { field: 'salesType', headerName: 'Sales Type', width: 140, sortable: false, valueGetter: (_v, row) => row.salesType?.name ?? '—' },
      { field: 'paymentReference', headerName: 'Payment Ref.', width: 150, sortable: false, valueGetter: (v) => v ?? '—' },
      { field: 'bankDetails', headerName: 'Bank Details', minWidth: 160, flex: 1, sortable: false, valueGetter: (v) => v ?? '—' },
      {
        field: 'creditAmount',
        headerName: 'Amount (CR)',
        width: 130,
        align: 'right',
        headerAlign: 'right',
        sortable: false,
        valueFormatter: (v: string | null) => formatMoney(v, currency),
      },
      {
        field: 'bankCharge',
        headerName: 'Bank Charge',
        width: 120,
        align: 'right',
        headerAlign: 'right',
        sortable: false,
        valueFormatter: (v: string | null) => formatMoney(v, currency),
      },
      {
        field: 'assignedRole',
        headerName: 'With',
        width: 150,
        sortable: false,
        renderCell: ({ row }) =>
          row.assignedUser ? (
            <Chip size="small" label={row.assignedUser.fullName} variant="outlined" />
          ) : (
            (row.assignedRole?.name ?? '—')
          ),
      },
      { field: 'updatedAt', headerName: 'Updated', width: 160, valueFormatter: (v: string) => formatDateTime(v) },
    ],
    [basePath, currency],
  );
}

const DEFAULTS = { page: '1', limit: '20', sort: 'createdAt:desc' };
/** Less-used columns start hidden; users can show them from the column menu. */
export const HIDDEN_COLUMNS = ['line', 'branch', 'salesType', 'paymentReference', 'bankDetails', 'bankCharge'];

/** Transaction list. `queue` mode = items awaiting the current user's review. */
export function TransactionList({ mode }: { mode: 'all' | 'queue' }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { state, update, reset } = useUrlState(DEFAULTS);
  const basePath = mode === 'queue' ? '/approvals' : '/transactions';
  const columns = useTransactionColumns(basePath);
  const view = mode === 'queue' ? 'queue' : (state.view ?? 'all');
  const params = { ...apiFilters(state), page: state.page, limit: state.limit, sort: state.sort, view };
  const q = useQuery({
    queryKey: ['transactions', params],
    queryFn: () => api.transactions.list(params),
    placeholderData: keepPreviousData,
  });
  const showMineTab = mode === 'all' && can('SALES_CREATE') && can('SALES_VIEW_ALL', 'SALES_ADMIN_REVIEW', 'FINANCE_REVIEW');

  return (
    <>
      {showMineTab && (
        <Tabs value={view} onChange={(_e, v: string) => update({ view: v === 'all' ? undefined : v })} sx={{ mb: 1 }}>
          <Tab value="all" label="All visible" />
          <Tab value="mine" label="Mine" />
        </Tabs>
      )}
      <TransactionFilters state={state} update={update} reset={reset} />
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      <ServerGrid
        rows={q.data?.items ?? []}
        columns={columns}
        total={q.data?.total ?? 0}
        loading={q.isFetching}
        page={Number(state.page)}
        limit={Number(state.limit)}
        sort={state.sort}
        onChange={(p) => update(p as Record<string, string | number | undefined>, false)}
        onRowClick={(row) => navigate(`${basePath}/${row.id}`)}
        hiddenColumns={HIDDEN_COLUMNS}
        noRowsLabel={mode === 'queue' ? 'Nothing is waiting for your review' : 'No transactions match the current filters'}
      />
    </>
  );
}

export default function TransactionsListPage() {
  return (
    <>
      <PageHeader
        title="Transactions"
        actions={
          <Can any={['SALES_CREATE']}>
            <Button variant="contained" startIcon={<AddIcon />} component={RouterLink} to="/transactions/new">
              New transaction
            </Button>
          </Can>
        }
      />
      <TransactionList mode="all" />
    </>
  );
}
