import { useState, type ReactNode } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import UndoIcon from '@mui/icons-material/Undo';
import SendIcon from '@mui/icons-material/Send';
import BackHandIcon from '@mui/icons-material/BackHand';
import PanToolAltIcon from '@mui/icons-material/PanToolAlt';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import DoNotDisturbOnIcon from '@mui/icons-material/DoNotDisturbOn';
import {
  CORRECTION_CATEGORY_LABELS,
  type Permission,
  type TransactionDetail,
  type UserRef,
} from '@paragon/shared';
import { api, type ReviewVerb } from '../../api/endpoints';
import { ConfirmDialog, type ConfirmResult } from '../../components/ConfirmDialog';
import { CreditAmountField, creditAmountError } from '../../components/CreditAmountField';
import { ErrorState, Loading } from '../../components/Feedback';
import { useNotifier } from '../../components/Notifier';
import { PageHeader } from '../../components/PageHeader';
import { UserPicker } from '../../components/Pickers';
import { DuplicateBadge, StatusBadge } from '../../components/StatusBadge';
import { Timeline } from '../../components/Timeline';
import { useCurrency } from '../../hooks';
import { formatDate, formatDateTime, formatMoney, humanize } from '../../utils/format';
import { AttachmentsPanel } from './AttachmentsPanel';

type DialogKind = ReviewVerb | null;

const DIALOGS: Record<ReviewVerb, { title: string; confirm: string; color: 'primary' | 'success' | 'error' | 'warning'; input: 'comment' | 'reason'; category: 'none' | 'optional' | 'required'; message: string }> = {
  submit: { title: 'Submit for review?', confirm: 'Submit', color: 'primary', input: 'comment', category: 'none', message: 'The transaction will be sent to Sales Admin.' },
  resubmit: { title: 'Resubmit for review?', confirm: 'Resubmit', color: 'primary', input: 'comment', category: 'none', message: 'The corrected transaction will go through Sales Admin review again.' },
  approve: { title: 'Approve transaction?', confirm: 'Approve', color: 'success', input: 'comment', category: 'none', message: 'Please confirm you have reviewed the transaction and its supporting documents.' },
  return: { title: 'Return for correction', confirm: 'Return', color: 'warning', input: 'reason', category: 'required', message: 'The field force user will be asked to correct and resubmit.' },
  reject: { title: 'Reject transaction', confirm: 'Reject', color: 'error', input: 'reason', category: 'optional', message: 'Rejection is final – the transaction cannot be resubmitted.' },
  cancel: { title: 'Cancel transaction?', confirm: 'Cancel transaction', color: 'error', input: 'comment', category: 'none', message: 'The transaction will be closed and cannot be reopened.' },
};

const ref = (r: { code: string; name: string } | null) => (r ? `${r.name} (${r.code})` : null);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography component="div" sx={{ overflowWrap: 'anywhere' }}>
        {children ?? '—'}
      </Typography>
    </Box>
  );
}

export default function TransactionDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const inApprovals = location.pathname.startsWith('/approvals');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { notify, notifyError } = useNotifier();
  const currency = useCurrency();

  const detail = useQuery({ queryKey: ['transaction', id], queryFn: () => api.transactions.get(id) });
  const history = useQuery({ queryKey: ['history', id], queryFn: () => api.transactions.history(id) });
  const t = detail.data;
  const dupes = useQuery({
    queryKey: ['duplicates', id],
    queryFn: () => api.transactions.duplicates(id),
    enabled: !!t && t.duplicateStatus !== 'NO_DUPLICATE',
  });

  const [dialog, setDialog] = useState<DialogKind>(null);
  const [credit, setCredit] = useState('');
  const [reassignOpen, setReassignOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);

  const refresh = (fresh?: TransactionDetail) => {
    if (fresh) qc.setQueryData(['transaction', id], fresh);
    void qc.invalidateQueries({ queryKey: ['transaction', id] });
    void qc.invalidateQueries({ queryKey: ['history', id] });
    void qc.invalidateQueries({ queryKey: ['transactions'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const workflow = useMutation({
    mutationFn: ({ verb, r }: { verb: ReviewVerb; r: ConfirmResult }) => {
      const body: Record<string, unknown> = { version: t!.version };
      if (verb === 'return' || verb === 'reject') {
        body.reason = r.text;
        if (r.category) body.correctionCategory = r.category;
      } else if (r.text) body.comment = r.text;
      if (verb === 'approve' && t!.status === 'FINANCE_REVIEW') body.creditAmount = credit.trim();
      return api.transactions.workflow(id, verb, body);
    },
    onSuccess: ({ data, message }) => {
      setDialog(null);
      refresh(data.transaction);
      notify(message ?? 'Done');
      if (data.warnings.length) notify(data.warnings.join('; '), 'warning');
      if (inApprovals && !data.transaction.allowedActions.length) navigate('/approvals');
    },
    onError: (e) => {
      setDialog(null);
      notifyError(e);
      refresh();
    },
  });

  const assign = useMutation({
    mutationFn: ({ verb, userId }: { verb: 'claim' | 'release' | 'reassign'; userId?: string }) =>
      api.transactions.assign(id, verb, { version: t!.version, ...(userId ? { userId } : {}) }),
    onSuccess: ({ data, message }) => {
      setReassignOpen(false);
      refresh(data);
      notify(message ?? 'Updated');
    },
    onError: (e) => {
      notifyError(e);
      refresh();
    },
  });

  if (detail.isLoading) return <Loading />;
  if (detail.error || !t) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;

  const has = (a: string) => t.allowedActions.includes(a as never);
  const reviewVerbs: [ReviewVerb, string, ReactNode][] = [];
  if (has('SA_APPROVE') || has('FIN_APPROVE')) reviewVerbs.push(['approve', 'Approve', <CheckIcon key="i" />]);
  if (has('SA_RETURN') || has('FIN_RETURN')) reviewVerbs.push(['return', 'Return for correction', <UndoIcon key="i" />]);
  if (has('SA_REJECT') || has('FIN_REJECT')) reviewVerbs.push(['reject', 'Reject', <CloseIcon key="i" />]);
  const busy = workflow.isPending || assign.isPending;
  const d = dialog ? DIALOGS[dialog] : null;
  const reviewerPermission: Permission = t.status === 'FINANCE_REVIEW' ? 'FINANCE_REVIEW' : 'SALES_ADMIN_REVIEW';
  // The final approval records Amount (CR); the bank charge is derived from it.
  const needsCredit = dialog === 'approve' && t.status === 'FINANCE_REVIEW';
  const openDialog = (verb: ReviewVerb) => {
    setCredit(t.creditAmount ?? '');
    setDialog(verb);
  };

  return (
    <>
      <PageHeader
        title={t.transactionNumber}
        lastCrumb={t.transactionNumber}
        subtitle={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <StatusBadge status={t.status} size="medium" />
            <DuplicateBadge status={t.duplicateStatus} />
            {t.assignedRole && <Chip size="small" variant="outlined" label={`With: ${t.assignedRole.name}`} />}
            {t.assignedUser && <Chip size="small" color="primary" variant="outlined" label={`Claimed by ${t.assignedUser.fullName}`} />}
          </Stack>
        }
        actions={
          <>
            {has('EDIT') && (
              <Button startIcon={<EditIcon />} component={RouterLink} to={`/transactions/${t.id}/edit`} variant="outlined">
                Edit
              </Button>
            )}
            {has('SUBMIT') && (
              <Button variant="contained" startIcon={<SendIcon />} onClick={() => setDialog('submit')} disabled={busy}>
                Submit
              </Button>
            )}
            {has('RESUBMIT') && (
              <Button variant="contained" startIcon={<SendIcon />} onClick={() => setDialog('resubmit')} disabled={busy}>
                Resubmit
              </Button>
            )}
            {has('CLAIM') && (
              <Button startIcon={<PanToolAltIcon />} onClick={() => assign.mutate({ verb: 'claim' })} disabled={busy}>
                Claim
              </Button>
            )}
            {has('RELEASE') && (
              <Button startIcon={<BackHandIcon />} onClick={() => assign.mutate({ verb: 'release' })} disabled={busy}>
                Release
              </Button>
            )}
            {has('REASSIGN') && (
              <Button startIcon={<SwapHorizIcon />} onClick={() => setReassignOpen(true)} disabled={busy}>
                Reassign
              </Button>
            )}
            {reviewVerbs.map(([verb, label, icon]) => (
              <Button
                key={verb}
                startIcon={icon}
                variant={verb === 'approve' ? 'contained' : 'outlined'}
                color={verb === 'approve' ? 'success' : verb === 'return' ? 'warning' : 'error'}
                onClick={() => openDialog(verb)}
                disabled={busy}
              >
                {label}
              </Button>
            ))}
            {has('CANCEL') && (
              <Button color="inherit" startIcon={<DoNotDisturbOnIcon />} onClick={() => setDialog('cancel')} disabled={busy}>
                Cancel
              </Button>
            )}
          </>
        }
      />

      {t.status === 'CORRECTION_REQUIRED' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>Correction required{t.correctionCategory ? ` – ${CORRECTION_CATEGORY_LABELS[t.correctionCategory]}` : ''}</AlertTitle>
          {t.rejectionReason}
        </Alert>
      )}
      {t.status === 'REJECTED' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <AlertTitle>Rejected</AlertTitle>
          {t.rejectionReason}
        </Alert>
      )}
      {t.status === 'READY_FOR_PROCESSING' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          All approvals complete on {formatDateTime(t.finalApprovedAt)}. The transaction is ready for processing by downstream systems.
        </Alert>
      )}
      {t.duplicateStatus !== 'NO_DUPLICATE' && (
        <Alert
          severity={t.duplicateResolution === 'NOT_DUPLICATE' ? 'info' : t.duplicateStatus === 'EXACT_DUPLICATE' ? 'error' : 'warning'}
          sx={{ mb: 2 }}
          action={
            has('RESOLVE_DUPLICATE') ? (
              <Button color="inherit" onClick={() => setResolveOpen(true)}>
                Resolve
              </Button>
            ) : undefined
          }
        >
          <AlertTitle>
            {t.duplicateStatus === 'EXACT_DUPLICATE' ? 'Exact duplicate' : 'Possible duplicate'}
            {t.duplicateOf && (
              <>
                {' '}
                of{' '}
                <Link component={RouterLink} to={`/transactions/${t.duplicateOf.id}`} color="inherit">
                  {t.duplicateOf.transactionNumber}
                </Link>
              </>
            )}
            {t.duplicateResolution && t.duplicateResolution !== 'PENDING' && ` – resolved: ${humanize(t.duplicateResolution)}`}
          </AlertTitle>
          {t.duplicateResolution === 'PENDING'
            ? t.duplicateStatus === 'EXACT_DUPLICATE'
              ? 'Approval is blocked until an authorised user confirms whether this is a duplicate.'
              : 'Please check the matching transactions before approving.'
            : t.duplicateResolutionNote}
          {dupes.data && dupes.data.length > 0 && (
            <Box sx={{ overflowX: 'auto', mt: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Number</TableCell>
                    <TableCell>Match</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Farmer / Customer</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell>Matched on</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dupes.data.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.transactionNumber}</TableCell>
                      <TableCell>{humanize(c.classification)}</TableCell>
                      <TableCell>{formatDate(c.transactionDate)}</TableCell>
                      <TableCell>{c.party?.name ?? '—'}</TableCell>
                      <TableCell align="right">{formatMoney(c.amount, currency)}</TableCell>
                      <TableCell>{c.matchedOn.join(', ')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Alert>
      )}
      {t.latestComment && !['CORRECTION_REQUIRED', 'REJECTED'].includes(t.status) && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <b>Latest comment:</b> {t.latestComment}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card sx={{ mb: 2 }}>
            <CardHeader title="Details" titleTypographyProps={{ variant: 'h6' }} />
            <CardContent>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Wing">{`${t.wing.name} (${t.wing.code})`}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Transaction date">{formatDate(t.transactionDate)}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Field Force">{t.fieldForce.fullName}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Line name">{ref(t.line)}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Branch code">{ref(t.branch)}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="CV code">{t.party?.code}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Farmer / Customer">{t.party?.name}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Deposit amount">
                    <Typography fontSize={20} fontWeight={650} component="span">
                      {formatMoney(t.amount, currency)}
                    </Typography>
                  </Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 3 }}>
                  <Field label="Amount (CR)">{t.creditAmount ? formatMoney(t.creditAmount, currency) : null}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 3 }}>
                  <Field label="Bank charge">{t.bankCharge ? formatMoney(t.bankCharge, currency) : null}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Bank">{t.bank?.name}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Account">{t.account ? `${t.account.name} (${t.account.code})` : null}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Bank branch / bank details">{t.bankDetails}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Payment reference">{t.paymentReference}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Sales type">{t.salesType?.name}</Field>
                </Grid>
                <Grid size={12}>
                  <Field label="Narration">
                    <span style={{ whiteSpace: 'pre-wrap' }}>{t.remarks ?? '—'}</span>
                  </Field>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
          <Card sx={{ mb: 2 }}>
            <CardHeader title="Supporting documents" titleTypographyProps={{ variant: 'h6' }} />
            <CardContent>
              <AttachmentsPanel transactionId={t.id} attachments={t.attachments} canEdit={has('UPLOAD_ATTACHMENT')} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Record" titleTypographyProps={{ variant: 'h6' }} />
            <CardContent>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Created">{`${formatDateTime(t.createdAt)} by ${t.createdBy.fullName}`}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Last updated">{`${formatDateTime(t.updatedAt)}${t.updatedBy ? ` by ${t.updatedBy.fullName}` : ''}`}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Submitted">{formatDateTime(t.submittedAt)}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Final approval">{formatDateTime(t.finalApprovedAt)}</Field>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Field label="Version">{t.version}</Field>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card>
            <CardHeader title="History" titleTypographyProps={{ variant: 'h6' }} />
            <CardContent>
              {history.isLoading && <Loading />}
              {history.error && <ErrorState error={history.error} />}
              {history.data && <Timeline entries={history.data} />}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {d && (
        <ConfirmDialog
          open
          title={d.title}
          message={
            <>
              {d.message}
              <Typography fontWeight={600} sx={{ mt: 1 }}>
                {t.transactionNumber} · {t.party?.name} · {formatMoney(t.amount, currency)}
              </Typography>
            </>
          }
          confirmLabel={d.confirm}
          confirmColor={d.color}
          input={d.input}
          category={d.category}
          extra={
            needsCredit
              ? (touched) => <CreditAmountField deposit={t.amount} value={credit} onChange={setCredit} currency={currency} showError={touched} />
              : undefined
          }
          extraError={needsCredit ? creditAmountError(t.amount, credit) : null}
          busy={workflow.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(r) => workflow.mutate({ verb: dialog!, r })}
        />
      )}
      <ReassignDialog
        open={reassignOpen}
        permission={reviewerPermission}
        wingId={t.wing.id}
        busy={assign.isPending}
        onClose={() => setReassignOpen(false)}
        onConfirm={(u) => assign.mutate({ verb: 'reassign', userId: u.id })}
      />
      <ResolveDuplicateDialog open={resolveOpen} transaction={t} onClose={() => setResolveOpen(false)} onDone={(fresh) => refresh(fresh)} />
    </>
  );
}

function ReassignDialog({
  open,
  permission,
  wingId,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  permission: Permission;
  wingId: string;
  busy: boolean;
  onClose(): void;
  onConfirm(u: UserRef): void;
}) {
  const [user, setUser] = useState<UserRef | null>(null);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Reassign reviewer</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <UserPicker label="Reviewer" permission={permission} wingId={wingId} value={user} onChange={setUser} />
          <Typography variant="caption" color="text.secondary">
            Only reviewers of this wing are listed; the server verifies eligibility for this stage.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Back</Button>
        <Button variant="contained" disabled={!user || busy} onClick={() => user && onConfirm(user)}>
          Reassign
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ResolveDuplicateDialog({ open, transaction, onClose, onDone }: { open: boolean; transaction: TransactionDetail; onClose(): void; onDone(t: TransactionDetail): void }) {
  const [resolution, setResolution] = useState<'NOT_DUPLICATE' | 'CONFIRMED_DUPLICATE'>('NOT_DUPLICATE');
  const [note, setNote] = useState('');
  const { notify, notifyError } = useNotifier();
  const m = useMutation({
    mutationFn: () => api.transactions.resolveDuplicate(transaction.id, { version: transaction.version, resolution, note }),
    onSuccess: ({ data, message }) => {
      notify(message ?? 'Resolved');
      onDone(data);
      onClose();
      setNote('');
    },
    onError: notifyError,
  });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Resolve duplicate warning</DialogTitle>
      <DialogContent>
        <RadioGroup value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)}>
          <FormControlLabel value="NOT_DUPLICATE" control={<Radio />} label="Not a duplicate – allow approval" />
          <FormControlLabel value="CONFIRMED_DUPLICATE" control={<Radio />} label="Confirmed duplicate – block approval (then reject it)" />
        </RadioGroup>
        <TextField
          label="Justification"
          required
          multiline
          minRows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          helperText="Recorded in the audit trail (at least 5 characters)"
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Back</Button>
        <Button variant="contained" disabled={note.trim().length < 5 || m.isPending} onClick={() => m.mutate()}>
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
}
