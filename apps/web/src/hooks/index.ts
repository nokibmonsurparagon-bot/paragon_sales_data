import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { MasterDataEntity } from '@paragon/shared';
import { api } from '../api/endpoints';

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useClientConfig() {
  return useQuery({ queryKey: ['client-config'], queryFn: api.config, staleTime: 5 * 60_000 });
}

export function useCurrency(): string {
  return useClientConfig().data?.currency ?? 'USD';
}

/** Active master-data options for dropdowns (small lists; parties use server search instead). */
export function useMasterOptions(entity: MasterDataEntity, extra: Record<string, string | undefined> = {}, enabled = true) {
  return useQuery({
    queryKey: ['master-options', entity, extra],
    queryFn: () => api.master.list(entity, { status: 'ACTIVE', limit: 500, sort: 'name:asc', ...extra }),
    select: (d) => d.items,
    staleTime: 60_000,
    enabled,
  });
}

/**
 * List state (page, sort, filters) kept in the URL so it survives reloads and can be shared.
 * Returns the current params as a plain object and a setter that merges and resets paging.
 */
export function useUrlState(defaults: Record<string, string> = {}) {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => ({ ...defaults, ...Object.fromEntries(params.entries()) }), [params, defaults]);
  const update = (patch: Record<string, string | number | undefined | null>, resetPage = true) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === null || v === '') next.delete(k);
          else next.set(k, String(v));
        }
        if (resetPage && !('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  };
  const reset = () => setParams(new URLSearchParams(), { replace: true });
  return { state, update, reset };
}
