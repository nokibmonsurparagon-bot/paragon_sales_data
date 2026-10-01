import { z } from 'zod';
import {
  CORRECTION_CATEGORIES,
  DUPLICATE_STATUSES,
  TRANSACTION_STATUSES,
} from '../constants/domain.js';
import {
  commentSchema,
  isoDateSchema,
  moneyOrZeroSchema,
  moneySchema,
  paginationQuerySchema,
  reasonSchema,
  versionSchema,
} from './common.js';

/** Field-level rules, shared by draft, submit and the web form. */
export const transactionFieldSchemas = {
  wingId: z.uuid('Wing is required'),
  transactionDate: isoDateSchema,
  fieldForceUserId: z.uuid(),
  lineId: z.uuid('Line name is required'),
  branchId: z.uuid('Branch code is required'),
  cvCodeId: z.uuid('CV code is required'),
  partyId: z.uuid('Farmer / customer is required'),
  amount: moneySchema,
  bankId: z.uuid('Bank is required'),
  accountId: z.uuid('Account is required'),
  /** Where the deposit came from (depositor's bank branch / bank details). */
  bankDetails: z.string().trim().min(1, 'Bank branch / bank details are required').max(300, 'Maximum 300 characters'),
  paymentReference: z
    .string()
    .trim()
    .min(1, 'Payment reference is required')
    .max(100, 'Maximum 100 characters')
    .regex(/^[A-Za-z0-9\-/_. #]+$/, 'Only letters, digits, space and - / _ . # are allowed'),
  salesTypeId: z.uuid('Sales type is required'),
  remarks: z.string().trim().max(2000, 'Maximum 2000 characters'),
};

const f = transactionFieldSchemas;

/**
 * Drafts may be incomplete: every business field except the wing is optional/nullable.
 * The wing is required from creation on because it decides who can see and review the transaction;
 * the owner may change it but never blank it.
 * `.strict()` – unknown keys (e.g. `status`) are rejected, so status can never be set through CRUD.
 */
export const transactionDraftSchema = z.strictObject({
  wingId: f.wingId.optional(),
  transactionDate: f.transactionDate.nullish(),
  fieldForceUserId: f.fieldForceUserId.nullish(),
  lineId: f.lineId.nullish(),
  branchId: f.branchId.nullish(),
  cvCodeId: f.cvCodeId.nullish(),
  partyId: f.partyId.nullish(),
  amount: f.amount.nullish(),
  bankId: f.bankId.nullish(),
  accountId: f.accountId.nullish(),
  bankDetails: f.bankDetails.nullish(),
  paymentReference: f.paymentReference.nullish(),
  salesTypeId: f.salesTypeId.nullish(),
  remarks: f.remarks.nullish(),
});
export type TransactionDraftInput = z.infer<typeof transactionDraftSchema>;

export const transactionCreateSchema = transactionDraftSchema.extend({ wingId: f.wingId });
export type TransactionCreateInput = z.infer<typeof transactionCreateSchema>;

export const transactionUpdateSchema = transactionDraftSchema.extend({ version: versionSchema });
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;

/** Completeness required before a transaction can leave DRAFT / CORRECTION_REQUIRED. */
export const transactionSubmitSchema = z.object({
  wingId: f.wingId,
  transactionDate: f.transactionDate,
  fieldForceUserId: f.fieldForceUserId,
  lineId: f.lineId,
  branchId: f.branchId,
  cvCodeId: f.cvCodeId,
  partyId: f.partyId,
  amount: f.amount,
  bankId: f.bankId,
  accountId: f.accountId,
  bankDetails: f.bankDetails,
  paymentReference: f.paymentReference,
  salesTypeId: f.salesTypeId,
  remarks: f.remarks.nullish(),
});
export type TransactionSubmitData = z.infer<typeof transactionSubmitSchema>;

// ---- Workflow action bodies -------------------------------------------------------------------
export const simpleActionSchema = z.strictObject({
  version: versionSchema,
  comment: commentSchema.optional(),
});
export type SimpleActionInput = z.infer<typeof simpleActionSchema>;

/**
 * `creditAmount` = Amount (CR): what the bank actually credited. Entered by Accountant / Treasury and
 * required for the final (finance) approval; the bank charge is derived from it.
 */
export const creditAmountSchema = moneySchema;

export const approveSchema = simpleActionSchema.extend({ creditAmount: creditAmountSchema.optional() });
export type ApproveInput = z.infer<typeof approveSchema>;

export const rejectSchema = z.strictObject({
  version: versionSchema,
  reason: reasonSchema,
  correctionCategory: z.enum(CORRECTION_CATEGORIES).optional(),
});
export type RejectInput = z.infer<typeof rejectSchema>;

export const returnSchema = z.strictObject({
  version: versionSchema,
  reason: reasonSchema,
  correctionCategory: z.enum(CORRECTION_CATEGORIES, 'Correction category is required'),
});
export type ReturnInput = z.infer<typeof returnSchema>;

// ---- Bulk review actions (approval queue) ---------------------------------------------------------
export const BULK_ACTION_MAX_ITEMS = 50;

const uniqueIds = (items: { id: string }[]) => new Set(items.map((i) => i.id)).size === items.length;
const bulkSize = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .min(1, 'Select at least one transaction')
    .max(BULK_ACTION_MAX_ITEMS, `At most ${BULK_ACTION_MAX_ITEMS} transactions at a time`);

export const bulkApproveSchema = z.strictObject({
  items: bulkSize(z.strictObject({ id: z.uuid(), version: versionSchema, creditAmount: creditAmountSchema.optional() })).refine(
    uniqueIds,
    'Each transaction may appear only once',
  ),
  comment: commentSchema.optional(),
});
export type BulkApproveInput = z.infer<typeof bulkApproveSchema>;

export const bulkRejectSchema = z.strictObject({
  items: bulkSize(z.strictObject({ id: z.uuid(), version: versionSchema })).refine(uniqueIds, 'Each transaction may appear only once'),
  reason: reasonSchema,
  correctionCategory: z.enum(CORRECTION_CATEGORIES).optional(),
});
export type BulkRejectInput = z.infer<typeof bulkRejectSchema>;

export const claimSchema = z.strictObject({ version: versionSchema });

export const reassignSchema = z.strictObject({ version: versionSchema, userId: z.uuid() });
export type ReassignInput = z.infer<typeof reassignSchema>;

export const resolveDuplicateSchema = z.strictObject({
  version: versionSchema,
  resolution: z.enum(['NOT_DUPLICATE', 'CONFIRMED_DUPLICATE']),
  note: reasonSchema,
});
export type ResolveDuplicateInput = z.infer<typeof resolveDuplicateSchema>;

// ---- Queries ----------------------------------------------------------------------------------
const statusListRegex = new RegExp(`^(${TRANSACTION_STATUSES.join('|')})(,(${TRANSACTION_STATUSES.join('|')}))*$`);

/** Filters shared by the transaction list, dashboard and reports. */
export const transactionFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().regex(statusListRegex, 'Invalid status list').optional(),
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional(),
  wingId: z.uuid().optional(),
  fieldForceUserId: z.uuid().optional(),
  lineId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  cvCodeId: z.uuid().optional(),
  partyId: z.uuid().optional(),
  bankId: z.uuid().optional(),
  accountId: z.uuid().optional(),
  salesTypeId: z.uuid().optional(),
  amountMin: moneyOrZeroSchema.optional(),
  amountMax: moneyOrZeroSchema.optional(),
  duplicateStatus: z.enum(DUPLICATE_STATUSES).optional(),
});
export type TransactionFilter = z.infer<typeof transactionFilterSchema>;

export const TRANSACTION_SORT_FIELDS = [
  'transactionNumber',
  'transactionDate',
  'amount',
  'status',
  'createdAt',
  'updatedAt',
] as const;

export const transactionListQuerySchema = paginationQuerySchema.extend({
  ...transactionFilterSchema.shape,
  /** all = everything in scope, mine = created by me, queue = awaiting my action. */
  view: z.enum(['all', 'mine', 'queue']).default('all'),
});
export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;
