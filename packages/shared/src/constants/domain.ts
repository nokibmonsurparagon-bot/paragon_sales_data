/**
 * Domain enumerations shared by API (Prisma enums mirror these) and web.
 * Keep in sync with apps/api/prisma/schema.prisma – a unit test asserts they match.
 */

export const TRANSACTION_STATUSES = [
  'DRAFT',
  'SALES_ADMIN_REVIEW',
  'FINANCE_REVIEW',
  'CORRECTION_REQUIRED',
  'REJECTED',
  'READY_FOR_PROCESSING',
  'CANCELLED',
] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  DRAFT: 'Draft',
  SALES_ADMIN_REVIEW: 'Sales Admin Review',
  FINANCE_REVIEW: 'Finance Review',
  CORRECTION_REQUIRED: 'Correction Required',
  REJECTED: 'Rejected',
  READY_FOR_PROCESSING: 'Ready for Processing',
  CANCELLED: 'Cancelled',
};

export const TERMINAL_STATUSES: readonly TransactionStatus[] = ['REJECTED', 'READY_FOR_PROCESSING', 'CANCELLED'];

/** Workflow actions – the only way a transaction status can change. */
export const WORKFLOW_ACTIONS = [
  'SUBMIT',
  'RESUBMIT',
  'CANCEL',
  'SA_APPROVE',
  'SA_RETURN',
  'SA_REJECT',
  'FIN_APPROVE',
  'FIN_RETURN',
  'FIN_REJECT',
] as const;
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

/** Actions that do not change status but are offered to the user alongside workflow actions. */
export const TRANSACTION_UI_ACTIONS = [
  'EDIT',
  'CLAIM',
  'RELEASE',
  'REASSIGN',
  'UPLOAD_ATTACHMENT',
  'RESOLVE_DUPLICATE',
] as const;
export type TransactionUiAction = (typeof TRANSACTION_UI_ACTIONS)[number];

export const CORRECTION_CATEGORIES = [
  'ACCOUNT_ERROR',
  'BANK_ERROR',
  'PARTY_ERROR',
  'AMOUNT_ERROR',
  'DOCUMENT_ERROR',
  'BUSINESS_RULE_ERROR',
  'OTHER',
] as const;
export type CorrectionCategory = (typeof CORRECTION_CATEGORIES)[number];

export const CORRECTION_CATEGORY_LABELS: Record<CorrectionCategory, string> = {
  ACCOUNT_ERROR: 'Account error',
  BANK_ERROR: 'Bank error',
  PARTY_ERROR: 'Farmer / customer error',
  AMOUNT_ERROR: 'Amount error',
  DOCUMENT_ERROR: 'Document error',
  BUSINESS_RULE_ERROR: 'Business rule error',
  OTHER: 'Other',
};

export const DUPLICATE_STATUSES = ['NO_DUPLICATE', 'POSSIBLE_DUPLICATE', 'EXACT_DUPLICATE'] as const;
export type DuplicateStatus = (typeof DUPLICATE_STATUSES)[number];

export const DUPLICATE_RESOLUTIONS = ['PENDING', 'NOT_DUPLICATE', 'CONFIRMED_DUPLICATE'] as const;
export type DuplicateResolution = (typeof DUPLICATE_RESOLUTIONS)[number];

export const APPROVAL_STAGES = ['SALES_ADMIN', 'FINANCE'] as const;
export type ApprovalStage = (typeof APPROVAL_STAGES)[number];

export const APPROVAL_DECISIONS = ['APPROVED', 'RETURNED', 'REJECTED'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const MASTER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type MasterStatus = (typeof MASTER_STATUSES)[number];

export const BUSINESS_RULE_TYPES = [
  'MIN_AMOUNT',
  'MAX_AMOUNT',
  'REQUIRED_FIELD',
  'PARTY_RESTRICTION',
  'ACCOUNT_RESTRICTION',
  'APPROVAL_LEVEL',
] as const;
export type BusinessRuleType = (typeof BUSINESS_RULE_TYPES)[number];

/** When a business rule is evaluated. Later stages also evaluate earlier-stage rules. */
export const RULE_TRIGGERS = ['SAVE', 'SUBMIT', 'APPROVE'] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];

export const RULE_SEVERITIES = ['ERROR', 'WARNING'] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

/** Timeline entries (sales_transaction_history.action). */
export const HISTORY_ACTIONS = [
  'CREATED',
  'UPDATED',
  'SUBMITTED',
  'RESUBMITTED',
  'CANCELLED',
  'SALES_ADMIN_APPROVED',
  'SALES_ADMIN_RETURNED',
  'SALES_ADMIN_REJECTED',
  'FINANCE_APPROVED',
  'FINANCE_RETURNED',
  'FINANCE_REJECTED',
  'READY_FOR_PROCESSING',
  'CLAIMED',
  'RELEASED',
  'REASSIGNED',
  'ATTACHMENT_ADDED',
  'ATTACHMENT_REMOVED',
  'DUPLICATE_DETECTED',
  'DUPLICATE_RESOLVED',
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export const HISTORY_ACTION_LABELS: Record<HistoryAction, string> = {
  CREATED: 'Created transaction',
  UPDATED: 'Updated transaction',
  SUBMITTED: 'Submitted transaction',
  RESUBMITTED: 'Resubmitted transaction',
  CANCELLED: 'Cancelled transaction',
  SALES_ADMIN_APPROVED: 'Sales Admin approved',
  SALES_ADMIN_RETURNED: 'Sales Admin returned for correction',
  SALES_ADMIN_REJECTED: 'Sales Admin rejected',
  FINANCE_APPROVED: 'Finance approved',
  FINANCE_RETURNED: 'Finance returned for correction',
  FINANCE_REJECTED: 'Finance rejected',
  READY_FOR_PROCESSING: 'Ready for processing',
  CLAIMED: 'Claimed for review',
  RELEASED: 'Released back to queue',
  REASSIGNED: 'Reassigned',
  ATTACHMENT_ADDED: 'Attachment added',
  ATTACHMENT_REMOVED: 'Attachment removed',
  DUPLICATE_DETECTED: 'Duplicate check',
  DUPLICATE_RESOLVED: 'Duplicate resolved',
};

export const AUDIT_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'TOKEN_REUSE_DETECTED',
  'PASSWORD_CHANGED',
  'CREATE_TRANSACTION',
  'UPDATE_TRANSACTION',
  'SUBMIT_TRANSACTION',
  'RESUBMIT_TRANSACTION',
  'APPROVE_TRANSACTION',
  'RETURN_TRANSACTION',
  'REJECT_TRANSACTION',
  'CANCEL_TRANSACTION',
  'ASSIGN_TRANSACTION',
  'RESOLVE_DUPLICATE',
  'UPLOAD_ATTACHMENT',
  'DELETE_ATTACHMENT',
  'DOWNLOAD_ATTACHMENT',
  'CHANGE_MASTER_DATA',
  'CREATE_USER',
  'UPDATE_USER',
  'CHANGE_ROLE',
  'CHANGE_PERMISSION',
  'CHANGE_WORKFLOW_RULE',
  'CHANGE_BUSINESS_RULE',
  'CHANGE_SYSTEM_SETTING',
  'EXPORT_REPORT',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const NOTIFICATION_TYPES = [
  'REVIEW_REQUIRED',
  'TRANSACTION_APPROVED',
  'TRANSACTION_REJECTED',
  'CORRECTION_REQUIRED',
  'READY_FOR_PROCESSING',
  'TRANSACTION_ASSIGNED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Business fields of a sales transaction that can be edited (subject to stage rules). */
export const TRANSACTION_EDITABLE_FIELDS = [
  'wingId',
  'transactionDate',
  'fieldForceUserId',
  'lineId',
  'branchId',
  'cvCodeId',
  'partyId',
  'amount',
  'bankId',
  'accountId',
  'bankDetails',
  'paymentReference',
  'salesTypeId',
  'remarks',
] as const;
export type TransactionEditableField = (typeof TRANSACTION_EDITABLE_FIELDS)[number];

/**
 * Fields that settings may open up to Sales Admin / finance reviewers. The wing is excluded: it decides
 * who may see the transaction, so only the owner may change it (a wrong wing is returned for correction).
 */
export const REVIEWER_EDITABLE_FIELDS = [
  'transactionDate',
  'fieldForceUserId',
  'lineId',
  'branchId',
  'cvCodeId',
  'partyId',
  'amount',
  'bankId',
  'accountId',
  'bankDetails',
  'paymentReference',
  'salesTypeId',
  'remarks',
] as const satisfies readonly Exclude<TransactionEditableField, 'wingId'>[];

/** Pseudo-field usable in REQUIRED_FIELD rules: at least one attachment. */
export const ATTACHMENTS_FIELD = 'attachments';

export const TRANSACTION_FIELD_LABELS: Record<TransactionEditableField | typeof ATTACHMENTS_FIELD, string> = {
  wingId: 'Wing',
  transactionDate: 'Transaction Date',
  fieldForceUserId: 'Field Force',
  lineId: 'Line Name',
  branchId: 'Branch Code',
  cvCodeId: 'CV Code',
  partyId: 'Farmer / Customer',
  amount: 'Deposit Amount',
  bankId: 'Bank',
  accountId: 'Account',
  bankDetails: 'Bank Branch / Bank Details',
  paymentReference: 'Payment Reference',
  salesTypeId: 'Sales Type',
  remarks: 'Narration',
  attachments: 'Supporting Document',
};

export const ALLOWED_ATTACHMENT_EXTENSIONS = ['pdf', 'jpg', 'png', 'xlsx'] as const;
export type AttachmentExtension = (typeof ALLOWED_ATTACHMENT_EXTENSIONS)[number];

export const REPORT_TYPES = ['sales', 'approvals', 'rejections', 'user-activity', 'audit'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
