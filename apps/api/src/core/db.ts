import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export const prisma = new PrismaClient({
  // Errors are mapped and logged by the error handler; tests intentionally trigger constraint errors.
  log: env.isTest ? [] : env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/** Either the root client or an interactive-transaction client. Repositories accept both. */
export type Db = PrismaClient | Prisma.TransactionClient;

export function withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 15_000,
  });
}

/** JSON-safe conversion (Decimal → string, Date → ISO) for audit/outbox payloads. */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (v instanceof Prisma.Decimal ? v.toFixed(2) : v)),
  ) as Prisma.InputJsonValue;
}
