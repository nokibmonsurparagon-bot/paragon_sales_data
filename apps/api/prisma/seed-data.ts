/**
 * Idempotent seed: permissions, system roles, settings, master data, routing & business rules,
 * and (outside production only) development users.
 */
import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATALOGUE,
  SETTING_DEFINITIONS,
  SYSTEM_ROLES,
  type SettingKey,
  type SystemRole,
} from '@paragon/shared';
import argon2 from 'argon2';

/** DEVELOPMENT ONLY – never used when NODE_ENV=production. */
export const DEV_PASSWORD = 'Paragon@Dev2026';

/** Business wings. Codes are stable identifiers; names can be changed by administrators. */
export const WINGS = [
  { code: 'DOC', name: 'DOC' },
  { code: 'CBF', name: 'CBF' },
  { code: 'FISH', name: 'Fish' },
  { code: 'FEED', name: 'Feed' },
  { code: 'MILK', name: 'Milk' },
] as const;
type WingCode = (typeof WINGS)[number]['code'];

/** Wing assignments show wing scoping: FEED items of ff2 reach only Sales Admin Two, CBF items of ff1 only Sales Admin One. */
export const DEV_USERS: { email: string; fullName: string; roles: SystemRole[]; wings: WingCode[] | 'ALL' }[] = [
  { email: 'admin@paragon.local', fullName: 'System Administrator', roles: ['ADMIN'], wings: 'ALL' },
  { email: 'ff1@paragon.local', fullName: 'Field Force One', roles: ['FIELD_FORCE'], wings: ['DOC', 'CBF'] },
  { email: 'ff2@paragon.local', fullName: 'Field Force Two', roles: ['FIELD_FORCE'], wings: ['DOC', 'FEED'] },
  { email: 'salesadmin@paragon.local', fullName: 'Sales Admin One', roles: ['SALES_ADMIN'], wings: ['DOC', 'CBF'] },
  { email: 'salesadmin2@paragon.local', fullName: 'Sales Admin Two', roles: ['SALES_ADMIN'], wings: ['DOC', 'FISH', 'FEED', 'MILK'] },
  { email: 'accountant@paragon.local', fullName: 'Accountant One', roles: ['ACCOUNTANT'], wings: 'ALL' },
  { email: 'treasury@paragon.local', fullName: 'Treasury Officer', roles: ['TREASURY'], wings: 'ALL' },
  { email: 'auditor@paragon.local', fullName: 'Internal Auditor', roles: ['AUDITOR'], wings: 'ALL' },
];

const ROLE_NAMES: Record<SystemRole, [string, string]> = {
  ADMIN: ['Administrator', 'Full system administration'],
  FIELD_FORCE: ['Field Force', 'Creates and submits sales transactions'],
  SALES_ADMIN: ['Sales Admin', 'First-level review and approval'],
  ACCOUNTANT: ['Accountant', 'Finance review and final approval'],
  TREASURY: ['Treasury', 'Finance review and final approval for treasury-routed transactions'],
  AUDITOR: ['Auditor', 'Read-only access to transactions, reports and audit logs'],
};

const BANKS = [
  { code: 'NCB', name: 'National Commercial Bank' },
  { code: 'MTB', name: 'Metro Trust Bank' },
  { code: 'USB', name: 'Union Savings Bank' },
];
const ACCOUNTS = [
  { code: 'NCB-COL-001', name: 'NCB Collection Account', bank: 'NCB' },
  { code: 'NCB-OPR-002', name: 'NCB Operating Account', bank: 'NCB' },
  { code: 'MTB-COL-001', name: 'MTB Collection Account', bank: 'MTB' },
  { code: 'USB-COL-001', name: 'USB Collection Account', bank: 'USB' },
  { code: 'USB-TRS-002', name: 'USB Treasury Account', bank: 'USB' },
];
const PARTIES = [
  { code: 'P0001', name: 'Alpha Traders' },
  { code: 'P0002', name: 'Beta Distributors' },
  { code: 'P0003', name: 'Crescent Pharma Ltd' },
  { code: 'P0004', name: 'Delta Retail' },
  { code: 'P0005', name: 'Evergreen Stores' },
  { code: 'P0006', name: 'Fortune Wholesale' },
  { code: 'P0007', name: 'Global Agro Industries' },
  { code: 'P0008', name: 'Horizon Mart' },
];
/** Sample Line / Branch / CV code lists (demo data only; real lists are maintained under Master Data). */
const LINES = [
  { code: 'L01', name: 'Line 01' },
  { code: 'L02', name: 'Line 02' },
  { code: 'L03', name: 'Line 03' },
];
const BRANCHES = [
  { code: 'DHK', name: 'Dhaka' },
  { code: 'CTG', name: 'Chattogram' },
  { code: 'RAJ', name: 'Rajshahi' },
];
const CV_CODES = [
  { code: 'CV-1001', name: 'CV 1001' },
  { code: 'CV-1002', name: 'CV 1002' },
  { code: 'CV-1003', name: 'CV 1003' },
];
const SALES_TYPES = [
  { code: 'CASH', name: 'Cash Sale', isSpecial: false },
  { code: 'CREDIT', name: 'Credit Collection', isSpecial: false },
  { code: 'CORPORATE', name: 'Corporate Sale', isSpecial: false },
  { code: 'SPECIAL', name: 'Special Transaction', isSpecial: true },
];

export async function seedDatabase(prisma: PrismaClient, opts: { devUsers: boolean }): Promise<void> {
  // 1. Permissions (catalogue is authoritative)
  for (const [code, meta] of Object.entries(PERMISSION_CATALOGUE)) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, module: meta.module, description: meta.description },
      update: { module: meta.module, description: meta.description },
    });
  }
  const permIds = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));

  // 2. System roles – default permissions applied on creation; ADMIN always kept complete.
  const roleIds = new Map<string, string>();
  for (const code of SYSTEM_ROLES) {
    const [name, description] = ROLE_NAMES[code];
    const existing = await prisma.role.findUnique({ where: { code } });
    const role = existing ?? (await prisma.role.create({ data: { code, name, description, isSystem: true } }));
    roleIds.set(code, role.id);
    if (!existing || code === 'ADMIN') {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({
        data: DEFAULT_ROLE_PERMISSIONS[code].map((p) => ({ roleId: role.id, permissionId: permIds.get(p)! })),
      });
    }
  }

  // 3. Settings (only missing keys; admin changes are preserved)
  for (const [key, def] of Object.entries(SETTING_DEFINITIONS) as [SettingKey, (typeof SETTING_DEFINITIONS)[SettingKey]][]) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: def.default as never, description: def.description },
      update: {},
    });
  }

  // 4. Master data
  const wingIds = new Map<string, string>();
  for (const w of WINGS) {
    const row = await prisma.wing.upsert({ where: { code: w.code }, create: w, update: {} });
    wingIds.set(w.code, row.id);
  }
  const bankIds = new Map<string, string>();
  for (const b of BANKS) {
    const row = await prisma.bank.upsert({ where: { code: b.code }, create: b, update: {} });
    bankIds.set(b.code, row.id);
  }
  for (const a of ACCOUNTS) {
    await prisma.account.upsert({
      where: { code: a.code },
      create: { code: a.code, name: a.name, bankId: bankIds.get(a.bank)! },
      update: {},
    });
  }
  for (const p of PARTIES) await prisma.party.upsert({ where: { code: p.code }, create: p, update: {} });
  if (opts.devUsers) {
    for (const l of LINES) await prisma.line.upsert({ where: { code: l.code }, create: l, update: {} });
    for (const b of BRANCHES) await prisma.branch.upsert({ where: { code: b.code }, create: b, update: {} });
    for (const c of CV_CODES) await prisma.cvCode.upsert({ where: { code: c.code }, create: c, update: {} });
  }
  const salesTypeIds = new Map<string, string>();
  for (const s of SALES_TYPES) {
    const row = await prisma.salesType.upsert({ where: { code: s.code }, create: s, update: {} });
    salesTypeIds.set(s.code, row.id);
  }

  // 5. Finance routing rules (only when none exist)
  if ((await prisma.workflowRule.count()) === 0) {
    await prisma.workflowRule.createMany({
      data: [
        { name: 'Special transactions → Accountant', priority: 10, conditions: { isSpecial: true }, targetRoleId: roleIds.get('ACCOUNTANT')! },
        { name: 'High value (≥ 1,000,000) → Treasury', priority: 20, conditions: { minAmount: '1000000.00' }, targetRoleId: roleIds.get('TREASURY')! },
        { name: 'Corporate sales → Treasury', priority: 30, conditions: { salesTypeIds: [salesTypeIds.get('CORPORATE')!] }, targetRoleId: roleIds.get('TREASURY')! },
        { name: 'Default → Accountant', description: 'Catch-all rule (required)', priority: 1000, conditions: {}, targetRoleId: roleIds.get('ACCOUNTANT')! },
      ],
    });
  }

  // 6. Business rules (only when none exist)
  if ((await prisma.businessRule.count()) === 0) {
    await prisma.businessRule.createMany({
      data: [
        {
          name: 'Mandatory fields on submission',
          description: 'All core fields and at least one supporting document are required to submit',
          type: 'REQUIRED_FIELD',
          params: { fields: ['transactionDate', 'partyId', 'amount', 'bankId', 'accountId', 'paymentReference', 'salesTypeId', 'attachments'] },
          trigger: 'SUBMIT',
          severity: 'ERROR',
        },
        {
          name: 'Maximum transaction amount',
          type: 'MAX_AMOUNT',
          params: { amount: '100000000.00' },
          trigger: 'SAVE',
          severity: 'ERROR',
        },
      ],
    });
  }

  // 7. Development users
  if (opts.devUsers) {
    const passwordHash = await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id });
    for (const u of DEV_USERS) {
      const existing = await prisma.user.findUnique({ where: { email: u.email } });
      if (existing) continue;
      await prisma.user.create({
        data: {
          email: u.email,
          fullName: u.fullName,
          passwordHash,
          allWings: u.wings === 'ALL',
          roles: { create: u.roles.map((r) => ({ roleId: roleIds.get(r)! })) },
          wings: { create: u.wings === 'ALL' ? [] : u.wings.map((w) => ({ wingId: wingIds.get(w)! })) },
        },
      });
    }
  }
}
