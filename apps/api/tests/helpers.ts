import request from 'supertest';
import type { TransactionDetail } from '@paragon/shared';
import { createApp } from '../src/app.js';
import { invalidateAuthz } from '../src/core/authz.js';
import { prisma } from '../src/core/db.js';
import { invalidateSettingsCache } from '../src/core/settings.js';
import { DEV_PASSWORD, seedDatabase } from '../prisma/seed-data.js';

export const app = createApp();
export const api = () => request(app);

/** Wipes every table (TRUNCATE bypasses the append-only row triggers) and re-seeds. */
export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await seedDatabase(prisma, { devUsers: true });
  invalidateAuthz();
  invalidateSettingsCache();
  clearTokens();
}

export const USERS = {
  admin: 'admin@paragon.local',
  ff1: 'ff1@paragon.local',
  ff2: 'ff2@paragon.local',
  sa: 'salesadmin@paragon.local',
  sa2: 'salesadmin2@paragon.local',
  accountant: 'accountant@paragon.local',
  treasury: 'treasury@paragon.local',
  auditor: 'auditor@paragon.local',
} as const;
export type UserKey = keyof typeof USERS;

const tokenCache = new Map<string, string>();

export async function login(who: UserKey | string): Promise<string> {
  const email = USERS[who as UserKey] ?? who;
  const cached = tokenCache.get(email);
  if (cached) return cached;
  const res = await api().post('/api/auth/login').send({ email, password: DEV_PASSWORD });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  tokenCache.set(email, res.body.data.accessToken);
  return res.body.data.accessToken as string;
}

export function clearTokens(): void {
  tokenCache.clear();
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function refs() {
  const [doc, cbf, feed, ncb, mtb, ncbAcc, mtbAcc, alpha, beta, cash, corporate, special, line, branch] = await Promise.all([
    prisma.wing.findUniqueOrThrow({ where: { code: 'DOC' } }),
    prisma.wing.findUniqueOrThrow({ where: { code: 'CBF' } }),
    prisma.wing.findUniqueOrThrow({ where: { code: 'FEED' } }),
    prisma.bank.findUniqueOrThrow({ where: { code: 'NCB' } }),
    prisma.bank.findUniqueOrThrow({ where: { code: 'MTB' } }),
    prisma.account.findUniqueOrThrow({ where: { code: 'NCB-COL-001' } }),
    prisma.account.findUniqueOrThrow({ where: { code: 'MTB-COL-001' } }),
    prisma.party.findUniqueOrThrow({ where: { code: 'P0001' } }),
    prisma.party.findUniqueOrThrow({ where: { code: 'P0002' } }),
    prisma.salesType.findUniqueOrThrow({ where: { code: 'CASH' } }),
    prisma.salesType.findUniqueOrThrow({ where: { code: 'CORPORATE' } }),
    prisma.salesType.findUniqueOrThrow({ where: { code: 'SPECIAL' } }),
    prisma.line.findUniqueOrThrow({ where: { code: 'L01' } }),
    prisma.branch.findUniqueOrThrow({ where: { code: 'DHK' } }),
  ]);
  return { doc, cbf, feed, ncb, mtb, ncbAcc, mtbAcc, alpha, beta, cash, corporate, special, line, branch };
}

let refCounter = 0;

export async function validBody(overrides: Record<string, unknown> = {}) {
  const r = await refs();
  refCounter += 1;
  return {
    // DOC is shared by every dev Field Force / Sales Admin user; wing-specific tests override it.
    wingId: r.doc.id,
    transactionDate: today(),
    lineId: r.line.id,
    branchId: r.branch.id,
    partyId: r.alpha.id,
    // Unique per call so unrelated test transactions are not flagged as possible duplicates.
    amount: `${1000 + refCounter}.00`,
    bankId: r.ncb.id,
    accountId: r.ncbAcc.id,
    bankDetails: 'Sonali Bank, Motijheel branch',
    paymentReference: `CHQ-${Date.now()}-${refCounter}`,
    salesTypeId: r.cash.id,
    remarks: 'Test transaction',
    ...overrides,
  };
}

export const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

export async function createDraft(token: string, overrides: Record<string, unknown> = {}): Promise<TransactionDetail> {
  const res = await api().post('/api/transactions').set(bearer(token)).send(await validBody(overrides));
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as TransactionDetail;
}

export async function attachPdf(token: string, id: string) {
  const res = await api()
    .post(`/api/transactions/${id}/attachments`)
    .set(bearer(token))
    .attach('file', PDF_BYTES, { filename: 'receipt.pdf', contentType: 'application/pdf' });
  if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function getTx(token: string, id: string): Promise<TransactionDetail> {
  const res = await api().get(`/api/transactions/${id}`).set(bearer(token));
  if (res.status !== 200) throw new Error(`get failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as TransactionDetail;
}

export async function act(token: string, id: string, verb: string, body: Record<string, unknown> = {}) {
  const tx = await getTx(token, id).catch(() => null);
  // The final approval needs Amount (CR); default to the full deposit (bank charge 0) unless a test sets it.
  const credit = verb === 'approve' && tx?.status === 'FINANCE_REVIEW' && tx.amount ? { creditAmount: tx.amount } : {};
  return api()
    .post(`/api/transactions/${id}/${verb}`)
    .set(bearer(token))
    .send({ version: tx?.version ?? 1, ...credit, ...body });
}

/** Creates a complete draft with an attachment and submits it. Returns the transaction id. */
export async function submitted(ffToken: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const t = await createDraft(ffToken, overrides);
  await attachPdf(ffToken, t.id);
  const res = await act(ffToken, t.id, 'submit');
  if (res.status !== 200) throw new Error(`submit failed: ${res.status} ${JSON.stringify(res.body)}`);
  return t.id;
}
