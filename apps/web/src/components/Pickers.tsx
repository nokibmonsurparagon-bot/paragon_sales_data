import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Autocomplete from '@mui/material/Autocomplete';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import type { MasterDataEntity, MasterDataItem, Permission, Ref, UserRef } from '@paragon/shared';
import { api } from '../api/endpoints';
import { useDebounced, useMasterOptions } from '../hooks';

interface SelectProps {
  label: string;
  value: string;
  onChange(value: string): void;
  required?: boolean;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
  /** Show an "Any" option (filters). */
  allowEmpty?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  name?: string;
}

/** Dropdown fed from master data (banks, accounts filtered by bank, sales types). */
export function MasterSelect({
  entity,
  bankId,
  current,
  ...p
}: SelectProps & { entity: Exclude<MasterDataEntity, SearchableEntity>; bankId?: string; current?: { id: string; code: string; name: string } | null }) {
  const needsBank = entity === 'accounts';
  const { data = [], isLoading } = useMasterOptions(entity, needsBank ? { bankId: bankId || undefined } : {}, !needsBank || !!bankId || !!p.allowEmpty);
  // Keep a (possibly now inactive) current value visible.
  const options: Pick<MasterDataItem, 'id' | 'code' | 'name'>[] =
    current && !data.some((o) => o.id === current.id) ? [current, ...data] : data;
  return (
    <TextField
      select
      label={p.label}
      name={p.name}
      value={options.some((o) => o.id === p.value) ? p.value : ''}
      onChange={(e) => p.onChange(e.target.value)}
      required={p.required}
      disabled={p.disabled || (needsBank && !bankId && !p.allowEmpty)}
      error={p.error}
      helperText={p.helperText ?? (needsBank && !bankId && !p.allowEmpty ? 'Select a bank first' : undefined)}
      inputRef={p.inputRef}
    >
      {p.allowEmpty !== undefined && <MenuItem value="">{p.allowEmpty}</MenuItem>}
      {isLoading && <MenuItem disabled>Loading…</MenuItem>}
      {options.map((o) => (
        <MenuItem key={o.id} value={o.id}>
          {o.name} <span style={{ opacity: 0.6, marginLeft: 8 }}>{o.code}</span>
        </MenuItem>
      ))}
    </TextField>
  );
}

/** Wing dropdown restricted to the given wings (the signed-in user's own wings on the transaction form). */
export function WingSelect({ options, current, ...p }: SelectProps & { options: Ref[]; current?: Ref | null }) {
  const all = current && !options.some((o) => o.id === current.id) ? [current, ...options] : options;
  return (
    <TextField
      select
      label={p.label}
      name={p.name}
      value={all.some((o) => o.id === p.value) ? p.value : ''}
      onChange={(e) => p.onChange(e.target.value)}
      required={p.required}
      disabled={p.disabled}
      error={p.error}
      helperText={p.helperText ?? (!all.length ? 'You are not assigned to any wing – contact an administrator' : undefined)}
      inputRef={p.inputRef}
    >
      {p.allowEmpty !== undefined && <MenuItem value="">{p.allowEmpty}</MenuItem>}
      {all.map((o) => (
        <MenuItem key={o.id} value={o.id}>
          {o.name} <span style={{ opacity: 0.6, marginLeft: 8 }}>{o.code}</span>
        </MenuItem>
      ))}
    </TextField>
  );
}

type RefOption = { id: string; code?: string; name: string };

/** Resolves party ids stored in rules to display names. */
export async function loadPartyRefs(ids: string[]): Promise<RefOption[]> {
  const rows = await Promise.all(ids.map((id) => api.master.get('parties', id).catch(() => ({ id, code: '', name: `Unknown farmer / customer (${id.slice(0, 8)})` }))));
  return rows.map((p) => ({ id: p.id, code: p.code, name: p.name }));
}

/** Master-data lists that can be large: picked with server-side search instead of a plain dropdown. */
export type SearchableEntity = Extract<MasterDataEntity, 'lines' | 'branches' | 'cv-codes' | 'parties'>;

/** Server-side searched master-data picker (farmer / customer, line, branch and CV code lists can be large). */
export function MasterPicker({
  entity,
  value,
  onChange,
  label,
  required,
  disabled,
  error,
  helperText,
}: {
  entity: SearchableEntity;
  value: RefOption | null;
  onChange(v: RefOption | null): void;
  label: string;
  required?: boolean;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
}) {
  const [input, setInput] = useState('');
  const q = useDebounced(input);
  const { data, isFetching } = useQuery({
    queryKey: ['master-search', entity, q],
    queryFn: () => api.master.list(entity, { q, status: 'ACTIVE', limit: 25, sort: 'name:asc' }),
    select: (d) => d.items.map((p) => ({ id: p.id, code: p.code, name: p.name })),
  });
  return (
    <Autocomplete
      options={data ?? []}
      value={value}
      onChange={(_e, v) => onChange(v)}
      onInputChange={(_e, v, reason) => reason === 'input' && setInput(v)}
      getOptionLabel={(o) => (o.code ? `${o.name} (${o.code})` : o.name)}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(x) => x}
      loading={isFetching}
      disabled={disabled}
      renderInput={(params) => <TextField {...params} label={label} required={required} error={error} helperText={helperText} />}
    />
  );
}

/** Farmer / customer picker (the "parties" master data). */
export function PartyPicker({ label = 'Farmer / Customer', ...p }: Omit<Parameters<typeof MasterPicker>[0], 'entity' | 'label'> & { label?: string }) {
  return <MasterPicker entity="parties" label={label} {...p} />;
}

export function MultiPartyPicker({ value, onChange }: { value: RefOption[]; onChange(v: RefOption[]): void }) {
  const [input, setInput] = useState('');
  const q = useDebounced(input);
  const { data } = useQuery({
    queryKey: ['party-search', q],
    queryFn: () => api.master.list('parties', { q, limit: 25, sort: 'name:asc' }),
    select: (d) => d.items.map((p) => ({ id: p.id, code: p.code, name: p.name })),
  });
  return (
    <Autocomplete
      multiple
      options={data ?? []}
      value={value}
      onChange={(_e, v) => onChange(v)}
      onInputChange={(_e, v, reason) => reason === 'input' && setInput(v)}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(x) => x}
      renderInput={(params) => <TextField {...params} label="Farmers / Customers" />}
    />
  );
}

/** Active-user picker, optionally restricted to holders of a permission and to users working on a wing. */
export function UserPicker({
  value,
  onChange,
  label,
  permission,
  wingId,
  disabled,
}: {
  value: UserRef | null;
  onChange(v: UserRef | null): void;
  label: string;
  permission?: Permission;
  wingId?: string;
  disabled?: boolean;
}) {
  const [input, setInput] = useState('');
  const q = useDebounced(input);
  const { data, isFetching } = useQuery({
    queryKey: ['user-lookup', permission, wingId, q],
    queryFn: () => api.users.lookup({ q, permission, wingId, limit: 25 }),
    select: (d) => d.items,
  });
  return (
    <Autocomplete
      options={data ?? []}
      value={value}
      onChange={(_e, v) => onChange(v)}
      onInputChange={(_e, v, reason) => reason === 'input' && setInput(v)}
      getOptionLabel={(o) => o.fullName}
      renderOption={(props, o) => (
        <li {...props} key={o.id}>
          {o.fullName}&nbsp;<span style={{ opacity: 0.6 }}>{o.email}</span>
        </li>
      )}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(x) => x}
      loading={isFetching}
      disabled={disabled}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
}
