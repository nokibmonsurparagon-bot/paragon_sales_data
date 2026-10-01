import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db.js';
import { act, api, attachPdf, bearer, createDraft, getTx, login, resetDb, submitted, validBody } from '../helpers.js';

let ff1: string, ff2: string, sa: string, accountant: string;

beforeAll(async () => {
  await resetDb();
  [ff1, ff2, sa, accountant] = (await Promise.all((['ff1', 'ff2', 'sa', 'accountant'] as const).map((u) => login(u)))) as [string, string, string, string];
});

describe('duplicate detection', () => {
  it('flags an exact duplicate on submit, warns, blocks approval until resolved', async () => {
    const body = await validBody({ paymentReference: 'DUP-REF-001', amount: '777.00' });
    const first = await submitted(ff1, body);
    const second = await submitted(ff2, body);

    const t = await getTx(sa, second);
    expect(t.duplicateStatus).toBe('EXACT_DUPLICATE');
    expect(t.duplicateOf?.id).toBe(first);
    expect(t.duplicateResolution).toBe('PENDING');
    expect(t.allowedActions).toContain('RESOLVE_DUPLICATE');
    expect(t.allowedActions).not.toContain('SA_APPROVE');

    const blocked = await act(sa, second, 'approve');
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('DUPLICATE_UNRESOLVED');

    const candidates = await api().get(`/api/transactions/${second}/duplicates`).set(bearer(sa));
    expect(candidates.body.data[0]).toMatchObject({ id: first, classification: 'EXACT_DUPLICATE' });

    const resolve = await api()
      .post(`/api/transactions/${second}/duplicates/resolve`)
      .set(bearer(sa))
      .send({ version: t.version, resolution: 'NOT_DUPLICATE', note: 'Two separate cheques confirmed with customer' });
    expect(resolve.status).toBe(200);
    expect((await act(sa, second, 'approve')).status).toBe(200);

    const audit = await prisma.auditLog.count({ where: { action: 'RESOLVE_DUPLICATE', entityId: second } });
    expect(audit).toBe(1);
  });

  it('possible duplicates warn but do not block', async () => {
    const r = await validBody({ amount: '4321.00' });
    await submitted(ff1, r);
    const res2 = await createDraft(ff2, { ...r, paymentReference: 'OTHER-REF-9' });
    await attachPdf(ff2, res2.id);
    const sub = await act(ff2, res2.id, 'submit');
    expect(sub.status).toBe(200);
    expect(sub.body.data.warnings.join(' ')).toMatch(/duplicate/i);
    const t = await getTx(sa, res2.id);
    expect(t.duplicateStatus).toBe('POSSIBLE_DUPLICATE');
    expect((await act(sa, res2.id, 'approve')).status).toBe(200);
  });

  it('confirmed duplicates cannot be approved (must be rejected)', async () => {
    const body = await validBody({ paymentReference: 'DUP-REF-002', amount: '12.00' });
    await submitted(ff1, body);
    const dup = await submitted(ff1, body);
    const t = await getTx(sa, dup);
    await api()
      .post(`/api/transactions/${dup}/duplicates/resolve`)
      .set(bearer(sa))
      .send({ version: t.version, resolution: 'CONFIRMED_DUPLICATE', note: 'Same cheque entered twice' });
    expect((await act(sa, dup, 'approve')).body.error.code).toBe('DUPLICATE_CONFIRMED');
    expect((await act(sa, dup, 'reject', { reason: 'Duplicate entry' })).status).toBe(200);
  });
});

describe('attachments', () => {
  it('rejects files whose content is not an allowed type, or whose extension lies', async () => {
    const t = await createDraft(ff1);
    const exe = await api()
      .post(`/api/transactions/${t.id}/attachments`)
      .set(bearer(ff1))
      .attach('file', Buffer.from('MZ\x90\x00 fake exe'), { filename: 'invoice.pdf', contentType: 'application/pdf' });
    expect(exe.status).toBe(415);
    const renamed = await api()
      .post(`/api/transactions/${t.id}/attachments`)
      .set(bearer(ff1))
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), { filename: 'photo.png', contentType: 'image/png' });
    expect(renamed.status).toBe(415);
    const empty = await api().post(`/api/transactions/${t.id}/attachments`).set(bearer(ff1));
    expect(empty.status).toBe(400);
  });

  it('downloads are permission-checked and audited', async () => {
    const t = await createDraft(ff1);
    const a = await attachPdf(ff1, t.id);
    const ok = await api().get(`/api/attachments/${a.id}/download`).set(bearer(ff1));
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('application/pdf');
    expect(ok.headers['content-disposition']).toContain('attachment;');
    expect((await api().get(`/api/attachments/${a.id}/download`).set(bearer(ff2))).status).toBe(404);
    expect((await api().get(`/api/attachments/${a.id}/download`).set(bearer(accountant))).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: 'DOWNLOAD_ATTACHMENT', entityId: t.id } })).toBe(1);
  });

  it('soft-deletes and keeps upload history; locked once submitted', async () => {
    const t = await createDraft(ff1);
    const a = await attachPdf(ff1, t.id);
    expect((await api().delete(`/api/attachments/${a.id}`).set(bearer(ff1))).status).toBe(200);
    expect(await prisma.salesTransactionAttachment.count({ where: { id: a.id } })).toBe(1);
    expect((await getTx(ff1, t.id)).attachments).toHaveLength(0);

    const id = await submitted(ff1);
    const up = await api()
      .post(`/api/transactions/${id}/attachments`)
      .set(bearer(ff1))
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), { filename: 'late.pdf' });
    expect(up.status).toBe(403);
  });
});
