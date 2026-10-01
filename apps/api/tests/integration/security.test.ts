import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db.js';
import { act, api, bearer, createDraft, getTx, login, resetDb, submitted } from '../helpers.js';

let ff1: string, ff2: string, sa: string, accountant: string, auditor: string, admin: string;

beforeAll(async () => {
  await resetDb();
  [ff1, ff2, sa, accountant, auditor, admin] = (await Promise.all((['ff1', 'ff2', 'sa', 'accountant', 'auditor', 'admin'] as const).map((u) => login(u)))) as [string, string, string, string, string, string];
});

describe('cross-user data isolation', () => {
  it('a field force user cannot read, edit or act on another user’s transaction (404, not 403)', async () => {
    const t = await createDraft(ff1);
    expect((await api().get(`/api/transactions/${t.id}`).set(bearer(ff2))).status).toBe(404);
    expect((await api().get(`/api/transactions/${t.id}/history`).set(bearer(ff2))).status).toBe(404);
    expect((await api().patch(`/api/transactions/${t.id}`).set(bearer(ff2)).send({ version: 1, remarks: 'x' })).status).toBe(404);
    expect((await api().post(`/api/transactions/${t.id}/submit`).set(bearer(ff2)).send({ version: 1 })).status).toBe(404);
    const list = await api().get('/api/transactions').set(bearer(ff2));
    expect(list.body.data.items.map((i: { id: string }) => i.id)).not.toContain(t.id);
  });

  it('Sales Admin cannot see other users’ drafts', async () => {
    const t = await createDraft(ff1);
    expect((await api().get(`/api/transactions/${t.id}`).set(bearer(sa))).status).toBe(404);
  });

  it('Accountant cannot see transactions still at Sales Admin stage', async () => {
    const id = await submitted(ff1);
    expect((await api().get(`/api/transactions/${id}`).set(bearer(accountant))).status).toBe(404);
  });

  it('Auditor sees everything but cannot change anything', async () => {
    const t = await createDraft(ff1);
    expect((await api().get(`/api/transactions/${t.id}`).set(bearer(auditor))).status).toBe(200);
    expect((await api().post('/api/transactions').set(bearer(auditor)).send({})).status).toBe(403);
    expect((await api().patch(`/api/transactions/${t.id}`).set(bearer(auditor)).send({ version: 1, remarks: 'x' })).status).toBe(403);
    expect((await api().post('/api/banks').set(bearer(auditor)).send({ code: 'X', name: 'X' })).status).toBe(403);
    expect((await api().get('/api/audit-logs').set(bearer(auditor))).status).toBe(200);
  });
});

describe('status can never be set directly', () => {
  it('rejects status / workflow fields on create and update', async () => {
    const create = await api().post('/api/transactions').set(bearer(ff1)).send({ status: 'READY_FOR_PROCESSING' });
    expect(create.status).toBe(400);
    const t = await createDraft(ff1);
    for (const field of ['status', 'assignedRoleId', 'finalApprovedAt', 'createdById', 'transactionNumber']) {
      const res = await api().patch(`/api/transactions/${t.id}`).set(bearer(ff1)).send({ version: 1, [field]: 'x' });
      expect(res.status, field).toBe(400);
    }
    expect((await getTx(ff1, t.id)).status).toBe('DRAFT');
  });
});

describe('role restrictions', () => {
  it.each([
    ['ff1', 'get', '/api/users'],
    ['ff1', 'get', '/api/audit-logs'],
    ['ff1', 'get', '/api/workflow/rules'],
    ['ff1', 'get', '/api/reports/sales'],
    ['sa', 'get', '/api/audit-logs'],
    ['sa', 'get', '/api/reports/audit'],
    ['accountant', 'post', '/api/roles'],
    ['auditor', 'patch', '/api/system-settings/business.currency'],
  ] as const)('%s cannot %s %s', async (who, method, url) => {
    const token = { ff1, sa, accountant, auditor }[who];
    const res = await api()[method](url).set(bearer(token)).send({});
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('Sales Admin cannot edit fields outside the configured list', async () => {
    const id = await submitted(ff1);
    const t = await getTx(sa, id);
    expect(t.editableFields).not.toContain('amount');
    const res = await api().patch(`/api/transactions/${id}`).set(bearer(sa)).send({ version: t.version, amount: '1.00' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FIELD_NOT_EDITABLE');
  });

  it('a user with SALES_ADMIN_APPROVE cannot approve their own transaction', async () => {
    // Give the admin user the Field Force role plus Sales Admin permissions via a custom role.
    const role = await api()
      .post('/api/roles')
      .set(bearer(admin))
      .send({ code: 'FF_AND_SA', name: 'FF + SA', permissions: ['SALES_CREATE', 'SALES_EDIT', 'SALES_SUBMIT', 'SALES_VIEW_OWN', 'SALES_ADMIN_REVIEW', 'SALES_ADMIN_APPROVE'] });
    expect(role.status).toBe(201);
    const ff2User = await prisma.user.findUniqueOrThrow({ where: { email: 'ff2@paragon.local' } });
    await api().patch(`/api/users/${ff2User.id}`).set(bearer(admin)).send({ roleIds: [role.body.data.id] });
    const relog = await api().post('/api/auth/login').send({ email: 'ff2@paragon.local', password: 'Paragon@Dev2026' });
    const token = relog.body.data.accessToken as string;
    const id = await submitted(token);
    const res = await act(token, id, 'approve');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('users cannot change their own roles or disable themselves', async () => {
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@paragon.local' } });
    expect((await api().patch(`/api/users/${adminUser.id}`).set(bearer(admin)).send({ status: 'DISABLED' })).status).toBe(403);
    expect((await api().patch(`/api/users/${adminUser.id}`).set(bearer(admin)).send({ roleIds: [] })).status).toBe(400);
  });

  it('the ADMIN role permissions are locked', async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const res = await api().patch(`/api/roles/${adminRole.id}`).set(bearer(admin)).send({ permissions: ['USER_VIEW'] });
    expect(res.status).toBe(422);
  });
});

describe('append-only records', () => {
  it('audit logs, approval records and history cannot be updated or deleted at DB level', async () => {
    const id = await submitted(ff1);
    await act(sa, id, 'approve');
    await expect(prisma.auditLog.updateMany({ data: { action: 'TAMPERED' } })).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow();
    await expect(prisma.approvalRecord.updateMany({ data: { reason: 'x' } })).rejects.toThrow();
    await expect(prisma.salesTransactionHistory.deleteMany({ where: { transactionId: id } })).rejects.toThrow();
    await expect(prisma.workflowAction.deleteMany({})).rejects.toThrow();
  });

  it('the API exposes no audit mutation endpoints', async () => {
    expect((await api().delete('/api/audit-logs').set(bearer(admin))).status).toBe(404);
    expect((await api().patch('/api/audit-logs/x').set(bearer(admin)).send({})).status).toBe(404);
  });
});

describe('responses', () => {
  it('never leak stack traces and always carry a request id', async () => {
    const res = await api().post('/api/transactions').set(bearer(ff1)).set('Content-Type', 'application/json').send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.requestId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('sets security headers', async () => {
    const res = await api().get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
