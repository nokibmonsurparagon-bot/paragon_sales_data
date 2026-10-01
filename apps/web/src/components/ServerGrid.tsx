import { useCallback, useMemo } from 'react';
import {
  DataGrid,
  type GridColDef,
  type GridColumnVisibilityModel,
  type GridRowId,
  type GridRowParams,
  type GridValidRowModel,
} from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';

interface Props<R extends GridValidRowModel> {
  rows: R[];
  columns: GridColDef<R>[];
  total: number;
  loading?: boolean;
  page: number; // 1-based
  limit: number;
  sort?: string; // field:dir
  onChange(patch: { page?: number; limit?: number; sort?: string }): void;
  onRowClick?(row: R): void;
  getRowId?: (row: R) => string;
  noRowsLabel?: string;
  /** Checkbox selection of rows on the current page (ids of selected rows). */
  selection?: {
    ids: GridRowId[];
    onChange(ids: GridRowId[]): void;
    isSelectable?(row: R): boolean;
  };
  /** Columns hidden until the user shows them from the column menu. */
  hiddenColumns?: string[];
}

/** DataGrid in server mode: pagination and sorting are delegated to the API. */
export function ServerGrid<R extends GridValidRowModel>({
  rows,
  columns,
  total,
  loading,
  page,
  limit,
  sort,
  onChange,
  onRowClick,
  getRowId,
  noRowsLabel = 'No records match the current filters',
  selection,
  hiddenColumns,
}: Props<R>) {
  const [field, dir] = (sort ?? '').split(':');
  const rowId = useCallback((r: R): GridRowId => (getRowId ? getRowId(r) : (r.id as GridRowId)), [getRowId]);
  const initialVisibility: GridColumnVisibilityModel = Object.fromEntries((hiddenColumns ?? []).map((c) => [c, false]));
  // Stable selection props: the grid re-syncs (and may report changes) whenever these identities change.
  const selectedIds = selection?.ids;
  const selectionModel = useMemo(() => ({ type: 'include' as const, ids: new Set(selectedIds ?? []) }), [selectedIds]);
  const isSelectable = selection?.isSelectable;
  const isRowSelectable = useCallback((p: GridRowParams<R>) => (isSelectable ? isSelectable(p.row) : true), [isSelectable]);
  const onSelectionChange = selection?.onChange;
  const onRowSelectionModelChange = useCallback(
    (m: { type: 'include' | 'exclude'; ids: Set<GridRowId> }) => {
      // "Select all" may arrive as an exclude-model; resolve it against the rows on this page.
      const next = m.type === 'include' ? [...m.ids] : rows.filter((r) => (isSelectable?.(r) ?? true) && !m.ids.has(rowId(r))).map(rowId);
      const same = next.length === (selectedIds?.length ?? 0) && next.every((id) => selectedIds?.includes(id));
      if (!same) onSelectionChange?.(next);
    },
    [rows, isSelectable, rowId, selectedIds, onSelectionChange],
  );
  return (
    <Paper variant="outlined" sx={{ width: '100%', overflow: 'hidden' }}>
      <DataGrid<R>
        rows={rows}
        columns={columns}
        getRowId={getRowId}
        rowCount={total}
        loading={loading}
        paginationMode="server"
        sortingMode="server"
        filterMode="server"
        disableColumnFilter
        pageSizeOptions={[10, 20, 50, 100]}
        paginationModel={{ page: page - 1, pageSize: limit }}
        onPaginationModelChange={(m) => onChange({ page: m.page + 1, limit: m.pageSize })}
        // Only sort by a shown column: the grid drops unknown fields and reports that as a change while rendering.
        sortModel={field && columns.some((c) => c.field === field) ? [{ field, sort: dir === 'asc' ? 'asc' : 'desc' }] : []}
        onSortModelChange={(m) => onChange({ sort: m[0] ? `${m[0].field}:${m[0].sort}` : undefined, page: 1 })}
        onRowClick={onRowClick ? (p: GridRowParams<R>) => onRowClick(p.row) : undefined}
        autoHeight
        initialState={hiddenColumns?.length ? { columns: { columnVisibilityModel: initialVisibility } } : undefined}
        {...(selection
          ? {
              checkboxSelection: true,
              checkboxSelectionVisibleOnly: true,
              disableRowSelectionOnClick: true,
              isRowSelectable,
              rowSelectionModel: selectionModel,
              onRowSelectionModelChange,
            }
          : {})}
        localeText={{ noRowsLabel }}
        sx={{ '& .MuiDataGrid-row': { cursor: onRowClick ? 'pointer' : 'default' } }}
      />
    </Paper>
  );
}
