import { z } from 'zod';

export const idParamSchema = z.object({ id: z.uuid() });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** `field:asc` or `field:desc`; allowed fields are whitelisted per endpoint. */
  sort: z
    .string()
    .regex(/^[a-zA-Z]+:(asc|desc)$/, 'sort must look like field:asc or field:desc')
    .optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const booleanStringSchema = z.enum(['true', 'false']);

/** Money is always transported as a decimal string to avoid floating point errors. */
export const MONEY_REGEX = /^\d{1,15}(\.\d{1,2})?$/;

export const moneySchema = z
  .string()
  .trim()
  .regex(MONEY_REGEX, 'Must be a number with up to 2 decimal places')
  .refine((v) => Number(v) > 0, 'Must be greater than zero');

/** Non-negative money, for thresholds and filters. */
export const moneyOrZeroSchema = z.string().trim().regex(MONEY_REGEX, 'Must be a number with up to 2 decimal places');

/** Calendar date `YYYY-MM-DD` (no time zone). */
export const isoDateSchema = z.iso.date();

export const reasonSchema = z
  .string()
  .trim()
  .min(5, 'Please provide at least 5 characters')
  .max(1000, 'Maximum 1000 characters');

export const commentSchema = z.string().trim().max(1000, 'Maximum 1000 characters');

export const versionSchema = z.number().int().min(1);

export const codeSchema = z
  .string()
  .trim()
  .min(1, 'Code is required')
  .max(30, 'Maximum 30 characters')
  .regex(/^[A-Za-z0-9_-]+$/, 'Only letters, digits, "-" and "_" are allowed');

export const nameSchema = z.string().trim().min(1, 'Name is required').max(150, 'Maximum 150 characters');

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'Password must contain upper-case, lower-case letters and a digit',
  });
