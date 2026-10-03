/**
 * Master-data import: spreadsheet rows → validated records. Pure (no I/O) so it can be unit-tested;
 * reading the workbook and writing to the database live in master-data.service.ts.
 */
import {
  MASTER_IMPORT_COLUMNS,
  MASTER_IMPORT_MAX_ROWS,
  codeSchema,
  nameSchema,
  type MasterDataEntity,
  type MasterImportColumn,
  type MasterImportField,
  type MasterImportResult,
} from '@paragon/shared';

export interface SheetRow {
  /** Spreadsheet row number (1-based). */
  row: number;
  /** Cell texts by column index (0-based); missing cells are undefined. */
  cells: (string | undefined)[];
}

export interface ImportRecord {
  row: number;
  code: string;
  name: string;
  status?: 'ACTIVE' | 'INACTIVE';
  bankCode?: string;
  isSpecial?: boolean;
}

export type ImportError = MasterImportResult['errors'][number];

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0']);

/** Which spreadsheet column holds which field, from the header row. */
function mapHeader(cells: (string | undefined)[], columns: MasterImportColumn[]): Map<MasterImportField, number> {
  const byName = new Map<string, MasterImportField>();
  for (const c of columns) for (const name of [c.header, ...c.aliases]) byName.set(normalize(name), c.field);
  const found = new Map<MasterImportField, number>();
  cells.forEach((text, i) => {
    const field = text ? byName.get(normalize(text)) : undefined;
    if (field && !found.has(field)) found.set(field, i);
  });
  return found;
}

export function parseMasterRows(entity: MasterDataEntity, rows: SheetRow[]): { records: ImportRecord[]; errors: ImportError[]; totalRows: number } {
  const columns = MASTER_IMPORT_COLUMNS[entity];
  const label = (f: MasterImportField) => columns.find((c) => c.field === f)!.header;
  const errors: ImportError[] = [];
  const nonEmpty = rows.filter((r) => r.cells.some((c) => c && c.trim() !== ''));
  const [header, ...data] = nonEmpty;
  if (!header) return { records: [], errors: [{ row: 1, message: 'The file is empty' }], totalRows: 0 };

  const at = mapHeader(header.cells, columns);
  const missing = columns.filter((c) => c.required && !at.has(c.field));
  if (missing.length) {
    return {
      records: [],
      errors: [{ row: header.row, message: `Missing column(s): ${missing.map((c) => c.header).join(', ')}. Use the template headers.` }],
      totalRows: data.length,
    };
  }
  if (data.length > MASTER_IMPORT_MAX_ROWS) {
    return { records: [], errors: [{ row: header.row, message: `Too many rows (${data.length}); at most ${MASTER_IMPORT_MAX_ROWS} per file` }], totalRows: data.length };
  }

  const records: ImportRecord[] = [];
  const seen = new Map<string, number>();
  for (const r of data) {
    const cell = (f: MasterImportField) => {
      const i = at.get(f);
      return i === undefined ? '' : (r.cells[i] ?? '').trim();
    };
    const rowErrors: ImportError[] = [];
    const fail = (f: MasterImportField, message: string) => rowErrors.push({ row: r.row, column: label(f), message });

    const code = codeSchema.safeParse(cell('code'));
    if (!code.success) fail('code', code.error.issues[0]!.message);
    const name = nameSchema.safeParse(cell('name'));
    if (!name.success) fail('name', name.error.issues[0]!.message);

    const rec: ImportRecord = { row: r.row, code: code.success ? code.data.toUpperCase() : '', name: name.success ? name.data : '' };

    const status = cell('status').toLowerCase();
    if (status === 'active' || YES.has(status)) rec.status = 'ACTIVE';
    else if (status === 'inactive' || NO.has(status)) rec.status = 'INACTIVE';
    else if (status) fail('status', 'Use Active or Inactive');

    if (at.has('isSpecial')) {
      const v = cell('isSpecial').toLowerCase();
      if (YES.has(v)) rec.isSpecial = true;
      else if (NO.has(v)) rec.isSpecial = false;
      else if (v) fail('isSpecial', 'Use Yes or No');
    }

    if (entity === 'accounts') {
      const bank = codeSchema.safeParse(cell('bankCode'));
      if (!bank.success) fail('bankCode', bank.error.issues[0]!.message);
      else rec.bankCode = bank.data.toUpperCase();
    }

    if (rec.code) {
      const first = seen.get(rec.code);
      if (first !== undefined) fail('code', `${rec.code} appears more than once (first on row ${first})`);
      else seen.set(rec.code, r.row);
    }
    if (rowErrors.length) errors.push(...rowErrors);
    else records.push(rec);
  }
  if (!data.length) errors.push({ row: header.row, message: 'No data rows below the header row' });
  return { records, errors, totalRows: data.length };
}
