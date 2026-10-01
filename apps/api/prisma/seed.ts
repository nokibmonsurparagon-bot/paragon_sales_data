import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { DEV_PASSWORD, DEV_USERS, seedDatabase } from './seed-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: [path.resolve(here, '../../../.env'), path.resolve(here, '../../../../.env')], quiet: true });

const prisma = new PrismaClient();
const isProduction = process.env.NODE_ENV === 'production';
// Local docker-compose runs NODE_ENV=production but opts in to demo users explicitly.
const devUsers = !isProduction || process.env.SEED_DEV_USERS === 'true';

try {
  await seedDatabase(prisma, { devUsers });
  console.log('Seed completed.');
  if (devUsers) {
    console.log('\n*** DEVELOPMENT-ONLY CREDENTIALS – do not use in any shared or production environment ***');
    console.log(`Password for all users: ${DEV_PASSWORD}`);
    // Print the wings actually stored: existing users keep theirs (the seed never changes an existing user).
    const stored = await prisma.user.findMany({
      where: { email: { in: DEV_USERS.map((u) => u.email) } },
      select: { email: true, allWings: true, wings: { select: { wing: { select: { code: true } } } } },
    });
    for (const u of DEV_USERS) {
      const s = stored.find((x) => x.email === u.email);
      const wings = !s || s.allWings ? 'all wings' : s.wings.map((w) => w.wing.code).sort().join(', ') || '(none)';
      console.log(`  ${u.email.padEnd(28)} ${u.roles.join(', ').padEnd(14)} ${wings}`);
    }
  } else {
    console.log('Production mode: no users were created. Create the first administrator with a secure process.');
  }
} finally {
  await prisma.$disconnect();
}
