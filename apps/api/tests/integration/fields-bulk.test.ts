/**
 * CR2: Line / Branch / CV code master data, bank details, Amount (CR) + bank charge at the final approval,
 * per-row actions in the review queue and bulk approve / reject.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { BulkActionResult, TransactionListItem } from '@paragon/shared';
import { prisma } from '../../src/core/db.js';
import { act, api, attachPdf, bearer, createDraft, getTx, login, resetDb, submitted } from '../helpers.js';

let ff1: string, ff2: string, sa: string, sa2: string, accountant: string, admin: string;

beforeAll(async () => {
  await resetDb();
  [ff1, ff2, sa, sa2, accountant, admin] = (await Promise.all(
    (['ff1', 'ff2', 'sa', 'sa2', 'accountant', 'admin'] as const).map((u) => login(u)),
  )) as [string, string, string, string, string, string];
});

/** Submitted by ff1 and approved by Sales Admin → FINANCE_REVIEW with the Accountant. */
async function inFinance(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = await submitted(ff1, overrides);
  const res = await act(sa, id, 'approve');
  expect(res.status).toBe(200);
  expect(res.body.data.transaction.status).toBe('FINANCE_REVIEW');
  return id;
}

async function queue(token: string): Promise<TransactionListItem[]> {
  const res = await api().get('/api/transactions?view=queue&limit=100').set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.data.items;
}

describe('line, branch and CV code master data', () => {
  it.each(['lines', 'branches', 'cv-codes'])('%s: listed for everyone, managed by administrators only', async (entity) => {
    expect((await api().get(`/api/${entity}`).set(bearer(ff1))).body.data.total).toBe(3);
    expect((await api().post(`/api/${entity}`).set(bearer(ff1)).send({ code: 'X1', name: 'X one' })).status).toBe(403);
    const created = await api().post(`/api/${entity}`).set(bearer(admin)).send({ code: 'x1', name: 'X one' });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('X1');
    const off = await api().patch(`/api/${entity}/${created.body.data.id}`).set(bearer(admin)).send({ status: 'INACTIVE' });
    expect(off.body.data.status).toBe('INACTIVE');
  });

  it('inactive entries cannot be chosen for a transaction', async () => {
    const inactive = await prisma.line.findUniqueOrThrow({ where: { code: 'X1' } });
    const doc = await prisma.wing.findUniqueOrThrow({ where: { code: 'DOC' } });
    const res = await api().post('/api/transactions').set(bearer(ff1)).send({ wingId: doc.id, lineId: inactive.id });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'lineId', message: 'Line is inactive' })]));
  });
});

describe('new transaction fields', () => {
  it('are stored, shown and searchable', async () => {
    const t = await createDraft(ff1, { bankDetails: 'Pubali Bank, Agrabad branch', remarks: 'Narration text' });
    expect(t.line?.code).toBe('L01');
    expect(t.branch?.code).toBe('DHK');
    expect(t.cvCode?.code).toBe('CV-1001');
    expect(t.bankDetails).toBe('Pubali Bank, Agrabad branch');
    expect(t.remarks).toBe('Narration text');
    expect(t.creditAmount).toBeNull();
    const found = await api().get('/api/transactions?q=Agrabad').set(bearer(ff1));
    expect(found.body.data.items.map((i: { id: string }) => i.id)).toContain(t.id);
  });

  it('line, branch, CV code and bank details are required to submit', async () => {
    const t = await createDraft(ff1, { lineId: null, branchId: null, cvCodeId: null, bankDetails: null });
    await attachPdf(ff1, t.id);
    const res = await act(ff1, t.id, 'submit');
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['lineId', 'branchId', 'cvCodeId', 'bankDetails']),
    );
  });
});

describe('Amount (CR) and bank charge at the final approval', () => {
  it('cannot be given by Sales Admin', async () => {
    const id = await submitted(ff1);
    const res = await act(sa, id, 'approve', { creditAmount: '10.00' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('creditAmount');
  });

  it('is required for the finance approval and may not exceed the deposit', async () => {
    const id = await inFinance({ amount: '5000.00' });
    const t = await getTx(accountant, id);
    const missing = await api().post(`/api/transactions/${id}/approve`).set(bearer(accountant)).send({ version: t.version });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details[0].path).toBe('creditAmount');
    const tooMuch = await act(accountant, id, 'approve', { creditAmount: '5000.01' });
    expect(tooMuch.status).toBe(422);
    expect((await getTx(accountant, id)).status).toBe('FINANCE_REVIEW');
  });

  it('bank charge = deposit − Amount (CR); stored, snapshotted and shown in history', async () => {
    const id = await inFinance({ amount: '5000.00' });
    const res = await act(accountant, id, 'approve', { creditAmount: '4975.50' });
    expect(res.status).toBe(200);
    const t = res.body.data.transaction;
    expect(t.status).toBe('READY_FOR_PROCESSING');
    expect(t.creditAmount).toBe('4975.50');
    expect(t.bankCharge).toBe('24.50');
    const row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id } });
    const snap = row.approvedSnapshot as { schemaVersion: number; approvedData: Record<string, unknown> };
    expect(snap.schemaVersion).toBe(2);
    expect(snap.approvedData).toMatchObject({ amount: '5000.00', creditAmount: '4975.50', bankCharge: '24.50', bankDetails: 'Sonali Bank, Motijheel branch' });
    expect(snap.approvedData.line).toMatchObject({ code: 'L01' });
    const history = await api().get(`/api/transactions/${id}/history`).set(bearer(accountant));
    const fin = history.body.data.find((h: { action: string }) => h.action === 'FINANCE_APPROVED');
    expect(fin.comment).toContain('Amount (CR) 4975.50');
  });

  it('equal amounts mean no bank charge', async () => {
    const id = await inFinance({ amount: '700.00' });
    const res = await act(accountant, id, 'approve', { creditAmount: '700' });
    expect(res.body.data.transaction.bankCharge).toBe('0.00');
  });
});

describe('review queue rows', () => {
  it('carry version, document count and the actions allowed to the reviewer', async () => {
    const id = await submitted(ff1);
    const row = (await queue(sa)).find((i) => i.id === id)!;
    expect(row.version).toBeGreaterThan(0);
    expect(row.attachmentCount).toBe(1);
    expect(row.allowedActions).toEqual(expect.arrayContaining(['SA_APPROVE', 'SA_REJECT']));
    // Only the queue view computes actions.
    const all = await api().get('/api/transactions').set(bearer(sa));
    expect(all.body.data.items[0].allowedActions).toBeUndefined();
  });
});

describe('bulk approve / reject', () => {
  it('approves each item on its own and reports failures per item', async () => {
    const [a, b, stale] = [await submitted(ff1), await submitted(ff1), await submitted(ff1)];
    const items = await Promise.all([a, b, stale].map(async (id) => ({ id, version: (await getTx(sa, id)).version })));
    items[2]!.version -= 1; // someone else changed it in the meantime
    const res = await api().post('/api/transactions/bulk-approve').set(bearer(sa)).send({ items, comment: 'Checked' });
    expect(res.status).toBe(200);
    const result = res.body.data as BulkActionResult;
    expect(result).toMatchObject({ succeeded: 2, failed: 1 });
    expect(result.results.find((r) => r.id === stale)).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
    expect(result.results.find((r) => r.id === a)).toMatchObject({ ok: true, status: 'FINANCE_REVIEW' });
    expect((await getTx(sa, stale)).status).toBe('SALES_ADMIN_REVIEW');
    const audit = await prisma.auditLog.findFirst({ where: { entityId: a, action: 'APPROVE_TRANSACTION' } });
    expect(audit?.newData).toMatchObject({ bulk: true });
  });

  it('finance bulk approval needs Amount (CR) per item', async () => {
    const [withCredit, without] = [await inFinance({ amount: '900.00' }), await inFinance()];
    const items = [
      { id: withCredit, version: (await getTx(accountant, withCredit)).version, creditAmount: '890.00' },
      { id: without, version: (await getTx(accountant, without)).version },
    ];
    const res = await api().post('/api/transactions/bulk-approve').set(bearer(accountant)).send({ items });
    const result = res.body.data as BulkActionResult;
    expect(result).toMatchObject({ succeeded: 1, failed: 1 });
    expect(result.results[1]).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Enter the amount credited by the bank' } });
    expect((await getTx(accountant, withCredit)).bankCharge).toBe('10.00');
  });

  it('never acts outside the reviewer’s scope, wings or permissions', async () => {
    const ownWing = await submitted(ff1);
    const feed = await submitted(ff2, { wingId: (await prisma.wing.findUniqueOrThrow({ where: { code: 'FEED' } })).id });
    const items = [
      { id: ownWing, version: (await getTx(sa, ownWing)).version },
      { id: feed, version: (await getTx(sa2, feed)).version },
    ];
    // Sales Admin One does not work on FEED: that item is not even visible to them.
    const res = await api().post('/api/transactions/bulk-reject').set(bearer(sa)).send({ items, reason: 'Wrong documents attached' });
    const result = res.body.data as BulkActionResult;
    expect(result.results[0]).toMatchObject({ ok: true, status: 'REJECTED' });
    expect(result.results[1]).toMatchObject({ ok: false, transactionNumber: null, error: { code: 'NOT_FOUND' } });
    expect((await getTx(sa2, feed)).status).toBe('SALES_ADMIN_REVIEW');
    // Field Force users cannot bulk-approve at all.
    expect((await api().post('/api/transactions/bulk-approve').set(bearer(ff1)).send({ items })).status).toBe(403);
  });

  it('validates the request', async () => {
    const id = await submitted(ff1);
    const one = { id, version: (await getTx(sa, id)).version };
    expect((await api().post('/api/transactions/bulk-reject').set(bearer(sa)).send({ items: [one], reason: 'no' })).status).toBe(400);
    expect((await api().post('/api/transactions/bulk-approve').set(bearer(sa)).send({ items: [one, one] })).status).toBe(400);
    expect((await api().post('/api/transactions/bulk-approve').set(bearer(sa)).send({ items: [] })).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, () => ({ id: crypto.randomUUID(), version: 1 }));
    expect((await api().post('/api/transactions/bulk-approve').set(bearer(sa)).send({ items: tooMany })).status).toBe(400);
  });
});
