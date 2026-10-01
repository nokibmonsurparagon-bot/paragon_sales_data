import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import type { GridColDef, GridRowId } from '@mui/x-data-grid';
import {
  BULK_ACTION_MAX_ITEMS,
  TRANSACTION_STATUS_LABELS,
  fromCents,
  toCents,
  type BulkActionResult,
  type TransactionListItem,
} from '@paragon/shared';
import { api } from '../../api/endpoints';
import { ConfirmDialog, type ConfirmResult } from '../../components/ConfirmDialog';
import { CreditAmountField, chargeFor, creditAmountError } from '../../components/CreditAmountField';
import { ErrorState } from '../../components/Feedback';
import { useNotifier } from '../../components/Notifier';
import { PageHeader } from '../../components/PageHeader';
import { ServerGrid } from '../../components/ServerGrid';
import { useCurrency, useUrlState } from '../../hooks';
import { formatMoney } from '../../utils/format';
import { TransactionFilters, apiFilters } from '../transactions/TransactionFilters';
import { useTransactionColumns } from '../transactions/TransactionsListPage';

type Verb = 'approve' | 'reject';

const DEFAULTS = { page: '1', limit: '20', sort: 'createdAt:desc' };

const can = (row: TransactionListItem, verb: Verb) =>
  !!row.allowedActions?.some((a) => (verb === 'approve' ? a === 'SA_APPROVE' || a === 'FIN_APPROVE' : a === 'SA_REJECT' || a === 'FIN_REJECT'));
const selectable = (row: TransactionListItem) => can(row, 'approve') || can(row, 'reject');
/** Finance approval is the final one and records Amount (CR). */
const needsCredit = (row: TransactionListItem) => !!row.allowedActions?.includes('FIN_APPROVE');

export default function ApprovalsQueuePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { notify, notifyError } = useNotifier();
  const currency = useCurrency();
  const { state, update, reset } = useUrlState(DEFAULTS);
  const params = { ...apiFilters(state), page: state.page, limit: state.limit, sort: state.sort, view: 'queue' };
  const q = useQuery({
    queryKey: ['transactions', params],
    queryFn: () => api.transactions.list(params),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => q.data?.items ?? [], [q.data]);

  const [selected, setSelected] = useState<GridRowId[]>([]);
  const [credits, setCredits] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{ verb: Verb; rows: TransactionListItem[] } | null>(null);
  // The processed rows are kept with the result: they leave the queue as soon as it refreshes.
  const [results, setResults] = useState<{ result: BulkActionResult; rows: TransactionListItem[] } | null>(null);

  const creditOf = (row: TransactionListItem) => credits[row.id] ?? row.creditAmount ?? '';
  const selectedRows = rows.filter((r) => selected.includes(r.id));

  const run = useMutation({
    mutationFn: ({ verb, rows: targets, r }: { verb: Verb; rows: TransactionListItem[]; r: ConfirmResult }) => {
      const items = targets.map((row) => {
        const credit = verb === 'approve' && needsCredit(row) ? creditOf(row).trim() : '';
        return { id: row.id, version: row.version, ...(credit ? { creditAmount: credit } : {}) };
      });
      const body =
        verb === 'approve'
          ? { items, ...(r.text ? { comment: r.text } : {}) }
          : { items, reason: r.text, ...(r.category ? { correctionCategory: r.category } : {}) };
      return api.transactions.bulk(verb, body);
    },
    onSuccess: ({ data }, { verb, rows: targets }) => {
      setPending(null);
      const done = new Set(data.results.filter((x) => x.ok).map((x) => x.id));
      setSelected((s) => s.filter((id) => !done.has(String(id))));
      setCredits((c) => Object.fromEntries(Object.entries(c).filter(([id]) => !done.has(id))));
      if (data.results.length === 1) {
        const one = data.results[0]!;
        if (one.ok) notify(`${one.transactionNumber ?? 'Transaction'} ${verb === 'approve' ? 'approved' : 'rejected'}`);
        else notify(`${one.transactionNumber ?? 'Transaction'}: ${one.error?.message ?? 'failed'}`, 'error');
        if (one.warnings.length) notify(one.warnings.join('; '), 'warning');
      } else {
        setResults({ result: data, rows: targets });
      }
      for (const key of [['transactions'], ['dashboard'], ['notifications']]) void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => {
      setPending(null);
      notifyError(e);
      void qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const baseColumns = useTransactionColumns('/approvals');
  const columns = useMemo<GridColDef<TransactionListItem>[]>(() => {
    const byField = new Map(baseColumns.map((c) => [c.field, c]));
    const pick = (f: string) => byField.get(f)!;
    return [
      pick('transactionNumber'),
      pick('transactionDate'),
      pick('party'),
      pick('cvCode'),
      pick('amount'),
      {
        field: 'creditInput',
        headerName: 'Amount (CR)',
        width: 150,
        sortable: false,
        renderCell: ({ row }) =>
          needsCredit(row) ? (
            <Stack sx={{ height: '100%', justifyContent: 'center' }}>
              <CreditAmountField
                compact
                size="small"
                deposit={row.amount}
                value={creditOf(row)}
                onChange={(v) => setCredits((c) => ({ ...c, [row.id]: v }))}
                currency={currency}
              />
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
              {row.status === 'SALES_ADMIN_REVIEW' ? 'Finance enters' : '—'}
            </Typography>
          ),
      },
      {
        field: 'chargePreview',
        headerName: 'Bank Charge',
        width: 115,
        align: 'right',
        headerAlign: 'right',
        sortable: false,
        valueGetter: (_v, row) => (needsCredit(row) ? chargeFor(row.amount, creditOf(row)) : null),
        valueFormatter: (v: string | null) => formatMoney(v, currency),
      },
      {
        field: 'actions',
        headerName: 'Actions',
        width: 110,
        sortable: false,
        disableColumnMenu: true,
        renderCell: ({ row }) => {
          const creditProblem = needsCredit(row) ? creditAmountError(row.amount, creditOf(row)) : null;
          return (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%' }} onClick={(e) => e.stopPropagation()}>
              {can(row, 'approve') && (
                <Tooltip title={creditProblem ? `Approve – ${creditProblem}` : 'Approve'}>
                  <span>
                    <IconButton
                      size="small"
                      color="success"
                      aria-label={`Approve ${row.transactionNumber}`}
                      disabled={run.isPending || !!creditProblem}
                      onClick={() => setPending({ verb: 'approve', rows: [row] })}
                    >
                      <CheckIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              {can(row, 'reject') && (
                <Tooltip title="Reject">
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      aria-label={`Reject ${row.transactionNumber}`}
                      disabled={run.isPending}
                      onClick={() => setPending({ verb: 'reject', rows: [row] })}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </Stack>
          );
        },
      },
      {
        field: 'attachmentCount',
        headerName: 'Docs',
        width: 70,
        sortable: false,
        renderCell: ({ row }) => (
          <Tooltip title={`${row.attachmentCount} supporting document(s) – open the transaction to review them`}>
            <Chip size="small" icon={<AttachFileIcon />} label={row.attachmentCount} color={row.attachmentCount ? 'default' : 'warning'} variant="outlined" />
          </Tooltip>
        ),
      },
      pick('status'),
      pick('wing'),
      pick('fieldForce'),
      pick('line'),
      pick('branch'),
      pick('bankDetails'),
      pick('paymentReference'),
      pick('salesType'),
      pick('assignedRole'),
    ];
    // creditOf reads `credits`; recompute cells when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseColumns, credits, currency, run.isPending]);

  const onSelect = useCallback((ids: GridRowId[]) => setSelected(ids.slice(0, BULK_ACTION_MAX_ITEMS)), []);
  const selection = useMemo(() => ({ ids: selected, onChange: onSelect, isSelectable: selectable }), [selected, onSelect]);

  // ---- bulk selection summary ----
  const approvable = selectedRows.filter((r) => can(r, 'approve'));
  const rejectable = selectedRows.filter((r) => can(r, 'reject'));
  const selectedTotal = fromCents(selectedRows.reduce((sum, r) => sum + (r.amount ? toCents(r.amount) : 0n), 0n));

  const d = pending;
  const total = d ? fromCents(d.rows.reduce((sum, r) => sum + (r.amount ? toCents(r.amount) : 0n), 0n)) : '0';
  const missingCredit = d?.verb === 'approve' ? d.rows.filter((r) => needsCredit(r) && creditAmountError(r.amount, creditOf(r))) : [];
  const finalRows = d?.verb === 'approve' ? d.rows.filter(needsCredit) : [];

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Transactions waiting for your review. Approve or reject from the table, tick several rows for a bulk action, or open a transaction to see its documents."
      />
      <TransactionFilters state={state} update={update} reset={reset} />
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}

      {selected.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, position: 'sticky', top: 64, zIndex: 2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
            <Typography sx={{ flexGrow: 1 }}>
              <b>{selected.length}</b> selected · deposits {formatMoney(selectedTotal, currency)}
            </Typography>
            <Button
              variant="contained"
              color="success"
              startIcon={<CheckIcon />}
              disabled={!approvable.length || run.isPending}
              onClick={() => setPending({ verb: 'approve', rows: approvable })}
            >
              Approve {approvable.length}
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<CloseIcon />}
              disabled={!rejectable.length || run.isPending}
              onClick={() => setPending({ verb: 'reject', rows: rejectable })}
            >
              Reject {rejectable.length}
            </Button>
            <Button color="inherit" onClick={() => setSelected([])}>
              Clear
            </Button>
          </Stack>
        </Paper>
      )}

      <ServerGrid
        rows={rows}
        columns={columns}
        total={q.data?.total ?? 0}
        loading={q.isFetching}
        page={Number(state.page)}
        limit={Number(state.limit)}
        sort={state.sort}
        onChange={(p) => {
          // The grid may re-report the current model while rendering; only real paging/sorting changes count.
          const changed = Object.entries(p).some(([k, v]) => (v === undefined ? state[k] !== undefined : String(v) !== state[k]));
          if (!changed) return;
          setSelected([]);
          update(p as Record<string, string | number | undefined>, false);
        }}
        onRowClick={(row) => navigate(`/approvals/${row.id}`)}
        hiddenColumns={['line', 'branch', 'bankDetails', 'paymentReference', 'salesType']}
        selection={selection}
        noRowsLabel="Nothing is waiting for your review"
      />

      {d && (
        <ConfirmDialog
          open
          title={
            d.rows.length === 1
              ? `${d.verb === 'approve' ? 'Approve' : 'Reject'} ${d.rows[0]!.transactionNumber}?`
              : `${d.verb === 'approve' ? 'Approve' : 'Reject'} ${d.rows.length} transactions?`
          }
          message={
            <Stack spacing={1}>
              <Typography>
                {d.verb === 'approve'
                  ? 'Please confirm you have reviewed the transaction(s) and their supporting documents.'
                  : 'Rejection is final – the transaction(s) cannot be resubmitted. The same reason is recorded for each.'}
              </Typography>
              <Typography fontWeight={600}>
                {d.rows.length === 1
                  ? `${d.rows[0]!.party?.name ?? '—'} · ${formatMoney(d.rows[0]!.amount, currency)}`
                  : `${d.rows.length} transactions · deposits ${formatMoney(total, currency)}`}
              </Typography>
              {finalRows.length > 0 && missingCredit.length === 0 && (
                <Typography variant="body2">
                  Final approval with Amount (CR) — bank charges{' '}
                  {formatMoney(
                    fromCents(finalRows.reduce((sum, r) => sum + toCents(chargeFor(r.amount, creditOf(r)) ?? '0'), 0n)),
                    currency,
                  )}
                  .
                </Typography>
              )}
              {missingCredit.length > 0 && (
                <Alert severity="warning">
                  {missingCredit.length} transaction(s) have no valid Amount (CR) and will not be approved:{' '}
                  {missingCredit.map((r) => r.transactionNumber).join(', ')}.
                </Alert>
              )}
              {d.verb === 'approve' && d.rows.some((r) => r.attachmentCount === 0) && (
                <Alert severity="warning">Some selected transactions have no supporting document.</Alert>
              )}
            </Stack>
          }
          confirmLabel={d.verb === 'approve' ? 'Approve' : 'Reject'}
          confirmColor={d.verb === 'approve' ? 'success' : 'error'}
          input={d.verb === 'approve' ? 'comment' : 'reason'}
          category={d.verb === 'reject' ? 'optional' : 'none'}
          busy={run.isPending}
          onClose={() => setPending(null)}
          onConfirm={(r) => run.mutate({ verb: d.verb, rows: d.rows, r })}
        />
      )}

      <BulkResultsDialog result={results?.result ?? null} rows={results?.rows ?? []} currency={currency} onClose={() => setResults(null)} />
    </>
  );
}

function BulkResultsDialog({
  result,
  rows,
  currency,
  onClose,
}: {
  result: BulkActionResult | null;
  rows: TransactionListItem[];
  currency: string;
  onClose(): void;
}) {
  if (!result) return null;
  const amountOf = (id: string) => rows.find((r) => r.id === id)?.amount ?? null;
  const sorted = [...result.results].sort((a, b) => Number(a.ok) - Number(b.ok));
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        {result.succeeded} done{result.failed ? `, ${result.failed} not processed` : ''}
      </DialogTitle>
      <DialogContent>
        {result.failed > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Transactions that were not processed are unchanged. Fix the reason shown and try again.
          </Alert>
        )}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Transaction</TableCell>
              <TableCell align="right">Deposit</TableCell>
              <TableCell>Result</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.transactionNumber ?? r.id.slice(0, 8)}</TableCell>
                <TableCell align="right">{formatMoney(amountOf(r.id), currency)}</TableCell>
                <TableCell>
                  {r.ok ? (
                    <Chip size="small" color="success" variant="outlined" label={r.status ? TRANSACTION_STATUS_LABELS[r.status] : 'Done'} />
                  ) : (
                    <Typography variant="body2" color="error">
                      {r.error?.message}
                    </Typography>
                  )}
                  {r.warnings.length > 0 && (
                    <Typography variant="caption" color="warning.main" component="div">
                      {r.warnings.join('; ')}
                    </Typography>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
