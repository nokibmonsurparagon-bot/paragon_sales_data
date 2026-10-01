import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db.js';
import { act, api, bearer, createDraft, login, refs, resetDb, submitted } from '../helpers.js';

let ff1: string, sa: string, accountant: string, auditor: string, admin: string;

beforeAll(async () => {
  await resetDb();
  [ff1, sa, accountant, auditor, admin] = (await Promise.all((['ff1', 'sa', 'accountant', 'auditor', 'admin'] as const).map((u) => login(u)))) as [string, string, string, string, string];
});

describe('master data', () => {
  it('admin creates and updates banks/accounts; duplicate codes conflict; changes are audited', async () => {
    const bank = await api().post('/api/banks').set(bearer(admin)).send({ code: 'tst', name: 'Test Bank' });
    expect(bank.status).toBe(201);
    expect(bank.body.data.code).toBe('TST');
    expect((await api().post('/api/banks').set(bearer(admin)).send({ code: 'TST', name: 'Again' })).status).toBe(409);

    const acc = await api().post('/api/accounts').set(bearer(admin)).send({ code: 'TST-1', name: 'Test Account', bankId: bank.body.data.id });
    expect(acc.status).toBe(201);
    const filtered = await api().get(`/api/accounts?bankId=${bank.body.data.id}`).set(bearer(ff1));
    expect(filtered.body.data.items).toHaveLength(1);

    const upd = await api().patch(`/api/banks/${bank.body.data.id}`).set(bearer(admin)).send({ status: 'INACTIVE' });
    expect(upd.body.data.status).toBe('INACTIVE');
    expect(await prisma.auditLog.count({ where: { action: 'CHANGE_MASTER_DATA' } })).toBe(3);
  });

  it('inactive master data cannot be used on new transactions; account must match bank', async () => {
    const r = await refs();
    const inactive = await prisma.bank.findUniqueOrThrow({ where: { code: 'TST' } });
    const res = await api().post('/api/transactions').set(bearer(ff1)).send({ wingId: r.doc.id, bankId: inactive.id });
    expect(res.status).toBe(400);
    const mismatch = await api().post('/api/transactions').set(bearer(ff1)).send({ wingId: r.doc.id, bankId: r.ncb.id, accountId: r.mtbAcc.id });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.details[0].message).toContain('does not belong');
  });
});

describe('validation', () => {
  it('rejects future dates and bad amounts', async () => {
    const wingId = (await refs()).doc.id;
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await api().post('/api/transactions').set(bearer(ff1)).send({ wingId, transactionDate: future })).status).toBe(422);
    expect((await api().post('/api/transactions').set(bearer(ff1)).send({ wingId, amount: '-5' })).status).toBe(400);
    expect((await api().post('/api/transactions').set(bearer(ff1)).send({ wingId, amount: '1.999' })).status).toBe(400);
    expect((await api().post('/api/transactions').set(bearer(ff1)).send({ wingId, amount: '200000000.00' })).status).toBe(422);
  });
});

describe('workflow rules administration', () => {
  it('keeps a catch-all rule, validates target role, and simulates routing', async () => {
    const rules = await api().get('/api/workflow/rules').set(bearer(admin));
    const def = rules.body.data.find((r: { name: string }) => r.name.startsWith('Default'));
    const off = await api().patch(`/api/workflow/rules/${def.id}`).set(bearer(admin)).send({ isActive: false });
    expect(off.status).toBe(422);
    expect(off.body.error.code).toBe('DEFAULT_RULE_REQUIRED');

    const fieldForceRole = await prisma.role.findUniqueOrThrow({ where: { code: 'FIELD_FORCE' } });
    const bad = await api()
      .post('/api/workflow/rules')
      .set(bearer(admin))
      .send({ name: 'Bad', priority: 5, conditions: {}, targetRoleId: fieldForceRole.id });
    expect(bad.status).toBe(400);

    const r = await refs();
    const treasury = await prisma.role.findUniqueOrThrow({ where: { code: 'TREASURY' } });
    const created = await api()
      .post('/api/workflow/rules')
      .set(bearer(admin))
      .send({ name: 'Beta Distributors → Treasury', priority: 5, conditions: { partyIds: [r.beta.id] }, targetRoleId: treasury.id });
    expect(created.status).toBe(201);

    const sim = await api()
      .post('/api/workflow/rules/simulate')
      .set(bearer(admin))
      .send({ salesTypeId: r.cash.id, partyId: r.beta.id, amount: '10.00' });
    expect(sim.body.data.rule.targetRole.code).toBe('TREASURY');

    const id = await submitted(ff1, { partyId: r.beta.id });
    expect((await act(sa, id, 'approve')).body.data.transaction.assignedRole.code).toBe('TREASURY');
    expect(await prisma.auditLog.count({ where: { action: 'CHANGE_WORKFLOW_RULE' } })).toBe(1);
  });
});

describe('business rules and settings', () => {
  it('rule params are validated per type and changes take effect', async () => {
    const bad = await api().post('/api/business-rules').set(bearer(admin)).send({ name: 'x', type: 'MIN_AMOUNT', params: { amt: 1 }, trigger: 'SAVE' });
    expect(bad.status).toBe(400);
    const ok = await api()
      .post('/api/business-rules')
      .set(bearer(admin))
      .send({ name: 'Minimum 10', type: 'MIN_AMOUNT', params: { amount: '10.00' }, trigger: 'SAVE' });
    expect(ok.status).toBe(201);
    const res = await api().post('/api/transactions').set(bearer(ff1)).send({ wingId: (await refs()).doc.id, amount: '5.00' });
    expect(res.status).toBe(422);
    await api().patch(`/api/business-rules/${ok.body.data.id}`).set(bearer(admin)).send({ isActive: false });
    expect((await api().post('/api/transactions').set(bearer(ff1)).send({ wingId: (await refs()).doc.id, amount: '5.00' })).status).toBe(201);
  });

  it('settings are validated and audited', async () => {
    expect((await api().patch('/api/system-settings/business.currency').set(bearer(admin)).send({ value: 'dollars' })).status).toBe(400);
    expect((await api().patch('/api/system-settings/unknown.key').set(bearer(admin)).send({ value: 1 })).status).toBe(404);
    const res = await api().patch('/api/system-settings/business.currency').set(bearer(admin)).send({ value: 'EUR' });
    expect(res.status).toBe(200);
    const cfg = await api().get('/api/config/client').set(bearer(ff1));
    expect(cfg.body.data.currency).toBe('EUR');
    expect(await prisma.auditLog.count({ where: { action: 'CHANGE_SYSTEM_SETTING' } })).toBe(1);
  });
});

describe('search, filter, sort, paginate', () => {
  it('paginates server-side and searches by number, reference, party and amount', async () => {
    for (let i = 0; i < 3; i++) await createDraft(ff1, { amount: `${100 + i}.00`, paymentReference: `SRCH-${i}` });
    const page = await api().get('/api/transactions?page=1&limit=2&sort=amount:desc').set(bearer(ff1));
    expect(page.body.data.items).toHaveLength(2);
    expect(page.body.data.total).toBeGreaterThanOrEqual(3);
    expect(Number(page.body.data.items[0].amount)).toBeGreaterThanOrEqual(Number(page.body.data.items[1].amount));

    const byRef = await api().get('/api/transactions?q=srch-1').set(bearer(ff1));
    expect(byRef.body.data.items).toHaveLength(1);
    const byAmount = await api().get('/api/transactions?q=102.00').set(bearer(ff1));
    expect(byAmount.body.data.items.map((i: { amount: string }) => i.amount)).toContain('102.00');
    const byParty = await api().get('/api/transactions?q=alpha').set(bearer(ff1));
    expect(byParty.body.data.total).toBeGreaterThan(0);
    const num = page.body.data.items[0].transactionNumber;
    expect((await api().get(`/api/transactions?q=${num}`).set(bearer(ff1))).body.data.items[0].transactionNumber).toBe(num);

    const filtered = await api().get('/api/transactions?status=DRAFT&amountMin=101&amountMax=101.99').set(bearer(ff1));
    expect(filtered.body.data.items.every((i: { amount: string }) => i.amount === '101.00')).toBe(true);
    expect((await api().get('/api/transactions?limit=1000').set(bearer(ff1))).status).toBe(400);
    expect((await api().get('/api/transactions?status=BOGUS').set(bearer(ff1))).status).toBe(400);
  });
});

describe('dashboard, notifications, reports, audit', () => {
  it('dashboards are role-specific', async () => {
    const ffDash = await api().get('/api/dashboard/summary').set(bearer(ff1));
    expect(ffDash.body.data.sections.map((s: { key: string }) => s.key)).toEqual(['field-force']);
    const saDash = await api().get('/api/dashboard/summary').set(bearer(sa));
    // Sales Admin One works on two wings (DOC, CBF), so a per-wing section is added.
    expect(saDash.body.data.sections.map((s: { key: string }) => s.key)).toEqual(['sales-admin', 'wings']);
    const accDash = await api().get('/api/dashboard/summary').set(bearer(accountant));
    expect(accDash.body.data.sections[0].title).toBe('Accountant');
    const adminDash = await api().get('/api/dashboard/summary').set(bearer(admin));
    const overview = adminDash.body.data.sections.find((s: { key: string }) => s.key === 'overview');
    expect(overview.widgets.map((w: { key: string }) => w.key)).toEqual(
      expect.arrayContaining(['total', 'pending-sa', 'pending-finance', 'ready', 'rejected', 'correction', 'users']),
    );
    expect(adminDash.body.data.recentActivity.length).toBeGreaterThan(0);
  });

  it('notifications: list, unread count, mark read, only own', async () => {
    const list = await api().get('/api/notifications').set(bearer(sa));
    expect(list.body.data.total).toBeGreaterThan(0);
    const count = await api().get('/api/notifications/unread-count').set(bearer(sa));
    expect(count.body.data.count).toBeGreaterThan(0);
    const n = list.body.data.items[0];
    expect((await api().post(`/api/notifications/${n.id}/read`).set(bearer(ff1))).status).toBe(404);
    expect((await api().post(`/api/notifications/${n.id}/read`).set(bearer(sa))).body.data.isRead).toBe(true);
    await api().post('/api/notifications/read-all').set(bearer(sa));
    expect((await api().get('/api/notifications/unread-count').set(bearer(sa))).body.data.count).toBe(0);
  });

  it('reports respect scope; exports stream CSV/XLSX and are audited', async () => {
    const sales = await api().get('/api/reports/sales?limit=5').set(bearer(sa));
    expect(sales.status).toBe(200);
    expect(sales.body.data.columns.length).toBeGreaterThan(5);
    const drafts = sales.body.data.rows.filter((r: { status: string }) => r.status === 'Draft');
    expect(drafts).toHaveLength(0); // SA cannot see drafts

    const csv = await api().get('/api/reports/approvals/export?format=csv').set(bearer(sa));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\r\n')[0]).toContain('Transaction No.');

    const xlsx = await api()
      .get('/api/reports/rejections/export?format=xlsx')
      .set(bearer(auditor))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    expect((await api().get('/api/reports/audit').set(bearer(auditor))).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'EXPORT_REPORT' } })).toBe(2);
  });

  it('audit log is filterable and includes request ids', async () => {
    const res = await api().get('/api/audit-logs?action=LOGIN&limit=5').set(bearer(auditor));
    expect(res.status).toBe(200);
    expect(res.body.data.items.every((a: { action: string }) => a.action === 'LOGIN')).toBe(true);
    expect(res.body.data.items[0].requestId).toBeTruthy();
  });

  it('serves the OpenAPI document in development', async () => {
    const res = await api().get('/api/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.paths['/transactions/{id}/approve']).toBeDefined();
  });
});
