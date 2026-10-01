/**
 * Creates (or re-enables) the first administrator in environments without demo users.
 * Usage (reads values from the environment, never from the command line, so they do not end up in shell history):
 *   ADMIN_EMAIL=... ADMIN_NAME="..." ADMIN_PASSWORD=... npm run admin:create -w @paragon/api
 * The password is temporary: the administrator must change it at first sign-in.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { passwordSchema } from '@paragon/shared';
import { seedDatabase } from './seed-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: [path.resolve(here, '../../../.env'), path.resolve(here, '../../../../.env')], quiet: true });

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const fullName = process.env.ADMIN_NAME?.trim() || 'Administrator';
const password = process.env.ADMIN_PASSWORD ?? '';

if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) {
  console.error('ADMIN_EMAIL is required');
  process.exit(1);
}
const pw = passwordSchema.safeParse(password);
if (!pw.success) {
  console.error(`ADMIN_PASSWORD invalid: ${pw.error.issues.map((i) => i.message).join('; ')}`);
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  // Ensures roles/permissions exist (no demo users).
  await seedDatabase(prisma, { devUsers: false });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email },
    // Administrators oversee every wing.
    create: { email, fullName, passwordHash, mustChangePassword: true, allWings: true, roles: { create: [{ roleId: adminRole.id }] } },
    update: { passwordHash, mustChangePassword: true, status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null, tokenVersion: { increment: 1 } },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    create: { userId: user.id, roleId: adminRole.id },
    update: {},
  });
  await prisma.auditLog.create({
    data: { userId: null, action: 'CREATE_USER', entityType: 'User', entityId: user.id, newData: { email, bootstrapAdmin: true } },
  });
  console.log(`Administrator ${email} is ready. They must change the password at first sign-in.`);
} finally {
  await prisma.$disconnect();
}
