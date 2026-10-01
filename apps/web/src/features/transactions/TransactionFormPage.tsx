import { useEffect, useMemo, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import SaveIcon from '@mui/icons-material/Save';
import SendIcon from '@mui/icons-material/Send';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import {
  TRANSACTION_EDITABLE_FIELDS,
  transactionDraftSchema,
  transactionSubmitSchema,
  type TransactionDetail,
  type TransactionEditableField,
  type UserRef,
} from '@paragon/shared';
import { ApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, Loading } from '../../components/Feedback';
import { errorText, useNotifier } from '../../components/Notifier';
import { PageHeader } from '../../components/PageHeader';
import { MasterPicker, MasterSelect, PartyPicker, UserPicker, WingSelect } from '../../components/Pickers';
import { StatusBadge } from '../../components/StatusBadge';
import { useClientConfig, useCurrency } from '../../hooks';
import { useAuth } from '../../store/auth';
import { formatBytes } from '../../utils/format';
import { AttachmentsPanel, FilePickerButton, checkFile } from './AttachmentsPanel';

type Picked = { id: string; code?: string; name: string } | null;

interface FormValues {
  wingId: string;
  transactionDate: string;
  fieldForce: UserRef | null;
  line: Picked;
  branch: Picked;
  cvCode: Picked;
  party: Picked;
  amount: string;
  bankId: string;
  accountId: string;
  bankDetails: string;
  paymentReference: string;
  salesTypeId: string;
  remarks: string;
}

/** API field ↔ form field. */
const FORM_FIELD: Record<TransactionEditableField, keyof FormValues> = {
  wingId: 'wingId',
  transactionDate: 'transactionDate',
  fieldForceUserId: 'fieldForce',
  lineId: 'line',
  branchId: 'branch',
  cvCodeId: 'cvCode',
  partyId: 'party',
  amount: 'amount',
  bankId: 'bankId',
  accountId: 'accountId',
  bankDetails: 'bankDetails',
  paymentReference: 'paymentReference',
  salesTypeId: 'salesTypeId',
  remarks: 'remarks',
};
const API_FIELD = Object.fromEntries(Object.entries(FORM_FIELD).map(([a, f]) => [f, a])) as Record<string, TransactionEditableField>;

function toPayload(v: FormValues): Record<TransactionEditableField, string | null> {
  const s = (x: string) => (x.trim() === '' ? null : x.trim());
  return {
    wingId: s(v.wingId),
    transactionDate: s(v.transactionDate),
    fieldForceUserId: v.fieldForce?.id ?? null,
    lineId: v.line?.id ?? null,
    branchId: v.branch?.id ?? null,
    cvCodeId: v.cvCode?.id ?? null,
    partyId: v.party?.id ?? null,
    amount: s(v.amount),
    bankId: s(v.bankId),
    accountId: s(v.accountId),
    bankDetails: s(v.bankDetails),
    paymentReference: s(v.paymentReference),
    salesTypeId: s(v.salesTypeId),
    remarks: s(v.remarks),
  };
}

function fromDetail(t: TransactionDetail | undefined, me: UserRef | null, defaultWingId = ''): FormValues {
  return {
    wingId: t?.wing.id ?? defaultWingId,
    transactionDate: t?.transactionDate ?? dayjs().format('YYYY-MM-DD'),
    fieldForce: t ? t.fieldForce : me,
    line: t?.line ?? null,
    branch: t?.branch ?? null,
    cvCode: t?.cvCode ?? null,
    party: t?.party ?? null,
    amount: t?.amount ?? '',
    bankId: t?.bank?.id ?? '',
    accountId: t?.account?.id ?? '',
    bankDetails: t?.bankDetails ?? '',
    paymentReference: t?.paymentReference ?? '',
    salesTypeId: t?.salesType?.id ?? '',
    remarks: t?.remarks ?? '',
  };
}

/** Live (format-only) validation; completeness is checked when submitting. */
const draftResolver: Resolver<FormValues> = async (values) => {
  const payload = toPayload(values);
  delete (payload as Partial<typeof payload>).fieldForceUserId;
  const r = transactionDraftSchema.safeParse(payload);
  const errors: Record<string, { type: string; message: string }> = {};
  // Even a draft needs a wing – it decides who reviews the transaction.
  if (!values.wingId) errors.wingId = { type: 'required', message: 'Wing is required' };
  for (const i of r.error?.issues ?? []) {
    const f = FORM_FIELD[i.path[0] as TransactionEditableField];
    if (f && !errors[f]) errors[f] = { type: i.code, message: i.message };
  }
  return Object.keys(errors).length ? { values: {}, errors } : { values, errors: {} };
};

const REQUIRED: TransactionEditableField[] = [
  'wingId',
  'transactionDate',
  'lineId',
  'branchId',
  'cvCodeId',
  'partyId',
  'amount',
  'bankId',
  'accountId',
  'bankDetails',
  'paymentReference',
  'salesTypeId',
];

export default function TransactionFormPage() {
  const { id } = useParams();
  const isNew = !id;
  const { user, can } = useAuth();
  const me: UserRef | null = user ? { id: user.id, fullName: user.fullName, email: user.email } : null;
  const myWings = user?.wings ?? [];
  // A user working on a single wing never has to pick it.
  const defaultWingId = myWings.length === 1 ? myWings[0]!.id : '';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { notify } = useNotifier();
  const currency = useCurrency();
  const cfg = useClientConfig().data;

  const detail = useQuery({ queryKey: ['transaction', id], queryFn: () => api.transactions.get(id!), enabled: !isNew });
  const t = detail.data;

  const form = useForm<FormValues>({ resolver: draftResolver, mode: 'onTouched', defaultValues: fromDetail(undefined, me, defaultWingId) });
  const { control, handleSubmit, reset, setError, watch, setValue, formState } = form;
  useEffect(() => {
    if (t) reset(fromDetail(t, me));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, reset]);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ severity: 'error' | 'warning'; text: string; conflict?: boolean } | null>(null);

  const editable = useMemo<Set<TransactionEditableField>>(() => {
    if (isNew) {
      const all = Object.keys(FORM_FIELD) as TransactionEditableField[];
      return new Set(can('SALES_VIEW_ALL') ? all : all.filter((f) => f !== 'fieldForceUserId'));
    }
    return new Set(t?.editableFields ?? []);
  }, [isNew, t, can]);
  const dis = (f: TransactionEditableField) => !editable.has(f) || saving;

  const canSubmit = isNew ? can('SALES_SUBMIT') : !!t?.allowedActions.some((a) => a === 'SUBMIT' || a === 'RESUBMIT');
  const submitVerb = t?.status === 'CORRECTION_REQUIRED' ? 'resubmit' : 'submit';
  const bankId = watch('bankId');
  const dirty = formState.isDirty || pendingFiles.length > 0;

  // ---- unsaved-changes protection ----
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !saving && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  function applyServerErrors(err: unknown) {
    if (err instanceof ApiError) {
      let mapped = false;
      for (const d of err.details) {
        const f = d.path ? FORM_FIELD[d.path as TransactionEditableField] : undefined;
        if (f) {
          setError(f, { type: 'server', message: d.message });
          mapped = true;
        }
      }
      if (err.status === 409) {
        setBanner({ severity: 'error', text: 'This transaction was changed by someone else. Reload to see the latest version – your edits were not saved.', conflict: true });
        return;
      }
      setBanner({ severity: 'error', text: mapped && err.code === 'VALIDATION_ERROR' ? 'Please correct the highlighted fields.' : errorText(err) });
      return;
    }
    setBanner({ severity: 'error', text: errorText(err) });
  }

  /** Persists the form. Returns the saved transaction. */
  async function save(values: FormValues): Promise<TransactionDetail> {
    const payload = toPayload(values);
    if (isNew) {
      if (!editable.has('fieldForceUserId')) delete (payload as Partial<typeof payload>).fieldForceUserId;
      const { data } = await api.transactions.create(payload);
      for (const f of pendingFiles) await api.transactions.upload(data.id, f);
      setPendingFiles([]);
      return pendingFiles.length ? api.transactions.get(data.id) : data;
    }
    // Only changed, editable fields + version (optimistic locking).
    const dirtyKeys = Object.keys(formState.dirtyFields).map((k) => API_FIELD[k]).filter((k): k is TransactionEditableField => !!k && editable.has(k));
    if (!dirtyKeys.length) return t!;
    const body: Record<string, unknown> = { version: t!.version };
    for (const k of dirtyKeys) body[k] = payload[k];
    const { data } = await api.transactions.update(t!.id, body);
    return data;
  }

  const onSaveDraft = handleSubmit(async (values) => {
    setBanner(null);
    setSaving(true);
    try {
      const saved = await save(values);
      reset(fromDetail(saved, me));
      await qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.setQueryData(['transaction', saved.id], saved);
      notify(isNew ? `Draft ${saved.transactionNumber} saved` : 'Changes saved');
      if (saved.warnings.length) notify(saved.warnings.join('; '), 'warning');
      navigate(`/transactions/${saved.id}`, { replace: isNew });
    } catch (e) {
      applyServerErrors(e);
    } finally {
      setSaving(false);
    }
  });

  const onRequestSubmit = handleSubmit((values) => {
    setBanner(null);
    const payload = { ...toPayload(values), fieldForceUserId: values.fieldForce?.id ?? me?.id ?? null };
    const r = transactionSubmitSchema.safeParse(payload);
    if (!r.success) {
      for (const i of r.error.issues) {
        const f = FORM_FIELD[i.path[0] as TransactionEditableField];
        if (f) setError(f, { type: 'required', message: i.message });
      }
      setBanner({ severity: 'error', text: 'Complete all required fields before submitting.' });
      return;
    }
    const docs = (t?.attachments.length ?? 0) + pendingFiles.length;
    if (docs === 0) {
      setBanner({ severity: 'warning', text: 'Attach at least one supporting document before submitting.' });
      return;
    }
    setConfirmSubmit(true);
  });

  async function doSubmit() {
    setSaving(true);
    try {
      const saved = await save(form.getValues());
      const { data, message } = await api.transactions.workflow(saved.id, submitVerb, { version: saved.version });
      reset(fromDetail(data.transaction, me));
      await qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.setQueryData(['transaction', saved.id], data.transaction);
      notify(message ?? 'Submitted');
      if (data.warnings.length) notify(data.warnings.join('; '), 'warning');
      setConfirmSubmit(false);
      navigate(`/transactions/${saved.id}`, { replace: true });
    } catch (e) {
      setConfirmSubmit(false);
      applyServerErrors(e);
      if (isNew) void qc.invalidateQueries({ queryKey: ['transactions'] });
    } finally {
      setSaving(false);
    }
  }

  if (!isNew && detail.isLoading) return <Loading />;
  if (!isNew && detail.error) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!isNew && t && editable.size === 0) {
    return (
      <>
        <PageHeader title={t.transactionNumber} />
        <Alert severity="info" action={<Button onClick={() => navigate(`/transactions/${t.id}`)}>View</Button>}>
          This transaction cannot be edited by you in its current status.
        </Alert>
      </>
    );
  }

  const minDate = cfg ? dayjs().subtract(cfg.maxBackdateDays, 'day') : undefined;
  const maxDate = cfg && !cfg.allowFutureDate ? dayjs() : undefined;
  const req = (f: TransactionEditableField) => REQUIRED.includes(f);
  const err = (f: keyof FormValues) => formState.errors[f]?.message as string | undefined;

  return (
    <>
      <PageHeader
        title={isNew ? 'New sales transaction' : `Edit ${t?.transactionNumber}`}
        subtitle={
          isNew ? (
            'Fields marked * are required to submit. You can save an incomplete draft at any time.'
          ) : (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {t && <StatusBadge status={t.status} />}
              {t && t.editableFields.length < TRANSACTION_EDITABLE_FIELDS.length && <Chip size="small" variant="outlined" label="Only permitted fields are editable at this stage" />}
            </Stack>
          )
        }
      />
      {t?.status === 'CORRECTION_REQUIRED' && t.rejectionReason && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <b>Correction required:</b> {t.rejectionReason}
        </Alert>
      )}
      {banner && (
        <Alert
          severity={banner.severity}
          sx={{ mb: 2 }}
          action={
            banner.conflict ? (
              <Button
                color="inherit"
                onClick={() => {
                  setBanner(null);
                  void detail.refetch().then((r) => r.data && reset(fromDetail(r.data, me)));
                }}
              >
                Reload
              </Button>
            ) : undefined
          }
        >
          {banner.text}
        </Alert>
      )}

      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <Card>
          <CardHeader title="Transaction details" titleTypographyProps={{ variant: 'h6' }} />
          <CardContent>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 4 }}>
                <Controller
                  name="wingId"
                  control={control}
                  render={({ field }) => (
                    <WingSelect
                      label="Wing"
                      name={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      options={myWings}
                      current={t?.wing}
                      required={req('wingId')}
                      disabled={dis('wingId')}
                      error={!!err('wingId')}
                      helperText={err('wingId')}
                      inputRef={field.ref}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Controller
                  name="transactionDate"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      label="Transaction date"
                      value={field.value ? dayjs(field.value) : null}
                      onChange={(d) => field.onChange(d?.isValid() ? d.format('YYYY-MM-DD') : '')}
                      disabled={dis('transactionDate')}
                      minDate={minDate}
                      maxDate={maxDate}
                      format="DD/MM/YYYY"
                      slotProps={{
                        textField: {
                          size: 'small',
                          fullWidth: true,
                          required: req('transactionDate'),
                          error: !!err('transactionDate'),
                          helperText: err('transactionDate'),
                          onBlur: field.onBlur,
                        },
                      }}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                {editable.has('fieldForceUserId') ? (
                  <Controller
                    name="fieldForce"
                    control={control}
                    render={({ field }) => <UserPicker label="Field Force" permission="SALES_CREATE" value={field.value} onChange={field.onChange} disabled={saving} />}
                  />
                ) : (
                  <TextField label="Field Force" value={watch('fieldForce')?.fullName ?? ''} disabled slotProps={{ input: { readOnly: true } }} />
                )}
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Controller
                  name="line"
                  control={control}
                  render={({ field }) => (
                    <MasterPicker
                      entity="lines"
                      label="Line name"
                      value={field.value}
                      onChange={field.onChange}
                      required={req('lineId')}
                      disabled={dis('lineId')}
                      error={!!err('line')}
                      helperText={err('line')}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Controller
                  name="branch"
                  control={control}
                  render={({ field }) => (
                    <MasterPicker
                      entity="branches"
                      label="Branch code"
                      value={field.value}
                      onChange={field.onChange}
                      required={req('branchId')}
                      disabled={dis('branchId')}
                      error={!!err('branch')}
                      helperText={err('branch')}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Controller
                  name="cvCode"
                  control={control}
                  render={({ field }) => (
                    <MasterPicker
                      entity="cv-codes"
                      label="CV code"
                      value={field.value}
                      onChange={field.onChange}
                      required={req('cvCodeId')}
                      disabled={dis('cvCodeId')}
                      error={!!err('cvCode')}
                      helperText={err('cvCode')}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Controller
                  name="party"
                  control={control}
                  render={({ field }) => (
                    <PartyPicker
                      value={field.value}
                      onChange={field.onChange}
                      required={req('partyId')}
                      disabled={dis('partyId')}
                      error={!!err('party')}
                      helperText={err('party')}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Controller
                  name="amount"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      onChange={(e) => field.onChange(e.target.value.replace(/[^\d.]/g, ''))}
                      label="Deposit amount"
                      required={req('amount')}
                      disabled={dis('amount')}
                      error={!!err('amount')}
                      helperText={err('amount') ?? 'Up to 2 decimal places'}
                      slotProps={{
                        htmlInput: { inputMode: 'decimal', maxLength: 18 },
                        input: { startAdornment: <InputAdornment position="start">{currency}</InputAdornment> },
                      }}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Controller
                  name="bankId"
                  control={control}
                  render={({ field }) => (
                    <MasterSelect
                      entity="banks"
                      label="Bank"
                      name={field.name}
                      value={field.value}
                      onChange={(v) => {
                        field.onChange(v);
                        if (v !== bankId) setValue('accountId', '', { shouldDirty: true });
                      }}
                      current={t?.bank}
                      required={req('bankId')}
                      disabled={dis('bankId')}
                      error={!!err('bankId')}
                      helperText={err('bankId')}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Controller
                  name="accountId"
                  control={control}
                  render={({ field }) => (
                    <MasterSelect
                      entity="accounts"
                      label="Account"
                      name={field.name}
                      bankId={bankId}
                      value={field.value}
                      onChange={field.onChange}
                      current={t?.account && t.bank?.id === bankId ? t.account : null}
                      required={req('accountId')}
                      disabled={dis('accountId')}
                      error={!!err('accountId')}
                      helperText={err('accountId')}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Controller
                  name="bankDetails"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Bank branch / bank details"
                      required={req('bankDetails')}
                      disabled={dis('bankDetails')}
                      error={!!err('bankDetails')}
                      helperText={err('bankDetails') ?? 'Where the deposit came from, e.g. depositor’s bank and branch'}
                      slotProps={{ htmlInput: { maxLength: 300 } }}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Controller
                  name="paymentReference"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Payment reference"
                      required={req('paymentReference')}
                      disabled={dis('paymentReference')}
                      error={!!err('paymentReference')}
                      helperText={err('paymentReference') ?? 'Cheque / transfer / receipt number'}
                      slotProps={{ htmlInput: { maxLength: 100 } }}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Controller
                  name="salesTypeId"
                  control={control}
                  render={({ field }) => (
                    <MasterSelect
                      entity="sales-types"
                      label="Sales type"
                      name={field.name}
                      value={field.value}
                      onChange={field.onChange}
                      current={t?.salesType}
                      required={req('salesTypeId')}
                      disabled={dis('salesTypeId')}
                      error={!!err('salesTypeId')}
                      helperText={err('salesTypeId')}
                    />
                  )}
                />
              </Grid>
              <Grid size={12}>
                <Controller
                  name="remarks"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Narration"
                      multiline
                      minRows={3}
                      disabled={dis('remarks')}
                      error={!!err('remarks')}
                      helperText={err('remarks') ?? `${field.value.length}/2000`}
                      slotProps={{ htmlInput: { maxLength: 2000 } }}
                    />
                  )}
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        <Card sx={{ mt: 2 }}>
          <CardHeader title="Supporting documents" subheader="At least one document is required to submit" titleTypographyProps={{ variant: 'h6' }} />
          <CardContent>
            {isNew ? (
              <>
                <List dense disablePadding>
                  {pendingFiles.map((f, i) => (
                    <ListItem
                      key={`${f.name}-${i}`}
                      disableGutters
                      secondaryAction={
                        <IconButton aria-label={`Remove ${f.name}`} onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}>
                          <CloseIcon />
                        </IconButton>
                      }
                    >
                      <ListItemText primary={f.name} secondary={`${formatBytes(f.size)} · uploads when you save`} />
                    </ListItem>
                  ))}
                </List>
                <FilePickerButton
                  disabled={saving}
                  onFiles={(files) => {
                    const ok: File[] = [];
                    for (const f of files) {
                      const problem = checkFile(f, cfg?.maxUploadMb ?? 10, cfg?.allowedExtensions ?? ['pdf', 'jpg', 'png', 'xlsx']);
                      if (problem) notify(problem, 'error');
                      else ok.push(f);
                    }
                    setPendingFiles((p) => [...p, ...ok]);
                  }}
                />
              </>
            ) : (
              t && <AttachmentsPanel transactionId={t.id} attachments={t.attachments} canEdit={t.allowedActions.includes('UPLOAD_ATTACHMENT')} />
            )}
          </CardContent>
        </Card>

        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1} sx={{ mt: 2, justifyContent: 'flex-end' }}>
          <Button onClick={() => navigate(isNew ? '/transactions' : `/transactions/${id}`)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="outlined" startIcon={<SaveIcon />} onClick={() => void onSaveDraft()} disabled={saving}>
            {isNew || t?.status === 'DRAFT' ? 'Save draft' : 'Save changes'}
          </Button>
          {canSubmit && (
            <Button variant="contained" startIcon={<SendIcon />} onClick={() => void onRequestSubmit()} disabled={saving}>
              {submitVerb === 'resubmit' ? 'Save & resubmit' : 'Save & submit'}
            </Button>
          )}
        </Stack>
      </form>

      <ConfirmDialog
        open={confirmSubmit}
        title={submitVerb === 'resubmit' ? 'Resubmit transaction?' : 'Submit transaction for review?'}
        message={
          <>
            <Typography>
              The transaction will be sent to Sales Admin for review. You will not be able to edit it unless it is returned for correction.
            </Typography>
            <Typography sx={{ mt: 1 }} fontWeight={600}>
              {watch('party')?.name} · {currency} {watch('amount')} · {watch('paymentReference')}
            </Typography>
          </>
        }
        input="comment"
        confirmLabel={submitVerb === 'resubmit' ? 'Resubmit' : 'Submit'}
        busy={saving}
        onClose={() => setConfirmSubmit(false)}
        onConfirm={() => void doSubmit()}
      />

      <Dialog open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()}>
        <DialogTitle>Discard unsaved changes?</DialogTitle>
        <DialogContent>You have changes that have not been saved. Leaving this page will discard them.</DialogContent>
        <DialogActions>
          <Button onClick={() => blocker.reset?.()}>Stay</Button>
          <Button color="error" onClick={() => blocker.proceed?.()}>
            Discard & leave
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
