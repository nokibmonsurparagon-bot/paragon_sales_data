import { Readable } from 'node:stream';
import type { MasterStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import type {
  masterDataCreateSchemas,
  masterDataUpdateSchemas} from '@paragon/shared';
import {
  ERROR_CODES,
  MASTER_IMPORT_COLUMNS,
  type MasterDataEntity,
  type MasterDataItem,
  type MasterDataListQuery,
  type MasterImportResult,
  type Paginated,
} from '@paragon/shared';
import type { z } from 'zod';
import { writeAudit } from '../../core/audit.js';
import { prisma, withTransaction, type Db } from '../../core/db.js';
import { NotFoundError, PayloadError, ValidationError } from '../../core/errors.js';
import { pageArgs, sortOrder } from '../../core/http.js';
import { parseMasterRows, type ImportRecord, type SheetRow } from './master-import.js';

interface Row {
  id: string;
  code: string;
  name: string;
  status: MasterStatus;
  createdAt: Date;
  updatedAt: Date;
  bankId?: string;
  bank?: { id: string; code: string; name: string };
  isSpecial?: boolean;
}

/** The master-data delegates share the same shape; this narrow interface lets one service serve all. */
interface Delegate {
  findMany(args: object): Promise<Row[]>;
  count(args: object): Promise<number>;
  findUnique(args: object): Promise<Row | null>;
  create(args: object): Promise<Row>;
  createMany(args: object): Promise<{ count: number }>;
  update(args: object): Promise<Row>;
}

const CONFIG: Record<MasterDataEntity, { label: string; delegate: (db: Db) => Delegate; include?: object }> = {
  wings: { label: 'Wing', delegate: (db) => db.wing as unknown as Delegate },
  lines: { label: 'Line', delegate: (db) => db.line as unknown as Delegate },
  branches: { label: 'Branch', delegate: (db) => db.branch as unknown as Delegate },
  banks: { label: 'Bank', delegate: (db) => db.bank as unknown as Delegate },
  accounts: {
    label: 'Account',
    delegate: (db) => db.account as unknown as Delegate,
    include: { bank: { select: { id: true, code: true, name: true } } },
  },
  parties: { label: 'Party', delegate: (db) => db.party as unknown as Delegate },
  'sales-types': { label: 'SalesType', delegate: (db) => db.salesType as unknown as Delegate },
};

function toDto(r: Row): MasterDataItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...(r.bankId !== undefined ? { bankId: r.bankId } : {}),
    ...(r.bank ? { bank: r.bank } : {}),
    ...(r.isSpecial !== undefined ? { isSpecial: r.isSpecial } : {}),
  };
}

async function assertBank(bankId: string | undefined): Promise<void> {
  if (!bankId) return;
  const bank = await prisma.bank.findUnique({ where: { id: bankId }, select: { id: true } });
  if (!bank) throw new ValidationError('Validation failed', [{ path: 'bankId', message: 'Bank does not exist' }]);
}

const PREVIEW_ROWS = 200;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const IMPORT_FILE_TYPE = XLSX_MIME;

/** Reads the first worksheet of an .xlsx or .csv file as cell texts (codes keep leading zeros). */
async function readSheet(file: { buffer: Buffer; originalname: string }): Promise<SheetRow[]> {
  const isCsv = /\.csv$/i.test(file.originalname);
  const isXlsx = /\.xlsx$/i.test(file.originalname);
  if (!isCsv && !isXlsx) throw new PayloadError(415, ERROR_CODES.UNSUPPORTED_FILE_TYPE, 'Upload an Excel (.xlsx) or CSV (.csv) file');
  if (isXlsx && file.buffer.subarray(0, 4).toString('binary') !== 'PK\x03\x04') {
    throw new PayloadError(415, ERROR_CODES.UNSUPPORTED_FILE_TYPE, 'The file is not a valid Excel (.xlsx) workbook');
  }
  if (isCsv && file.buffer.includes(0)) throw new PayloadError(415, ERROR_CODES.UNSUPPORTED_FILE_TYPE, 'The file is not a text CSV file');
  const wb = new ExcelJS.Workbook();
  try {
    // Identity map: keep every CSV value as text (no number/date conversion that would drop leading zeros).
    if (isCsv) await wb.csv.read(Readable.from(file.buffer), { map: (v: unknown) => v } as never);
    else await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
  } catch {
    throw new ValidationError(`The file could not be read as ${isCsv ? 'CSV' : 'an Excel workbook'}`);
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ValidationError('The workbook has no worksheet');
  const rows: SheetRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: (string | undefined)[] = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      cells[col - 1] = cell.text?.toString();
    });
    rows.push({ row: rowNumber, cells });
  });
  return rows;
}

const statusText = (s: MasterStatus) => (s === 'ACTIVE' ? 'Active' : 'Inactive');

export function masterDataService(entity: MasterDataEntity) {
  const cfg = CONFIG[entity];
  const include = cfg.include ? { include: cfg.include } : {};

  return {
    async list(q: MasterDataListQuery): Promise<Paginated<MasterDataItem>> {
      const where: Record<string, unknown> = {};
      if (q.q) {
        where.OR = [
          { code: { contains: q.q, mode: 'insensitive' } },
          { name: { contains: q.q, mode: 'insensitive' } },
        ];
      }
      if (q.status) where.status = q.status;
      if (q.bankId && entity === 'accounts') where.bankId = q.bankId;
      const { field, dir } = sortOrder(q.sort, ['code', 'name', 'status', 'createdAt', 'updatedAt'] as const, {
        field: 'name',
        dir: 'asc',
      });
      const d = cfg.delegate(prisma);
      const [items, total] = await Promise.all([
        d.findMany({ where, orderBy: { [field]: dir }, ...pageArgs(q), ...include }),
        d.count({ where }),
      ]);
      return { items: items.map(toDto), page: q.page, limit: q.limit, total };
    },

    async get(id: string): Promise<MasterDataItem> {
      const row = await cfg.delegate(prisma).findUnique({ where: { id }, ...include });
      if (!row) throw new NotFoundError(cfg.label);
      return toDto(row);
    },

    async create(input: z.infer<(typeof masterDataCreateSchemas)[MasterDataEntity]>): Promise<MasterDataItem> {
      await assertBank((input as { bankId?: string }).bankId);
      return withTransaction(async (tx) => {
        const row = await cfg.delegate(tx).create({ data: { ...input, code: input.code.toUpperCase() }, ...include });
        await writeAudit({ action: 'CHANGE_MASTER_DATA', entityType: cfg.label, entityId: row.id, newData: toDto(row) }, tx);
        return toDto(row);
      });
    },

    /**
     * Excel / CSV import: new codes are added, existing codes updated (matched on code). With `dryRun` – and whenever the
     * file has any error – nothing is written; otherwise everything is applied in one DB transaction (all or nothing).
     */
    async importFile(file: { buffer: Buffer; originalname: string } | undefined, dryRun: boolean): Promise<MasterImportResult> {
      if (!file) throw new ValidationError('Validation failed', [{ path: 'file', message: 'Choose a file to import' }]);
      const parsed = parseMasterRows(entity, await readSheet(file));
      const errors = [...parsed.errors];
      const codes = parsed.records.map((r) => r.code);
      const d = cfg.delegate(prisma);
      const existing = new Map((await d.findMany({ where: { code: { in: codes } } })).map((r) => [r.code, r]));

      const bankIds = new Map<string, string>();
      if (entity === 'accounts') {
        const wanted = [...new Set(parsed.records.map((r) => r.bankCode!))];
        for (const b of await prisma.bank.findMany({ where: { code: { in: wanted } }, select: { id: true, code: true } })) bankIds.set(b.code, b.id);
      }

      type Plan = { rec: ImportRecord; action: 'create' | 'update'; data: Record<string, unknown>; changes: string[]; id?: string };
      const plans: Plan[] = [];
      let unchanged = 0;
      for (const rec of parsed.records) {
        const bankId = rec.bankCode ? bankIds.get(rec.bankCode) : undefined;
        if (entity === 'accounts' && !bankId) {
          errors.push({ row: rec.row, column: 'Bank Code', message: `Bank ${rec.bankCode} does not exist` });
          continue;
        }
        const before = existing.get(rec.code);
        if (!before) {
          const data: Record<string, unknown> = { code: rec.code, name: rec.name, status: rec.status ?? 'ACTIVE' };
          if (bankId) data.bankId = bankId;
          if (entity === 'sales-types') data.isSpecial = rec.isSpecial ?? false;
          plans.push({ rec, action: 'create', data, changes: [] });
          continue;
        }
        const data: Record<string, unknown> = {};
        const changes: string[] = [];
        if (before.name !== rec.name) {
          data.name = rec.name;
          changes.push(`Name: ${before.name} → ${rec.name}`);
        }
        if (rec.status && before.status !== rec.status) {
          data.status = rec.status;
          changes.push(`Status: ${statusText(before.status)} → ${statusText(rec.status)}`);
        }
        if (bankId && before.bankId !== bankId) {
          data.bankId = bankId;
          changes.push(`Bank: ${before.bank?.code ?? '?'} → ${rec.bankCode}`);
        }
        if (rec.isSpecial !== undefined && before.isSpecial !== rec.isSpecial) {
          data.isSpecial = rec.isSpecial;
          changes.push(`Special: ${before.isSpecial ? 'Yes' : 'No'} → ${rec.isSpecial ? 'Yes' : 'No'}`);
        }
        if (changes.length) plans.push({ rec, action: 'update', data, changes, id: before.id });
        else unchanged += 1;
      }

      errors.sort((a, b) => a.row - b.row);
      const result: MasterImportResult = {
        dryRun,
        applied: false,
        fileName: file.originalname,
        totalRows: parsed.totalRows,
        created: plans.filter((p) => p.action === 'create').length,
        updated: plans.filter((p) => p.action === 'update').length,
        unchanged,
        errors,
        preview: plans.slice(0, PREVIEW_ROWS).map((p) => ({ row: p.rec.row, code: p.rec.code, name: p.rec.name, action: p.action, changes: p.changes })),
      };
      if (dryRun || errors.length || !plans.length) return result;

      await withTransaction(
        async (tx) => {
          const t = cfg.delegate(tx);
          const creates = plans.filter((p) => p.action === 'create');
          if (creates.length) await t.createMany({ data: creates.map((p) => p.data) });
          for (const p of plans) if (p.action === 'update') await t.update({ where: { id: p.id }, data: p.data });
          await writeAudit(
            {
              action: 'CHANGE_MASTER_DATA',
              entityType: cfg.label,
              newData: {
                import: file.originalname,
                created: creates.map((p) => p.rec.code),
                updated: plans.filter((p) => p.action === 'update').map((p) => ({ code: p.rec.code, changes: p.changes })),
              },
            },
            tx,
          );
        },
        { timeout: 120_000 },
      );
      return { ...result, applied: true };
    },

    /** Import template (.xlsx): the import columns, an instructions sheet and – optionally – every existing record. */
    async template(withData: boolean): Promise<{ buffer: Buffer; fileName: string }> {
      const columns = MASTER_IMPORT_COLUMNS[entity];
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(cfg.label);
      ws.columns = columns.map((c) => ({
        header: c.header,
        key: c.field,
        width: c.field === 'name' ? 40 : 18,
        // Text format keeps codes such as 00123 exactly as typed.
        style: c.field === 'code' || c.field === 'bankCode' ? { numFmt: '@' } : {},
      }));
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      if (withData) {
        const rows = await cfg.delegate(prisma).findMany({ orderBy: { code: 'asc' }, ...include });
        for (const r of rows) {
          ws.addRow({
            code: r.code,
            name: r.name,
            status: statusText(r.status),
            bankCode: r.bank?.code,
            isSpecial: r.isSpecial === undefined ? undefined : r.isSpecial ? 'Yes' : 'No',
          });
        }
      }
      const help = wb.addWorksheet('Instructions');
      help.columns = [
        { header: 'Column', key: 'header', width: 26 },
        { header: 'Required', key: 'required', width: 10 },
        { header: 'Description', key: 'hint', width: 90 },
      ];
      help.getRow(1).font = { bold: true };
      for (const c of columns) help.addRow({ header: c.header, required: c.required ? 'Yes' : 'No', hint: c.hint });
      help.addRow({});
      help.addRow({ header: 'Notes', hint: 'Fill the first sheet from row 2. Rows are matched on the code: existing codes are updated, new codes are added.' });
      help.addRow({ hint: 'Records are never deleted by an import – set Status to Inactive instead. CSV files with the same headers also work.' });
      const stamp = new Date().toISOString().slice(0, 10);
      const fileName = `${cfg.label.toLowerCase()}-${withData ? `export-${stamp}` : 'import-template'}.xlsx`;
      return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName };
    },

    async update(id: string, input: z.infer<(typeof masterDataUpdateSchemas)[MasterDataEntity]>): Promise<MasterDataItem> {
      await assertBank((input as { bankId?: string }).bankId);
      return withTransaction(async (tx) => {
        const d = cfg.delegate(tx);
        const before = await d.findUnique({ where: { id }, ...include });
        if (!before) throw new NotFoundError(cfg.label);
        const data = { ...input, ...(input.code ? { code: input.code.toUpperCase() } : {}) };
        const row = await d.update({ where: { id }, data, ...include });
        await writeAudit(
          { action: 'CHANGE_MASTER_DATA', entityType: cfg.label, entityId: id, previousData: toDto(before), newData: toDto(row) },
          tx,
        );
        return toDto(row);
      });
    },
  };
}
