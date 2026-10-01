/**
 * Wings (DOC, CBF, Fish, Feed, Milk): every transaction belongs to one wing; Field Force users create only in
 * their wings, and Sales Admin / finance reviewers see, are notified about and act on only their wings.
 * Dev users: ff1 = DOC+CBF, ff2 = DOC+FEED, salesadmin = DOC+CBF, salesadmin2 = DOC+FISH+FEED+MILK,
 * accountant / treasury / auditor / admin = all wings.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db.js';
import { act, api, bearer, clearTokens, createDraft, getTx, login, refs, resetDb, submitted } from '../helpers.js';

let ff1: string, ff2: string, sa: string, sa2: string, accountant: string, admin: string;
let r: Awaited<ReturnType<typeof refs>>;

beforeAll(async () => {
  await resetDb();
  [ff1, ff2, sa, sa2, accountant, admin] = (await Promise.all(
    (['ff1', 'ff2', 'sa', 'sa2', 'accountant', 'admin'] as const).map((u) => login(u)),
  )) as [string, string, string, string, string, string];
  r = await refs();
});

const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

describe('wing master data', () => {
  it('lists the five default wings to every signed-in user; only admins manage them', async () => {
    const list = await api().get('/api/wings?sort=code:asc').set(bearer(ff1));
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((w: { code: string }) => w.code)).toEqual(['CBF', 'DOC', 'FEED', 'FISH', 'MILK']);
    expect((await api().post('/api/wings').set(bearer(ff1)).send({ code: 'EGG', name: 'Egg' })).status).toBe(403);
    const created = await api().post('/api/wings').set(bearer(admin)).send({ code: 'egg', name: 'Egg' });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('EGG');
  });

  it('exposes the user’s wings on /auth/me', async () => {
    const me = await api().get('/api/auth/me').set(bearer(ff1));
    expect(me.body.data.allWings).toBe(false);
    expect(me.body.data.wings.map((w: { code: string }) => w.code)).toEqual(['CBF', 'DOC']);
    const acc = await api().get('/api/auth/me').set(bearer(accountant));
    expect(acc.body.data.allWings).toBe(true);
    expect(acc.body.data.wings.map((w: { code: string }) => w.code)).toContain('EGG');
  });
});

describe('creating transactions', () => {
  it('requires a wing', async () => {
    const res = await api().post('/api/transactions').set(bearer(ff1)).send({ remarks: 'no wing' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('wingId');
  });

  it('only in the Field Force user’s own wings', async () => {
    const res = await api().post('/api/transactions').set(bearer(ff1)).send({ wingId: r.feed.id });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('WING_NOT_ASSIGNED');
    const ok = await createDraft(ff1, { wingId: r.cbf.id });
    expect(ok.wing.code).toBe('CBF');
  });

  it('the owner may move a draft between their wings (recorded in history), but not outside them', async () => {
    const t = await createDraft(ff1);
    const moved = await api().patch(`/api/transactions/${t.id}`).set(bearer(ff1)).send({ version: t.version, wingId: r.cbf.id });
    expect(moved.status).toBe(200);
    expect(moved.body.data.wing.code).toBe('CBF');
    const history = await api().get(`/api/transactions/${t.id}/history`).set(bearer(ff1));
    expect(history.body.data.at(-1).changes.wingId).toEqual({ from: 'DOC – DOC', to: 'CBF – CBF' });
    const outside = await api().patch(`/api/transactions/${t.id}`).set(bearer(ff1)).send({ version: moved.body.data.version, wingId: r.feed.id });
    expect(outside.status).toBe(422);
  });
});

describe('review scope', () => {
  let cbfId: string;
  let feedId: string;

  beforeAll(async () => {
    cbfId = await submitted(ff1, { wingId: r.cbf.id });
    feedId = await submitted(ff2, { wingId: r.feed.id });
  });

  it('notifies only the Sales Admins of the wing', async () => {
    const [saId, sa2Id] = await Promise.all([userId('salesadmin@paragon.local'), userId('salesadmin2@paragon.local')]);
    const notified = async (uid: string, id: string) => prisma.notification.count({ where: { userId: uid, entityId: id, type: 'REVIEW_REQUIRED' } });
    expect(await notified(saId, cbfId)).toBe(1);
    expect(await notified(sa2Id, cbfId)).toBe(0);
    expect(await notified(sa2Id, feedId)).toBe(1);
    expect(await notified(saId, feedId)).toBe(0);
  });

  it('queues and details are limited to the reviewer’s wings (other wings → 404)', async () => {
    const queue = async (token: string) =>
      (await api().get('/api/transactions?view=queue&limit=100').set(bearer(token))).body.data.items.map((t: { id: string }) => t.id);
    expect(await queue(sa)).toContain(cbfId);
    expect(await queue(sa)).not.toContain(feedId);
    expect(await queue(sa2)).toContain(feedId);
    expect(await queue(sa2)).not.toContain(cbfId);
    expect((await api().get(`/api/transactions/${feedId}`).set(bearer(sa))).status).toBe(404);
    expect((await act(sa, feedId, 'approve', { version: 1 })).status).toBe(404);
  });

  it('reassignment only to reviewers of the wing; the lookup filters by wing', async () => {
    const lookup = await api().get(`/api/users/lookup?permission=SALES_ADMIN_REVIEW&wingId=${r.cbf.id}`).set(bearer(admin));
    const emails = lookup.body.data.items.map((u: { email: string }) => u.email);
    expect(emails).toContain('salesadmin@paragon.local');
    expect(emails).not.toContain('salesadmin2@paragon.local');
    const t = await getTx(admin, cbfId);
    const res = await api()
      .post(`/api/transactions/${cbfId}/reassign`)
      .set(bearer(admin))
      .send({ version: t.version, userId: await userId('salesadmin2@paragon.local') });
    expect(res.status).toBe(400);
  });

  it('routes by wing and keeps finance scoped to its wings', async () => {
    const treasury = await prisma.role.findUniqueOrThrow({ where: { code: 'TREASURY' } });
    const rule = await api()
      .post('/api/workflow/rules')
      .set(bearer(admin))
      .send({ name: 'Feed → Treasury', priority: 5, conditions: { wingIds: [r.feed.id] }, targetRoleId: treasury.id });
    expect(rule.status).toBe(201);
    const sim = await api().post('/api/workflow/rules/simulate').set(bearer(admin)).send({ wingId: r.feed.id, salesTypeId: r.cash.id, amount: '10.00' });
    expect(sim.body.data.rule.name).toBe('Feed → Treasury');

    const approved = await act(sa2, feedId, 'approve');
    expect(approved.status).toBe(200);
    expect(approved.body.data.transaction.assignedRole.code).toBe('TREASURY');

    // A treasury user restricted to DOC no longer sees the FEED item.
    const treasuryUser = await userId('treasury@paragon.local');
    const upd = await api().patch(`/api/users/${treasuryUser}`).set(bearer(admin)).send({ allWings: false, wingIds: [r.doc.id] });
    expect(upd.status).toBe(200);
    expect(upd.body.data.wings.map((w: { code: string }) => w.code)).toEqual(['DOC']);
    clearTokens(); // wing changes invalidate existing access tokens
    const tr = await login('treasury');
    expect((await api().get(`/api/transactions/${feedId}`).set(bearer(tr))).status).toBe(404);

    await api().patch(`/api/users/${treasuryUser}`).set(bearer(admin)).send({ allWings: true, wingIds: [] });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'UPDATE_USER', entityId: treasuryUser }, orderBy: { createdAt: 'desc' } });
    expect(audit?.previousData).toMatchObject({ wings: ['DOC'] });
    expect(audit?.newData).toMatchObject({ wings: 'ALL' });

    clearTokens();
    const tr2 = await login('treasury');
    const final = await act(tr2, feedId, 'approve');
    expect(final.status).toBe(200);
    const row = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: feedId } });
    expect((row.approvedSnapshot as { approvedData: { wing: { code: string } } }).approvedData.wing.code).toBe('FEED');
  });

  it('lists, filters and reports by wing', async () => {
    const aud = await login('auditor');
    const feedOnly = await api().get(`/api/transactions?wingId=${r.feed.id}&limit=100`).set(bearer(aud));
    expect(feedOnly.body.data.items.length).toBeGreaterThan(0);
    expect(feedOnly.body.data.items.every((t: { wing: { code: string } }) => t.wing.code === 'FEED')).toBe(true);
    const report = await api().get(`/api/reports/sales?wingId=${r.cbf.id}`).set(bearer(aud));
    expect(report.body.data.columns.map((c: { key: string }) => c.key)).toContain('wing');
    expect(report.body.data.rows.every((row: { wing: string }) => row.wing === 'CBF')).toBe(true);
    const dash = await api().get('/api/dashboard/summary').set(bearer(aud));
    const byWing = dash.body.data.sections.find((s: { key: string }) => s.key === 'wings');
    expect(byWing.widgets.find((w: { label: string }) => w.label === 'Feed').value).toBeGreaterThanOrEqual(1);
  });
});
