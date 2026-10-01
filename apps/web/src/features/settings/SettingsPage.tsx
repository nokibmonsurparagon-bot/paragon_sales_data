import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { REVIEWER_EDITABLE_FIELDS, TRANSACTION_FIELD_LABELS, type SystemSettingDto } from '@paragon/shared';
import { api } from '../../api/endpoints';
import { ErrorState, Loading } from '../../components/Feedback';
import { useNotifier } from '../../components/Notifier';
import { PageHeader } from '../../components/PageHeader';
import { useAuth } from '../../store/auth';
import { formatDateTime } from '../../utils/format';

function SettingRow({ s, canEdit }: { s: SystemSettingDto; canEdit: boolean }) {
  const qc = useQueryClient();
  const { notify, notifyError } = useNotifier();
  const [value, setValue] = useState<unknown>(s.value);
  useEffect(() => setValue(s.value), [s.value]);
  const changed = JSON.stringify(value) !== JSON.stringify(s.value);
  const save = useMutation({
    mutationFn: () => api.settings.update(s.key, value),
    onSuccess: () => {
      notify('Setting saved');
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['client-config'] });
    },
    onError: notifyError,
  });

  let editor;
  if (typeof s.value === 'boolean') {
    editor = <Switch checked={Boolean(value)} disabled={!canEdit} onChange={(e) => setValue(e.target.checked)} inputProps={{ 'aria-label': s.key }} />;
  } else if (typeof s.value === 'number') {
    editor = <TextField type="number" value={String(value)} disabled={!canEdit} onChange={(e) => setValue(Number(e.target.value))} sx={{ maxWidth: 200 }} aria-label={s.key} />;
  } else if (Array.isArray(s.value)) {
    const arr = value as string[];
    editor = (
      <TextField
        select
        value={arr}
        disabled={!canEdit}
        aria-label={s.key}
        slotProps={{ select: { multiple: true, renderValue: (v) => (v as string[]).map((f) => TRANSACTION_FIELD_LABELS[f as keyof typeof TRANSACTION_FIELD_LABELS] ?? f).join(', ') } }}
        onChange={(e) => setValue(e.target.value as unknown as string[])}
      >
        {REVIEWER_EDITABLE_FIELDS.map((f) => (
          <MenuItem key={f} value={f}>
            <Checkbox size="small" checked={arr.includes(f)} />
            <ListItemText primary={TRANSACTION_FIELD_LABELS[f]} />
          </MenuItem>
        ))}
      </TextField>
    );
  } else {
    editor = <TextField value={String(value ?? '')} disabled={!canEdit} onChange={(e) => setValue(e.target.value)} sx={{ maxWidth: 320 }} aria-label={s.key} />;
  }

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ p: 2, alignItems: { md: 'center' } }}>
      <Stack sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontWeight={600}>{s.description}</Typography>
        <Typography variant="caption" color="text.secondary">
          {s.key} · updated {formatDateTime(s.updatedAt)}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: 1 }}>
        {editor}
        {canEdit && changed && (
          <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

export default function SettingsPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['settings'], queryFn: api.settings.list });
  return (
    <>
      <PageHeader title="System settings" subtitle="Values are validated by the server; every change is audited." />
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} />}
      <Card>
        {q.data?.map((s, i) => (
          <div key={s.key}>
            {i > 0 && <Divider />}
            <SettingRow s={s} canEdit={can('SYSTEM_SETTINGS_UPDATE')} />
          </div>
        ))}
      </Card>
    </>
  );
}
