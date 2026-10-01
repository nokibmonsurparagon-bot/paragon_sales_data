import { z } from 'zod';
import {
  ATTACHMENTS_FIELD,
  AUDIT_ACTIONS,
  BUSINESS_RULE_TYPES,
  MASTER_STATUSES,
  RULE_SEVERITIES,
  RULE_TRIGGERS,
  TRANSACTION_EDITABLE_FIELDS,
  USER_STATUSES,
  APPROVAL_DECISIONS,
  APPROVAL_STAGES,
  REPORT_TYPES,
  REVIEWER_EDITABLE_FIELDS,
} from '../constants/domain.js';
import { ALL_PERMISSIONS } from '../constants/permissions.js';
import {
  booleanStringSchema,
  codeSchema,
  isoDateSchema,
  moneyOrZeroSchema,
  moneySchema,
  nameSchema,
  paginationQuerySchema,
  passwordSchema,
} from './common.js';
import { transactionFilterSchema } from './transaction.js';

// ---- Master data ------------------------------------------------------------------------------
export const MASTER_DATA_ENTITIES = ['wings', 'lines', 'branches', 'cv-codes', 'banks', 'accounts', 'parties', 'sales-types'] as const;
export type MasterDataEntity = (typeof MASTER_DATA_ENTITIES)[number];

export const masterDataBaseCreateSchema = z.strictObject({
  code: codeSchema,
  name: nameSchema,
  status: z.enum(MASTER_STATUSES).default('ACTIVE'),
});

const masterDataBaseUpdateSchema = z.strictObject({
  code: codeSchema.optional(),
  name: nameSchema.optional(),
  status: z.enum(MASTER_STATUSES).optional(),
});

export const masterDataCreateSchemas = {
  wings: masterDataBaseCreateSchema,
  lines: masterDataBaseCreateSchema,
  branches: masterDataBaseCreateSchema,
  'cv-codes': masterDataBaseCreateSchema,
  banks: masterDataBaseCreateSchema,
  parties: masterDataBaseCreateSchema,
  accounts: masterDataBaseCreateSchema.extend({ bankId: z.uuid('Bank is required') }),
  'sales-types': masterDataBaseCreateSchema.extend({ isSpecial: z.boolean().default(false) }),
} as const;

export const masterDataUpdateSchemas = {
  wings: masterDataBaseUpdateSchema,
  lines: masterDataBaseUpdateSchema,
  branches: masterDataBaseUpdateSchema,
  'cv-codes': masterDataBaseUpdateSchema,
  banks: masterDataBaseUpdateSchema,
  parties: masterDataBaseUpdateSchema,
  accounts: z.strictObject({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    status: z.enum(MASTER_STATUSES).optional(),
    bankId: z.uuid().optional(),
  }),
  'sales-types': z.strictObject({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    status: z.enum(MASTER_STATUSES).optional(),
    isSpecial: z.boolean().optional(),
  }),
} as const;

export const masterDataListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(MASTER_STATUSES).optional(),
  bankId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(20),
});
export type MasterDataListQuery = z.infer<typeof masterDataListQuerySchema>;

// ---- Users & roles ----------------------------------------------------------------------------
export const userCreateSchema = z.strictObject({
  email: z.email('Enter a valid email address').trim().max(254),
  fullName: nameSchema,
  password: passwordSchema,
  roleIds: z.array(z.uuid()).min(1, 'Select at least one role'),
  /** Wings whose transactions the user works on. */
  wingIds: z.array(z.uuid()).default([]),
  /** Access to every wing, including wings added later (e.g. central finance, administrators). */
  allWings: z.boolean().default(false),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.strictObject({
  fullName: nameSchema.optional(),
  status: z.enum(USER_STATUSES).optional(),
  roleIds: z.array(z.uuid()).min(1, 'Select at least one role').optional(),
  wingIds: z.array(z.uuid()).optional(),
  allWings: z.boolean().optional(),
});
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const resetPasswordSchema = z.strictObject({ newPassword: passwordSchema });

export const userListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(USER_STATUSES).optional(),
  roleId: z.uuid().optional(),
  permission: z.enum(ALL_PERMISSIONS as [string, ...string[]]).optional(),
  /** Only users with access to this wing (assigned to it, or to all wings). */
  wingId: z.uuid().optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

const permissionListSchema = z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]]));

export const roleCreateSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,49}$/, 'Upper-case letters, digits and underscore; must start with a letter'),
  name: nameSchema,
  description: z.string().trim().max(500).nullish(),
  permissions: permissionListSchema.default([]),
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const roleUpdateSchema = z.strictObject({
  name: nameSchema.optional(),
  description: z.string().trim().max(500).nullish(),
  permissions: permissionListSchema.optional(),
});
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;

// ---- Workflow routing rules -------------------------------------------------------------------
export const routingConditionsSchema = z.strictObject({
  wingIds: z.array(z.uuid()).optional(),
  salesTypeIds: z.array(z.uuid()).optional(),
  partyIds: z.array(z.uuid()).optional(),
  minAmount: moneyOrZeroSchema.optional(),
  maxAmount: moneyOrZeroSchema.optional(),
  isSpecial: z.boolean().optional(),
});

export const workflowRuleCreateSchema = z.strictObject({
  name: nameSchema,
  description: z.string().trim().max(500).nullish(),
  priority: z.number().int().min(1).max(10000),
  conditions: routingConditionsSchema,
  targetRoleId: z.uuid('Target role is required'),
  isActive: z.boolean().default(true),
  effectiveFrom: isoDateSchema.nullish(),
  effectiveTo: isoDateSchema.nullish(),
});
export type WorkflowRuleCreateInput = z.infer<typeof workflowRuleCreateSchema>;

export const workflowRuleUpdateSchema = workflowRuleCreateSchema.partial();
export type WorkflowRuleUpdateInput = z.infer<typeof workflowRuleUpdateSchema>;

export const workflowSimulateSchema = z.strictObject({
  wingId: z.uuid().optional(),
  salesTypeId: z.uuid(),
  partyId: z.uuid().optional(),
  amount: moneySchema,
});
export type WorkflowSimulateInput = z.infer<typeof workflowSimulateSchema>;

// ---- Business rules ---------------------------------------------------------------------------
const restrictionMode = z.enum(['ALLOW', 'DENY']);

export const businessRuleParamsSchemas = {
  MIN_AMOUNT: z.strictObject({ amount: moneyOrZeroSchema }),
  MAX_AMOUNT: z.strictObject({ amount: moneyOrZeroSchema }),
  REQUIRED_FIELD: z.strictObject({
    fields: z.array(z.enum([...TRANSACTION_EDITABLE_FIELDS, ATTACHMENTS_FIELD])).min(1),
  }),
  PARTY_RESTRICTION: z.strictObject({ mode: restrictionMode, partyIds: z.array(z.uuid()).min(1) }),
  ACCOUNT_RESTRICTION: z.strictObject({ mode: restrictionMode, accountIds: z.array(z.uuid()).min(1) }),
  APPROVAL_LEVEL: z.strictObject({
    minAmount: moneyOrZeroSchema,
    requiredRoleCode: z.string().trim().min(1),
  }),
} as const satisfies Record<(typeof BUSINESS_RULE_TYPES)[number], z.ZodType>;

export const businessRuleCreateSchema = z.strictObject({
  name: nameSchema,
  description: z.string().trim().max(500).nullish(),
  type: z.enum(BUSINESS_RULE_TYPES),
  params: z.record(z.string(), z.unknown()),
  trigger: z.enum(RULE_TRIGGERS),
  severity: z.enum(RULE_SEVERITIES).default('ERROR'),
  isActive: z.boolean().default(true),
});
export type BusinessRuleCreateInput = z.infer<typeof businessRuleCreateSchema>;

export const businessRuleUpdateSchema = businessRuleCreateSchema.omit({ type: true }).partial();
export type BusinessRuleUpdateInput = z.infer<typeof businessRuleUpdateSchema>;

// ---- System settings --------------------------------------------------------------------------
export const SETTING_DEFINITIONS = {
  'business.currency': {
    schema: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. USD'),
    default: 'USD',
    description: 'Currency code used to display amounts',
  },
  'business.timezone': {
    schema: z.string().min(1).max(64),
    default: 'UTC',
    description: 'IANA time zone used for "today" calculations and transaction numbering',
  },
  'transaction.maxBackdateDays': {
    schema: z.number().int().min(0).max(3650),
    default: 90,
    description: 'How many days in the past a transaction date may be',
  },
  'transaction.allowFutureDate': {
    schema: z.boolean(),
    default: false,
    description: 'Allow transaction dates in the future',
  },
  'duplicate.possibleWindowDays': {
    schema: z.number().int().min(0).max(60),
    default: 3,
    description: 'Date window (± days) for POSSIBLE_DUPLICATE detection',
  },
  'upload.maxFileSizeMb': {
    schema: z.number().int().min(1).max(100),
    default: 10,
    description: 'Maximum attachment size (capped by MAX_UPLOAD_MB)',
  },
  'upload.maxFilesPerTransaction': {
    schema: z.number().int().min(1).max(50),
    default: 10,
    description: 'Maximum number of attachments per transaction',
  },
  'workflow.salesAdminEditableFields': {
    schema: z.array(z.enum(REVIEWER_EDITABLE_FIELDS)),
    default: ['remarks', 'salesTypeId', 'bankId', 'accountId', 'paymentReference'],
    description: 'Fields a Sales Admin may edit during review',
  },
  'workflow.financeEditableFields': {
    schema: z.array(z.enum(REVIEWER_EDITABLE_FIELDS)),
    default: ['remarks', 'bankId', 'accountId', 'paymentReference'],
    description: 'Fields Accountant / Treasury may edit during review',
  },
  'security.maxFailedLogins': {
    schema: z.number().int().min(3).max(20),
    default: 5,
    description: 'Failed logins before the account is temporarily locked',
  },
  'security.lockoutMinutes': {
    schema: z.number().int().min(1).max(1440),
    default: 15,
    description: 'Lockout duration after too many failed logins',
  },
  'report.maxExportRows': {
    schema: z.number().int().min(100).max(500000),
    default: 50000,
    description: 'Maximum rows per report export',
  },
} as const;
export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]['schema']>;
export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export const settingUpdateSchema = z.strictObject({ value: z.unknown() });

// ---- Notifications, audit, dashboard, reports -------------------------------------------------
export const notificationListQuerySchema = paginationQuerySchema.extend({
  unreadOnly: booleanStringSchema.optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const auditListQuerySchema = paginationQuerySchema.extend({
  userId: z.uuid().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  entityType: z.string().trim().max(50).optional(),
  entityId: z.uuid().optional(),
  requestId: z.string().trim().max(100).optional(),
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional(),
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export const dashboardQuerySchema = transactionFilterSchema.omit({ q: true, duplicateStatus: true });
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const reportQuerySchema = paginationQuerySchema.extend({
  ...transactionFilterSchema.shape,
  stage: z.enum(APPROVAL_STAGES).optional(),
  decision: z.enum(APPROVAL_DECISIONS).optional(),
  userId: z.uuid().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  entityType: z.string().trim().max(50).optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const reportExportQuerySchema = reportQuerySchema.extend({
  format: z.enum(['csv', 'xlsx']).default('csv'),
});
export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;

export const reportTypeParamSchema = z.object({ type: z.enum(REPORT_TYPES) });
