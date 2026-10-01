/**
 * Critical workflow (spec §41):
 * create → submit → SA receives → SA approves → correct finance role receives → finance approves →
 * READY_FOR_PROCESSING; finance return → FF corrects → resubmits; history intact; no self-approval;
 * unauthorized users cannot approve; concurrent updates conflict.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db.js';
import { DEV_PASSWORD } from '../../prisma/seed-data.js';
import { act, api, attachPdf, bearer, clearTokens, createDraft, getTx, login, refs, resetDb, submitted } from '../helpers.js';

let ff: string, sa: string, sa2: string, accountant: string, treasury: string, auditor: string, admin: string;

beforeAll(async () => {
  await resetDb();
  [ff, sa, sa2, accountant, treasury, auditor, admin] = await Promise.all([
    login('ff1'),
    login('sa'),
    login('sa2'),
    login('accountant'),
    login('treasury'),
    login('auditor'),
    login('admin'),
  ]);
});

describe('happy path to READY_FOR_PROCESSING', () => {
  let id: string;
  let amount: string;

  it('field force creates a draft with a human-readable number', async () => {
    const t = await createDraft(ff);
    id = t.id;
    amount = t.amount!;
    expect(t.status).toBe('DRAFT');
    expect(t.transactionNumber).toMatch(/^SAL-\d{4}-\d{6}$/);
    expect(t.version).toBe(1);
    expect(t.allowedActions).toEqual(expect.arrayContaining(['SUBMIT', 'EDIT', 'CANCEL']));
  });

  it('cannot submit without the mandatory supporting document', async () => {
    const res = await act(ff, id, 'submit');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(res.body.error.message).toContain('Supporting Document');
  });

  it('submits after attaching a document; Sales Admins are notified', async () => {
    await attachPdf(ff, id);
    const res = await act(ff, id, 'submit');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Transaction submitted for review');
    expect(res.body.data.transaction.status).toBe('SALES_ADMIN_REVIEW');
    const saUser = await prisma.user.findUniqueOrThrow({ where: { email: 'salesadmin@paragon.local' } });
    expect(await prisma.notification.count({ where: { userId: saUser.id, type: 'REVIEW_REQUIRED', entityId: id } })).toBe(1);
  });

  it('appears in the Sales Admin queue but not in the accountant queue', async () => {
    const q = await api().get('/api/transactions?view=queue').set(bearer(sa));
    expect(q.body.data.items.map((t: { id: string }) => t.id)).toContain(id);
    const aq = await api().get('/api/transactions?view=queue').set(bearer(accountant));
    expect(aq.body.data.items.map((t: { id: string }) => t.id)).not.toContain(id);
  });

  it('field force cannot approve their own transaction', async () => {
    const res = await act(ff, id, 'approve');
    expect(res.status).toBe(403);
  });

  it('Sales Admin approves; default rule routes CASH to Accountant', async () => {
    const res = await act(sa, id, 'approve', { comment: 'Looks good' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Transaction approved successfully');
    const t = res.body.data.transaction;
    expect(t.status).toBe('FINANCE_REVIEW');
    expect(t.assignedRole.code).toBe('ACCOUNTANT');
  });

  it('Treasury cannot see or approve an Accountant-routed transaction', async () => {
    const res = await act(treasury, id, 'approve');
    expect(res.status).toBe(404);
  });

  it('Auditor cannot approve (read-only)', async () => {
    const res = await act(auditor, id, 'approve');
    expect(res.status).toBe(403);
  });

  it('Accountant gives final approval → READY_FOR_PROCESSING with snapshot and outbox event', async () => {
    const res = await act(accountant, id, 'approve');
    expect(res.status).toBe(200);
    expect(res.body.data.transaction.status).toBe('READY_FOR_PROCESSING');
    expect(res.body.data.transaction.finalApprovedAt).toBeTruthy();

    const row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id } });
    const snap = row.approvedSnapshot as { approvedData: { amount: string }; approvalHistory: unknown[]; attachments: unknown[] };
    expect(snap.approvedData.amount).toBe(amount);
    expect(snap.approvalHistory).toHaveLength(2);
    expect(snap.attachments).toHaveLength(1);
    expect(await prisma.domainEvent.count({ where: { aggregateId: id, eventType: 'TRANSACTION_READY_FOR_PROCESSING' } })).toBe(1);
    expect(await prisma.approvalRecord.count({ where: { transactionId: id } })).toBe(2);
  });

  it('a final transaction cannot be edited or approved again', async () => {
    const t = await getTx(accountant, id);
    expect(t.allowedActions).toEqual([]);
    expect((await act(accountant, id, 'approve')).status).toBe(422);
    const patch = await api().patch(`/api/transactions/${id}`).set(bearer(ff)).send({ version: t.version, remarks: 'x' });
    expect(patch.status).toBe(422);
  });

  it('records a complete timeline and audit trail', async () => {
    const h = await api().get(`/api/transactions/${id}/history`).set(bearer(ff));
    expect(h.status).toBe(200);
    expect(h.body.data.map((e: { action: string }) => e.action)).toEqual([
      'CREATED',
      'ATTACHMENT_ADDED',
      'SUBMITTED',
      'SALES_ADMIN_APPROVED',
      'FINANCE_APPROVED',
    ]);
    const audit = await prisma.auditLog.findMany({ where: { entityId: id }, select: { action: true } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['CREATE_TRANSACTION', 'UPLOAD_ATTACHMENT', 'SUBMIT_TRANSACTION', 'APPROVE_TRANSACTION']),
    );
  });
});

describe('routing to Treasury', () => {
  it('high-value transactions go to Treasury, and only Treasury can approve', async () => {
    const id = await submitted(ff, { amount: '2500000.00' });
    const res = await act(sa, id, 'approve');
    expect(res.body.data.transaction.assignedRole.code).toBe('TREASURY');
    expect((await act(accountant, id, 'approve')).status).toBe(404);
    expect((await act(treasury, id, 'approve')).status).toBe(200);
  });

  it('corporate sales go to Treasury; special sales go to Accountant', async () => {
    const r = await refs();
    const corp = await submitted(ff, { salesTypeId: r.corporate.id });
    expect((await act(sa, corp, 'approve')).body.data.transaction.assignedRole.code).toBe('TREASURY');
    const special = await submitted(ff, { salesTypeId: r.special.id, amount: '9000000.00' });
    expect((await act(sa, special, 'approve')).body.data.transaction.assignedRole.code).toBe('ACCOUNTANT');
  });
});

describe('return for correction and resubmission', () => {
  let id: string;

  it('finance returns with a category; field force sees CORRECTION_REQUIRED + reason', async () => {
    id = await submitted(ff);
    await act(sa, id, 'approve');
    const missing = await act(accountant, id, 'return', { reason: 'Account information requires correction' });
    expect(missing.status).toBe(400);

    const res = await act(accountant, id, 'return', {
      reason: 'Account information requires correction',
      correctionCategory: 'ACCOUNT_ERROR',
    });
    expect(res.status).toBe(200);
    const t = await getTx(ff, id);
    expect(t.status).toBe('CORRECTION_REQUIRED');
    expect(t.correctionCategory).toBe('ACCOUNT_ERROR');
    expect(t.rejectionReason).toBe('Account information requires correction');
    expect(t.allowedActions).toEqual(expect.arrayContaining(['RESUBMIT', 'EDIT']));
    const ffUser = await prisma.user.findUniqueOrThrow({ where: { email: 'ff1@paragon.local' } });
    expect(await prisma.notification.count({ where: { userId: ffUser.id, type: 'CORRECTION_REQUIRED', entityId: id } })).toBe(1);
  });

  it('field force corrects and resubmits; it goes back through Sales Admin (cycle 2)', async () => {
    const r = await refs();
    const t = await getTx(ff, id);
    const patch = await api()
      .patch(`/api/transactions/${id}`)
      .set(bearer(ff))
      .send({ version: t.version, bankId: r.mtb.id, accountId: r.mtbAcc.id });
    expect(patch.status).toBe(200);
    const res = await act(ff, id, 'resubmit');
    expect(res.status).toBe(200);
    expect(res.body.data.transaction.status).toBe('SALES_ADMIN_REVIEW');
    expect(res.body.data.transaction.rejectionReason).toBeNull();
    const wf = await prisma.workflowInstance.findUniqueOrThrow({ where: { transactionId: id } });
    expect(wf.cycle).toBe(2);
  });

  it('history keeps every step; approval records of cycle 1 are untouched', async () => {
    await act(sa, id, 'approve');
    await act(accountant, id, 'approve');
    const h = await api().get(`/api/transactions/${id}/history`).set(bearer(ff));
    const actions = h.body.data.map((e: { action: string }) => e.action);
    expect(actions).toEqual([
      'CREATED',
      'ATTACHMENT_ADDED',
      'SUBMITTED',
      'SALES_ADMIN_APPROVED',
      'FINANCE_RETURNED',
      'UPDATED',
      'RESUBMITTED',
      'SALES_ADMIN_APPROVED',
      'FINANCE_APPROVED',
    ]);
    const updated = h.body.data.find((e: { action: string }) => e.action === 'UPDATED');
    expect(updated.changes.bankId).toEqual({ from: 'NCB – National Commercial Bank', to: 'MTB – Metro Trust Bank' });
    const records = await prisma.approvalRecord.findMany({ where: { transactionId: id }, orderBy: { createdAt: 'asc' } });
    expect(records.map((r) => `${r.cycle}:${r.stage}:${r.decision}`)).toEqual([
      '1:SALES_ADMIN:APPROVED',
      '1:FINANCE:RETURNED',
      '2:SALES_ADMIN:APPROVED',
      '2:FINANCE:APPROVED',
    ]);
  });

  it('Sales Admin reject is terminal and requires a reason', async () => {
    const rid = await submitted(ff);
    expect((await act(sa, rid, 'reject', {})).status).toBe(400);
    const res = await act(sa, rid, 'reject', { reason: 'Not a valid sale' });
    expect(res.body.data.transaction.status).toBe('REJECTED');
    expect((await act(ff, rid, 'resubmit')).status).toBe(422);
  });
});

describe('concurrency', () => {
  it('a stale version is rejected with 409', async () => {
    const t = await createDraft(ff);
    const first = await api().patch(`/api/transactions/${t.id}`).set(bearer(ff)).send({ version: 1, remarks: 'first' });
    expect(first.status).toBe(200);
    expect(first.body.data.version).toBe(2);
    const stale = await api().patch(`/api/transactions/${t.id}`).set(bearer(ff)).send({ version: 1, remarks: 'second' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('two reviewers acting at the same time: exactly one wins', async () => {
    const id = await submitted(ff);
    const { version } = await getTx(sa, id);
    const [a, b] = await Promise.all([
      api().post(`/api/transactions/${id}/approve`).set(bearer(sa)).send({ version }),
      api().post(`/api/transactions/${id}/return`).set(bearer(sa2)).send({ version, reason: 'Wrong amount entered', correctionCategory: 'AMOUNT_ERROR' }),
    ]);
    // The loser gets 409 (stale version) or 404 (the transaction already left their review scope).
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    expect([409, 404]).toContain(a.status === 200 ? b.status : a.status);
    expect(await prisma.approvalRecord.count({ where: { transactionId: id } })).toBe(1);
  });

  it('reviewer edits conflict with a concurrent owner edit attempt', async () => {
    const id = await submitted(ff);
    const t = await getTx(sa, id);
    const saEdit = await api().patch(`/api/transactions/${id}`).set(bearer(sa)).send({ version: t.version, remarks: 'Checked by SA' });
    expect(saEdit.status).toBe(200);
    const ffEdit = await api().patch(`/api/transactions/${id}`).set(bearer(ff)).send({ version: t.version, remarks: 'Mine' });
    expect(ffEdit.status).toBe(409);
  });
});

describe('segregation of duties and claims', () => {
  it('the Sales Admin approver cannot also give final approval', async () => {
    // Give the Sales Admin user the Accountant role too.
    const saUser = await prisma.user.findUniqueOrThrow({ where: { email: 'salesadmin2@paragon.local' } });
    const acc = await prisma.role.findUniqueOrThrow({ where: { code: 'ACCOUNTANT' } });
    const saRole = await prisma.role.findUniqueOrThrow({ where: { code: 'SALES_ADMIN' } });
    const upd = await api().patch(`/api/users/${saUser.id}`).set(bearer(admin)).send({ roleIds: [saRole.id, acc.id] });
    expect(upd.status).toBe(200);
    // Role change bumps the token version, so sign in again (bypassing the helper's token cache).
    const fresh = await api().post('/api/auth/login').send({ email: 'salesadmin2@paragon.local', password: DEV_PASSWORD });
    const token: string = fresh.body.data.accessToken;
    clearTokens();

    const id = await submitted(ff);
    expect((await act(token, id, 'approve')).status).toBe(200);
    const res = await act(token, id, 'approve');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await act(accountant, id, 'approve')).status).toBe(200);
  });

  it('a claimed transaction can only be actioned by the claimer', async () => {
    const id = await submitted(ff);
    const claim = await act(sa, id, 'claim');
    expect(claim.status).toBe(200);
    expect(claim.body.data.assignedUser.email).toBe('salesadmin@paragon.local');
    const other = await act(await login('sa2'), id, 'approve');
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('CLAIMED_BY_OTHER');
    expect((await act(sa, id, 'release')).status).toBe(200);
    expect((await act(await login('sa2'), id, 'approve')).status).toBe(200);
  });

  it('owner can cancel a draft; cancelled is terminal', async () => {
    const t = await createDraft(ff);
    const res = await act(ff, t.id, 'cancel');
    expect(res.body.data.transaction.status).toBe('CANCELLED');
    expect((await act(ff, t.id, 'submit')).status).toBe(422);
  });
});
