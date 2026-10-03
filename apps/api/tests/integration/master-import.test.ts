/**
 * CR3: Excel / CSV import of master data (farmers / customers = CV codes, lines, branches, accounts, …),
 * template download and the merged CV code.
 */
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MasterImportResult } from '@paragon/shared';
import { prisma } from '../../src/core/db.js';
import { api, bearer, login, resetDb } from '../helpers.js';

let admin: string, ff1: string;

beforeAll(async () => {
  await resetDb();
  [admin, ff1] = [await login('admin'), await login('ff1')];
});

async function xlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function upload(entity: string, file: Buffer, name: string, dryRun: boolean, token = admin) {
  return api().post(`/api/${entity}/import?dryRun=${dryRun}`).set(bearer(token)).attach('file', file, { filename: name });
}

describe('master-data import', () => {
  it('checks a farmer list first without writing anything, then imports it', async () => {
    const file = await xlsx([
      ['CV Code', 'Farmer / Customer Name', 'Status'],
      ['cv-90001', 'Rahim Poultry Farm', ''],
      ['CV-90002', 'Karim Dairy', 'Inactive'],
      ['P0001', 'Alpha Traders Ltd', ''], // existing farmer → renamed
      ['P0002', 'Beta Distributors', ''], // existing, identical → unchanged
    ]);
    const check = await upload('parties', file, 'farmers.xlsx', true);
    expect(check.status).toBe(200);
    const r = check.body.data as MasterImportResult;
    expect(r).toMatchObject({ dryRun: true, applied: false, totalRows: 4, created: 2, updated: 1, unchanged: 1, errors: [] });
    expect(r.preview.find((p) => p.code === 'P0001')?.changes).toEqual(['Name: Alpha Traders → Alpha Traders Ltd']);
    expect(await prisma.party.count({ where: { code: { in: ['CV-90001', 'CV-90002'] } } })).toBe(0);

    const run = await upload('parties', file, 'farmers.xlsx', false);
    expect(run.body.data).toMatchObject({ applied: true, created: 2, updated: 1 });
    expect(await prisma.party.findUnique({ where: { code: 'CV-90002' } })).toMatchObject({ name: 'Karim Dairy', status: 'INACTIVE' });
    expect((await prisma.party.findUnique({ where: { code: 'P0001' } }))?.name).toBe('Alpha Traders Ltd');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'CHANGE_MASTER_DATA', entityType: 'Party' }, orderBy: { createdAt: 'desc' } });
    expect(audit?.newData).toMatchObject({ import: 'farmers.xlsx', created: ['CV-90001', 'CV-90002'] });

    // The imported farmer can be found by its CV code in the farmer picker.
    const search = await api().get('/api/parties?q=90001&status=ACTIVE').set(bearer(ff1));
    expect(search.body.data.items[0]).toMatchObject({ code: 'CV-90001', name: 'Rahim Poultry Farm' });
  });

  it('imports nothing when any row has an error (all or nothing)', async () => {
    const file = await xlsx([
      ['Line Code', 'Line Name'],
      ['L50', 'Line 50'],
      ['L50', 'Duplicate'],
      ['', 'No code'],
    ]);
    const res = await upload('lines', file, 'lines.xlsx', false);
    const r = res.body.data as MasterImportResult;
    expect(r.applied).toBe(false);
    expect(r.errors.map((e) => e.row)).toEqual([3, 4]);
    expect(await prisma.line.count({ where: { code: 'L50' } })).toBe(0);
  });

  it('reads CSV and keeps leading zeros in codes', async () => {
    const csv = Buffer.from('﻿Branch Code,Branch Name\n007,Bogura\n');
    const res = await upload('branches', csv, 'branches.csv', false);
    expect(res.body.data).toMatchObject({ applied: true, created: 1 });
    expect((await prisma.branch.findUnique({ where: { code: '007' } }))?.name).toBe('Bogura');
  });

  it('accounts need an existing bank code', async () => {
    const file = await xlsx([
      ['Account Code', 'Account Name', 'Bank Code'],
      ['NCB-NEW-9', 'NCB New Account', 'ncb'],
      ['XX-1', 'Unknown bank', 'NOPE'],
    ]);
    const r = (await upload('accounts', file, 'accounts.xlsx', true)).body.data as MasterImportResult;
    expect(r.created).toBe(1);
    expect(r.errors).toEqual([{ row: 3, column: 'Bank Code', message: 'Bank NOPE does not exist' }]);
  });

  it('rejects other file types and non-administrators', async () => {
    expect((await upload('lines', Buffer.from('%PDF-1.4'), 'lines.pdf', true)).status).toBe(415);
    expect((await upload('lines', Buffer.from('not a zip'), 'lines.xlsx', true)).status).toBe(415);
    expect((await upload('lines', await xlsx([['Line Code', 'Line Name']]), 'l.xlsx', true, ff1)).status).toBe(403);
    expect((await api().post('/api/lines/import').set(bearer(admin))).status).toBe(400);
  });

  it('template download: headers + instructions, optionally with all current records', async () => {
    const res = await api().get('/api/parties/import-template?withData=true').set(bearer(admin)).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('party-export-');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).values).toEqual([undefined, 'CV Code', 'Farmer / Customer Name', 'Status']);
    expect(ws.rowCount).toBeGreaterThan(8);
    expect(wb.getWorksheet('Instructions')).toBeDefined();
    // The exported file imports back with no changes.
    const back = (await upload('parties', Buffer.from(await wb.xlsx.writeBuffer()), 'back.xlsx', true)).body.data as MasterImportResult;
    expect(back).toMatchObject({ created: 0, updated: 0, errors: [] });
  });
});
