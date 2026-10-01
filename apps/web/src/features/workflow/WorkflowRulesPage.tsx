import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import {
  ATTACHMENTS_FIELD,
  BUSINESS_RULE_TYPES,
  RULE_SEVERITIES,
  RULE_TRIGGERS,
  TRANSACTION_EDITABLE_FIELDS,
  TRANSACTION_FIELD_LABELS,
  type BusinessRuleDto,
  type BusinessRuleType,
  type WorkflowRuleDto,
} from '@paragon/shared';
import { api } from '../../api/endpoints';
import { ErrorState } from '../../components/Feedback';
import { errorText, useNotifier } from '../../components/Notifier';
import { PageHeader } from '../../components/PageHeader';
import { MasterSelect, MultiPartyPicker, PartyPicker, loadPartyRefs } from '../../components/Pickers';
import { useMasterOptions, useUrlState } from '../../hooks';
import { useAuth } from '../../store/auth';
import { humanize } from '../../utils/format';

export default function WorkflowRulesPage() {
  const { state, update } = useUrlState();
  const tab = state.tab ?? 'routing';
  return (
    <>
      <PageHeader title="Workflow rules" subtitle="Configure finance routing and business rules. Every change is audited." />
      <Tabs value={tab} onChange={(_e, v: string) => update({ tab: v === 'routing' ? undefined : v })} sx={{ mb: 2 }}>
        <Tab value="routing" label="Finance routing" />
        <Tab value="business" label="Business rules" />
      </Tabs>
      {tab === 'routing' ? <RoutingRules /> : <BusinessRules />}
    </>
  );
}

// ---- Routing -----------------------------------------------------------------------------------

function useMasterNames(entity: 'sales-types' | 'wings') {
  const { data = [] } = useMasterOptions(entity);
  return new Map(data.map((s) => [s.id, s.name]));
}

function RoutingRules() {
  const { can } = useAuth();
  const rules = useQuery({ queryKey: ['workflow-rules'], queryFn: api.workflowRules.list });
  const [editing, setEditing] = useState<WorkflowRuleDto | 'new' | null>(null);
  const salesTypes = useMasterNames('sales-types');
  const wingNames = useMasterNames('wings');

  const describe = (r: WorkflowRuleDto) => {
    const c = r.conditions;
    const parts: string[] = [];
    if (c.wingIds?.length) parts.push(`wing ∈ {${c.wingIds.map((id) => wingNames.get(id) ?? '?').join(', ')}}`);
    if (c.isSpecial !== undefined) parts.push(c.isSpecial ? 'special sales type' : 'non-special sales type');
    if (c.salesTypeIds?.length) parts.push(`sales type ∈ {${c.salesTypeIds.map((id) => salesTypes.get(id) ?? '?').join(', ')}}`);
    if (c.partyIds?.length) parts.push(`${c.partyIds.length} selected part${c.partyIds.length > 1 ? 'ies' : 'y'}`);
    if (c.minAmount) parts.push(`amount ≥ ${c.minAmount}`);
    if (c.maxAmount) parts.push(`amount ≤ ${c.maxAmount}`);
    return parts.length ? parts.join(' AND ') : 'Any transaction (catch-all)';
  };

  const columns: GridColDef<WorkflowRuleDto>[] = [
    { field: 'priority', headerName: 'Priority', width: 90 },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
    { field: 'conditions', headerName: 'When', flex: 1.4, minWidth: 240, sortable: false, valueGetter: (_v, r) => describe(r) },
    { field: 'targetRole', headerName: 'Route to', width: 150, valueGetter: (_v, r) => r.targetRole.name },
    {
      field: 'isActive',
      headerName: 'Status',
      width: 110,
      renderCell: ({ row }) => <Chip size="small" variant="outlined" label={row.isActive ? 'Active' : 'Inactive'} color={row.isActive ? 'success' : 'default'} />,
    },
  ];

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, lg: 8 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Rules are evaluated by priority (lowest first); the first match decides the finance role.
          </Typography>
          {can('SYSTEM_SETTINGS_UPDATE') && (
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => setEditing('new')}>
              New rule
            </Button>
          )}
        </Stack>
        {rules.error && <ErrorState error={rules.error} />}
        <Paper variant="outlined">
          <DataGrid
            rows={rules.data ?? []}
            columns={columns}
            loading={rules.isLoading}
            autoHeight
            hideFooter
            onRowClick={(p) => can('SYSTEM_SETTINGS_UPDATE') && setEditing(p.row)}
          />
        </Paper>
      </Grid>
      <Grid size={{ xs: 12, lg: 4 }}>
        <Simulator />
      </Grid>
      <RoutingDialog item={editing} onClose={() => setEditing(null)} />
    </Grid>
  );
}

function Simulator() {
  const [wingId, setWingId] = useState('');
  const [salesTypeId, setSalesTypeId] = useState('');
  const [party, setParty] = useState<{ id: string; name: string } | null>(null);
  const [amount, setAmount] = useState('');
  const sim = useMutation({ mutationFn: () => api.workflowRules.simulate({ wingId: wingId || undefined, salesTypeId, partyId: party?.id, amount }) });
  return (
    <Card>
      <CardHeader title="Routing simulator" subheader="Check where a transaction would go" titleTypographyProps={{ variant: 'h6' }} />
      <CardContent>
        <Stack spacing={2}>
          <MasterSelect entity="wings" label="Wing" value={wingId} onChange={setWingId} />
          <MasterSelect entity="sales-types" label="Sales type" value={salesTypeId} onChange={setSalesTypeId} />
          <PartyPicker value={party} onChange={setParty} label="Farmer / customer (optional)" />
          <TextField label="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          <Button variant="outlined" disabled={!salesTypeId || !amount || sim.isPending} onClick={() => sim.mutate()}>
            Simulate
          </Button>
          {sim.data && (
            <Alert severity="success">
              Routed to <b>{sim.data.data.rule.targetRole.name}</b> by “{sim.data.data.rule.name}”
            </Alert>
          )}
          {sim.error && <Alert severity="error">{errorText(sim.error)}</Alert>}
        </Stack>
      </CardContent>
    </Card>
  );
}

function RoutingDialog({ item, onClose }: { item: WorkflowRuleDto | 'new' | null; onClose(): void }) {
  const qc = useQueryClient();
  const { notify } = useNotifier();
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles.list });
  const salesTypes = useMasterOptions('sales-types');
  const wings = useMasterOptions('wings');
  const isNew = item === 'new';
  const r = isNew ? null : item;
  const [v, setV] = useState({
    name: '',
    description: '',
    priority: '100',
    targetRoleId: '',
    isActive: true,
    wingIds: [] as string[],
    salesTypeIds: [] as string[],
    parties: [] as { id: string; name: string }[],
    minAmount: '',
    maxAmount: '',
    isSpecial: '' as '' | 'true' | 'false',
    effectiveFrom: '',
    effectiveTo: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setV({
      name: r?.name ?? '',
      description: r?.description ?? '',
      priority: String(r?.priority ?? 100),
      targetRoleId: r?.targetRole.id ?? '',
      isActive: r?.isActive ?? true,
      wingIds: r?.conditions.wingIds ?? [],
      salesTypeIds: r?.conditions.salesTypeIds ?? [],
      parties: (r?.conditions.partyIds ?? []).map((id) => ({ id, name: 'Loading…' })),
      minAmount: r?.conditions.minAmount ?? '',
      maxAmount: r?.conditions.maxAmount ?? '',
      isSpecial: r?.conditions.isSpecial === undefined ? '' : (String(r.conditions.isSpecial) as 'true' | 'false'),
      effectiveFrom: r?.effectiveFrom ?? '',
      effectiveTo: r?.effectiveTo ?? '',
    });
    const ids = r?.conditions.partyIds ?? [];
    if (ids.length) void loadPartyRefs(ids).then((parties) => setV((prev) => ({ ...prev, parties })));
  }, [item, r]);

  const save = useMutation({
    mutationFn: () => {
      const conditions: Record<string, unknown> = {};
      if (v.wingIds.length) conditions.wingIds = v.wingIds;
      if (v.salesTypeIds.length) conditions.salesTypeIds = v.salesTypeIds;
      if (v.parties.length) conditions.partyIds = v.parties.map((p) => p.id);
      if (v.minAmount) conditions.minAmount = v.minAmount;
      if (v.maxAmount) conditions.maxAmount = v.maxAmount;
      if (v.isSpecial) conditions.isSpecial = v.isSpecial === 'true';
      const body = {
        name: v.name,
        description: v.description || null,
        priority: Number(v.priority),
        targetRoleId: v.targetRoleId,
        isActive: v.isActive,
        conditions,
        effectiveFrom: v.effectiveFrom || null,
        effectiveTo: v.effectiveTo || null,
      };
      return isNew ? api.workflowRules.create(body) : api.workflowRules.update(r!.id, body);
    },
    onSuccess: () => {
      notify('Routing rule saved');
      void qc.invalidateQueries({ queryKey: ['workflow-rules'] });
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });

  const financeRoles = roles.data?.filter((x) => x.permissions.includes('FINANCE_REVIEW')) ?? [];

  return (
    <Dialog open={!!item} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{isNew ? 'New routing rule' : `Edit: ${r?.name}`}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ pt: 1 }}>
          {error && (
            <Grid size={12}>
              <Alert severity="error">{error}</Alert>
            </Grid>
          )}
          <Grid size={{ xs: 12, sm: 8 }}>
            <TextField label="Name" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Priority" type="number" required value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })} helperText="Lower runs first" />
          </Grid>
          <Grid size={12}>
            <TextField label="Description" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </Grid>
          <Grid size={12}>
            <Typography variant="subtitle2">Conditions (all must match; leave everything empty for a catch-all)</Typography>
          </Grid>
          <Grid size={12}>
            <TextField
              select
              label="Wings"
              value={v.wingIds}
              helperText="Empty = any wing"
              slotProps={{ select: { multiple: true, renderValue: (s) => wings.data?.filter((x) => (s as string[]).includes(x.id)).map((x) => x.name).join(', ') } }}
              onChange={(e) => setV({ ...v, wingIds: e.target.value as unknown as string[] })}
            >
              {wings.data?.map((w) => (
                <MenuItem key={w.id} value={w.id}>
                  <Checkbox size="small" checked={v.wingIds.includes(w.id)} />
                  <ListItemText primary={w.name} secondary={w.code} />
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              label="Sales types"
              value={v.salesTypeIds}
              slotProps={{ select: { multiple: true, renderValue: (s) => salesTypes.data?.filter((x) => (s as string[]).includes(x.id)).map((x) => x.name).join(', ') } }}
              onChange={(e) => setV({ ...v, salesTypeIds: e.target.value as unknown as string[] })}
            >
              {salesTypes.data?.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  <Checkbox size="small" checked={v.salesTypeIds.includes(s.id)} />
                  <ListItemText primary={s.name} />
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select label="Special sales type" value={v.isSpecial} onChange={(e) => setV({ ...v, isSpecial: e.target.value as typeof v.isSpecial })}>
              <MenuItem value="">Any</MenuItem>
              <MenuItem value="true">Special only</MenuItem>
              <MenuItem value="false">Non-special only</MenuItem>
            </TextField>
          </Grid>
          <Grid size={12}>
            <MultiPartyPicker value={v.parties} onChange={(parties) => setV({ ...v, parties })} />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <TextField label="Minimum amount" value={v.minAmount} onChange={(e) => setV({ ...v, minAmount: e.target.value.replace(/[^\d.]/g, '') })} />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <TextField label="Maximum amount" value={v.maxAmount} onChange={(e) => setV({ ...v, maxAmount: e.target.value.replace(/[^\d.]/g, '') })} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField select label="Route to role" required value={v.targetRoleId} onChange={(e) => setV({ ...v, targetRoleId: e.target.value })}>
              {financeRoles.map((x) => (
                <MenuItem key={x.id} value={x.id}>
                  {x.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 6, sm: 4 }}>
            <TextField label="Effective from" type="date" value={v.effectiveFrom} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 6, sm: 4 }}>
            <TextField label="Effective to" type="date" value={v.effectiveTo} onChange={(e) => setV({ ...v, effectiveTo: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={12}>
            <FormControlLabel control={<Switch checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />} label="Active" />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !v.name || !v.targetRoleId}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---- Business rules ------------------------------------------------------------------------------

function paramsSummary(r: BusinessRuleDto): string {
  const p = r.params as Record<string, unknown>;
  switch (r.type) {
    case 'MIN_AMOUNT':
    case 'MAX_AMOUNT':
      return String(p.amount);
    case 'REQUIRED_FIELD':
      return (p.fields as string[]).map((f) => TRANSACTION_FIELD_LABELS[f as keyof typeof TRANSACTION_FIELD_LABELS] ?? f).join(', ');
    case 'PARTY_RESTRICTION':
      return `${p.mode} ${(p.partyIds as string[]).length} part(ies)`;
    case 'ACCOUNT_RESTRICTION':
      return `${p.mode} ${(p.accountIds as string[]).length} account(s)`;
    case 'APPROVAL_LEVEL':
      return `≥ ${String(p.minAmount)} needs ${String(p.requiredRoleCode)}`;
  }
}

function BusinessRules() {
  const { can } = useAuth();
  const rules = useQuery({ queryKey: ['business-rules'], queryFn: api.businessRules.list });
  const [editing, setEditing] = useState<BusinessRuleDto | 'new' | null>(null);
  const columns: GridColDef<BusinessRuleDto>[] = [
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
    { field: 'type', headerName: 'Type', width: 170, valueFormatter: (v: string) => humanize(v) },
    { field: 'params', headerName: 'Parameters', flex: 1.3, minWidth: 220, sortable: false, valueGetter: (_v, r) => paramsSummary(r) },
    { field: 'trigger', headerName: 'Applies from', width: 120, valueFormatter: (v: string) => humanize(v) },
    {
      field: 'severity',
      headerName: 'Severity',
      width: 110,
      renderCell: ({ row }) => <Chip size="small" label={humanize(row.severity)} color={row.severity === 'ERROR' ? 'error' : 'warning'} variant="outlined" />,
    },
    { field: 'isActive', headerName: 'Active', width: 90, valueFormatter: (v: boolean) => (v ? 'Yes' : 'No') },
  ];
  return (
    <>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="body2" color="text.secondary">
          ERROR rules block the action; WARNING rules only inform. Rules from earlier stages also apply later (Save → Submit → Approve).
        </Typography>
        {can('SYSTEM_SETTINGS_UPDATE') && (
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setEditing('new')}>
            New rule
          </Button>
        )}
      </Stack>
      {rules.error && <ErrorState error={rules.error} />}
      <Paper variant="outlined">
        <DataGrid rows={rules.data ?? []} columns={columns} loading={rules.isLoading} autoHeight hideFooter onRowClick={(p) => can('SYSTEM_SETTINGS_UPDATE') && setEditing(p.row)} />
      </Paper>
      <BusinessRuleDialog item={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function BusinessRuleDialog({ item, onClose }: { item: BusinessRuleDto | 'new' | null; onClose(): void }) {
  const qc = useQueryClient();
  const { notify } = useNotifier();
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.roles.list });
  const accounts = useMasterOptions('accounts', {});
  const isNew = item === 'new';
  const r = isNew ? null : item;
  const [type, setType] = useState<BusinessRuleType>('MAX_AMOUNT');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [trigger, setTrigger] = useState<string>('SUBMIT');
  const [severity, setSeverity] = useState<string>('ERROR');
  const [isActive, setIsActive] = useState(true);
  const [amount, setAmount] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [mode, setMode] = useState<'ALLOW' | 'DENY'>('DENY');
  const [parties, setParties] = useState<{ id: string; name: string }[]>([]);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [roleCode, setRoleCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const p = (r?.params ?? {}) as Record<string, unknown>;
    setType(r?.type ?? 'MAX_AMOUNT');
    setName(r?.name ?? '');
    setDescription(r?.description ?? '');
    setTrigger(r?.trigger ?? 'SUBMIT');
    setSeverity(r?.severity ?? 'ERROR');
    setIsActive(r?.isActive ?? true);
    setAmount(String(p.amount ?? p.minAmount ?? ''));
    setFields((p.fields as string[]) ?? []);
    setMode((p.mode as 'ALLOW' | 'DENY') ?? 'DENY');
    const partyIds = (p.partyIds as string[]) ?? [];
    setParties(partyIds.map((id) => ({ id, name: 'Loading…' })));
    if (partyIds.length) void loadPartyRefs(partyIds).then(setParties);
    setAccountIds((p.accountIds as string[]) ?? []);
    setRoleCode(String(p.requiredRoleCode ?? ''));
  }, [item, r]);

  const params = (): Record<string, unknown> => {
    switch (type) {
      case 'MIN_AMOUNT':
      case 'MAX_AMOUNT':
        return { amount };
      case 'REQUIRED_FIELD':
        return { fields };
      case 'PARTY_RESTRICTION':
        return { mode, partyIds: parties.map((x) => x.id) };
      case 'ACCOUNT_RESTRICTION':
        return { mode, accountIds };
      case 'APPROVAL_LEVEL':
        return { minAmount: amount, requiredRoleCode: roleCode };
    }
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description: description || null, trigger, severity, isActive, params: params() };
      return isNew ? api.businessRules.create({ ...body, type }) : api.businessRules.update(r!.id, body);
    },
    onSuccess: () => {
      notify('Business rule saved');
      void qc.invalidateQueries({ queryKey: ['business-rules'] });
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });

  const fieldOptions = [...TRANSACTION_EDITABLE_FIELDS, ATTACHMENTS_FIELD] as const;

  return (
    <Dialog open={!!item} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isNew ? 'New business rule' : `Edit: ${r?.name}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <TextField select label="Type" value={type} disabled={!isNew} onChange={(e) => setType(e.target.value as BusinessRuleType)}>
            {BUSINESS_RULE_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {humanize(t)}
              </MenuItem>
            ))}
          </TextField>
          {(type === 'MIN_AMOUNT' || type === 'MAX_AMOUNT' || type === 'APPROVAL_LEVEL') && (
            <TextField label={type === 'APPROVAL_LEVEL' ? 'From amount' : 'Amount'} required value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          )}
          {type === 'APPROVAL_LEVEL' && (
            <TextField select label="Required approver role" value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
              {roles.data?.filter((x) => x.permissions.includes('FINANCE_APPROVE')).map((x) => (
                <MenuItem key={x.id} value={x.code}>
                  {x.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {type === 'REQUIRED_FIELD' && (
            <TextField
              select
              label="Required fields"
              value={fields}
              slotProps={{ select: { multiple: true, renderValue: (s) => (s as string[]).map((f) => TRANSACTION_FIELD_LABELS[f as keyof typeof TRANSACTION_FIELD_LABELS]).join(', ') } }}
              onChange={(e) => setFields(e.target.value as unknown as string[])}
            >
              {fieldOptions.map((f) => (
                <MenuItem key={f} value={f}>
                  <Checkbox size="small" checked={fields.includes(f)} />
                  <ListItemText primary={TRANSACTION_FIELD_LABELS[f]} />
                </MenuItem>
              ))}
            </TextField>
          )}
          {(type === 'PARTY_RESTRICTION' || type === 'ACCOUNT_RESTRICTION') && (
            <TextField select label="Mode" value={mode} onChange={(e) => setMode(e.target.value as 'ALLOW' | 'DENY')}>
              <MenuItem value="DENY">Deny the listed items</MenuItem>
              <MenuItem value="ALLOW">Allow only the listed items</MenuItem>
            </TextField>
          )}
          {type === 'PARTY_RESTRICTION' && <MultiPartyPicker value={parties} onChange={setParties} />}
          {type === 'ACCOUNT_RESTRICTION' && (
            <TextField
              select
              label="Accounts"
              value={accountIds}
              slotProps={{ select: { multiple: true, renderValue: (s) => accounts.data?.filter((a) => (s as string[]).includes(a.id)).map((a) => a.code).join(', ') } }}
              onChange={(e) => setAccountIds(e.target.value as unknown as string[])}
            >
              {accounts.data?.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  <Checkbox size="small" checked={accountIds.includes(a.id)} />
                  <ListItemText primary={a.name} secondary={a.code} />
                </MenuItem>
              ))}
            </TextField>
          )}
          <Stack direction="row" spacing={2}>
            <TextField select label="Applies from" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {RULE_TRIGGERS.map((t) => (
                <MenuItem key={t} value={t}>
                  {humanize(t)}
                </MenuItem>
              ))}
            </TextField>
            <TextField select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {RULE_SEVERITIES.map((s) => (
                <MenuItem key={s} value={s}>
                  {humanize(s)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <FormControlLabel control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />} label="Active" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !name}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
