import type {
  ApprovalDecision,
  ApprovalStage,
  AuditAction,
  BusinessRuleType,
  CorrectionCategory,
  DuplicateResolution,
  DuplicateStatus,
  HistoryAction,
  MasterStatus,
  NotificationType,
  RuleSeverity,
  RuleTrigger,
  TransactionEditableField,
  TransactionStatus,
  TransactionUiAction,
  UserStatus,
  WorkflowAction,
} from '../constants/domain.js';
import type { Permission } from '../constants/permissions.js';

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
  requestId: string;
}

export interface ApiErrorDetail {
  path?: string;
  message: string;
  code?: string;
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details: ApiErrorDetail[] };
  requestId: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface Ref {
  id: string;
  code: string;
  name: string;
}

export interface UserRef {
  id: string;
  fullName: string;
  email: string;
}

// ---- Auth -------------------------------------------------------------------------------------
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  mustChangePassword: boolean;
  roles: { id: string; code: string; name: string }[];
  permissions: Permission[];
  /** Wings the user works on; when `allWings` is true this lists every wing. */
  wings: Ref[];
  allWings: boolean;
}

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

// ---- Master data ------------------------------------------------------------------------------
export interface MasterDataItem {
  id: string;
  code: string;
  name: string;
  status: MasterStatus;
  createdAt: string;
  updatedAt: string;
  bankId?: string;
  bank?: Ref;
  isSpecial?: boolean;
}

export interface MasterImportResult {
  /** Nothing is written when this is true, or when the file has errors. */
  dryRun: boolean;
  applied: boolean;
  fileName: string;
  totalRows: number;
  created: number;
  updated: number;
  unchanged: number;
  /** `row` = spreadsheet row number (1 = header row). */
  errors: { row: number; column?: string; message: string }[];
  /** First rows that would change / changed. */
  preview: { row: number; code: string; name: string; action: 'create' | 'update'; changes: string[] }[];
}

// ---- Transactions -----------------------------------------------------------------------------
export interface AttachmentDto {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  uploadedBy: UserRef;
}

export interface TransactionListItem {
  id: string;
  transactionNumber: string;
  transactionDate: string | null;
  amount: string | null;
  paymentReference: string | null;
  status: TransactionStatus;
  duplicateStatus: DuplicateStatus;
  wing: Ref;
  line: Ref | null;
  branch: Ref | null;
  /** Farmer / customer; `code` is the CV code. */
  party: Ref | null;
  bank: Ref | null;
  account: Ref | null;
  /** Depositor's bank branch / bank details (free text). */
  bankDetails: string | null;
  salesType: Ref | null;
  /** Amount (CR) entered by Accountant / Treasury at final approval. */
  creditAmount: string | null;
  /** Deposit amount − Amount (CR). */
  bankCharge: string | null;
  fieldForce: UserRef;
  assignedRole: { id: string; code: string; name: string } | null;
  assignedUser: UserRef | null;
  attachmentCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Only in the review queue: actions the current user may perform now (server still re-validates). */
  allowedActions?: (WorkflowAction | TransactionUiAction)[];
}

export interface TransactionDetail extends TransactionListItem {
  /** Narration. */
  remarks: string | null;
  rejectionReason: string | null;
  correctionCategory: CorrectionCategory | null;
  latestComment: string | null;
  duplicateOf: { id: string; transactionNumber: string } | null;
  duplicateResolution: DuplicateResolution | null;
  duplicateResolutionNote: string | null;
  submittedAt: string | null;
  finalApprovedAt: string | null;
  createdBy: UserRef;
  updatedBy: UserRef | null;
  attachments: AttachmentDto[];
  /** Actions the current user may perform now (server still re-validates). */
  allowedActions: (WorkflowAction | TransactionUiAction)[];
  /** Fields the current user may edit now. */
  editableFields: TransactionEditableField[];
  /** Non-blocking business rule warnings. */
  warnings: string[];
}

export interface HistoryEntry {
  id: string;
  action: HistoryAction;
  previousStatus: TransactionStatus | null;
  newStatus: TransactionStatus | null;
  actor: UserRef;
  actorRole: string | null;
  comment: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
}

export interface DuplicateCandidate {
  id: string;
  transactionNumber: string;
  classification: Exclude<DuplicateStatus, 'NO_DUPLICATE'>;
  matchedOn: string[];
  status: TransactionStatus;
  transactionDate: string | null;
  amount: string | null;
  party: Ref | null;
  paymentReference: string | null;
}

export interface WorkflowResult {
  transaction: TransactionDetail;
  warnings: string[];
}

/** Outcome of a bulk approve / reject: every item is processed on its own. */
export interface BulkActionResult {
  succeeded: number;
  failed: number;
  results: {
    id: string;
    transactionNumber: string | null;
    ok: boolean;
    /** Status after the action (success only). */
    status?: TransactionStatus;
    error?: { code: string; message: string };
    warnings: string[];
  }[];
}

// ---- Users & roles ----------------------------------------------------------------------------
export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  roles: { id: string; code: string; name: string }[];
  wings: Ref[];
  allWings: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionDto {
  id: string;
  code: Permission;
  module: string;
  description: string;
}

// ---- Workflow & rules -------------------------------------------------------------------------
export interface RoutingConditions {
  wingIds?: string[];
  salesTypeIds?: string[];
  partyIds?: string[];
  minAmount?: string;
  maxAmount?: string;
  isSpecial?: boolean;
}

export interface WorkflowRuleDto {
  id: string;
  name: string;
  description: string | null;
  priority: number;
  conditions: RoutingConditions;
  targetRole: { id: string; code: string; name: string };
  isActive: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessRuleDto {
  id: string;
  name: string;
  description: string | null;
  type: BusinessRuleType;
  params: Record<string, unknown>;
  trigger: RuleTrigger;
  severity: RuleSeverity;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SystemSettingDto {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

export interface ClientConfig {
  currency: string;
  timezone: string;
  maxUploadMb: number;
  allowedExtensions: string[];
  maxBackdateDays: number;
  allowFutureDate: boolean;
}

// ---- Notifications, dashboard, audit, reports ------------------------------------------------
export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
}

export interface DashboardWidget {
  key: string;
  label: string;
  value: number;
  /** Optional status the widget links to (list filter). */
  status?: TransactionStatus;
  /** Optional wing the widget links to (list filter). */
  wingId?: string;
  tone?: 'default' | 'info' | 'success' | 'warning' | 'error';
}

export interface DashboardSection {
  key: string;
  title: string;
  widgets: DashboardWidget[];
}

export interface ActivityItem {
  id: string;
  transactionId: string;
  transactionNumber: string;
  action: HistoryAction;
  actor: UserRef;
  actorRole: string | null;
  comment: string | null;
  createdAt: string;
}

export interface DashboardSummary {
  sections: DashboardSection[];
  recentActivity: ActivityItem[] | null;
}

export interface AuditLogDto {
  id: string;
  user: UserRef | null;
  role: string | null;
  action: AuditAction | string;
  entityType: string | null;
  entityId: string | null;
  previousData: unknown;
  newData: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface ApprovalRecordDto {
  id: string;
  transactionId: string;
  transactionNumber: string;
  stage: ApprovalStage;
  decision: ApprovalDecision;
  approver: UserRef;
  approverRole: string;
  reason: string | null;
  correctionCategory: CorrectionCategory | null;
  cycle: number;
  amount: string | null;
  party: Ref | null;
  createdAt: string;
}

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportPage {
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  page: number;
  limit: number;
  total: number;
}
