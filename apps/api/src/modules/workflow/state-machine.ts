/**
 * The sales-approval state machine. This file is the ONLY place that defines which status
 * changes exist, who may perform them and under which guards. It is pure (no I/O) so it can be
 * unit-tested exhaustively and reused to compute the actions offered in the UI.
 */
import {
  ERROR_CODES,
  type ApprovalDecision,
  type ApprovalStage,
  type AuditAction,
  type DuplicateResolution,
  type DuplicateStatus,
  type ErrorCode,
  type HistoryAction,
  type Permission,
  type TransactionEditableField,
  type TransactionStatus,
  type TransactionUiAction,
  type WorkflowAction,
  TRANSACTION_EDITABLE_FIELDS,
  WORKFLOW_ACTIONS,
} from '@paragon/shared';

export const WORKFLOW_DEFINITION_CODE = 'SALES_APPROVAL_V1';

export interface TransitionDef {
  from: readonly TransactionStatus[];
  to: TransactionStatus;
  permission: Permission;
  actor: 'OWNER' | 'REVIEWER';
  stage?: ApprovalStage;
  decision?: ApprovalDecision;
  requiresReason?: boolean;
  requiresCategory?: boolean;
  history: HistoryAction;
  audit: AuditAction;
}

const ACTIVE: readonly TransactionStatus[] = ['DRAFT', 'SALES_ADMIN_REVIEW', 'FINANCE_REVIEW', 'CORRECTION_REQUIRED'];

export const TRANSITIONS: Readonly<Record<WorkflowAction, TransitionDef>> = {
  SUBMIT: { from: ['DRAFT'], to: 'SALES_ADMIN_REVIEW', permission: 'SALES_SUBMIT', actor: 'OWNER', history: 'SUBMITTED', audit: 'SUBMIT_TRANSACTION' },
  RESUBMIT: { from: ['CORRECTION_REQUIRED'], to: 'SALES_ADMIN_REVIEW', permission: 'SALES_SUBMIT', actor: 'OWNER', history: 'RESUBMITTED', audit: 'RESUBMIT_TRANSACTION' },
  CANCEL: { from: ACTIVE, to: 'CANCELLED', permission: 'SALES_EDIT', actor: 'OWNER', history: 'CANCELLED', audit: 'CANCEL_TRANSACTION' },

  SA_APPROVE: { from: ['SALES_ADMIN_REVIEW'], to: 'FINANCE_REVIEW', permission: 'SALES_ADMIN_APPROVE', actor: 'REVIEWER', stage: 'SALES_ADMIN', decision: 'APPROVED', history: 'SALES_ADMIN_APPROVED', audit: 'APPROVE_TRANSACTION' },
  SA_RETURN: { from: ['SALES_ADMIN_REVIEW'], to: 'CORRECTION_REQUIRED', permission: 'SALES_ADMIN_REJECT', actor: 'REVIEWER', stage: 'SALES_ADMIN', decision: 'RETURNED', requiresReason: true, requiresCategory: true, history: 'SALES_ADMIN_RETURNED', audit: 'RETURN_TRANSACTION' },
  SA_REJECT: { from: ['SALES_ADMIN_REVIEW'], to: 'REJECTED', permission: 'SALES_ADMIN_REJECT', actor: 'REVIEWER', stage: 'SALES_ADMIN', decision: 'REJECTED', requiresReason: true, history: 'SALES_ADMIN_REJECTED', audit: 'REJECT_TRANSACTION' },

  FIN_APPROVE: { from: ['FINANCE_REVIEW'], to: 'READY_FOR_PROCESSING', permission: 'FINANCE_APPROVE', actor: 'REVIEWER', stage: 'FINANCE', decision: 'APPROVED', history: 'FINANCE_APPROVED', audit: 'APPROVE_TRANSACTION' },
  FIN_RETURN: { from: ['FINANCE_REVIEW'], to: 'CORRECTION_REQUIRED', permission: 'FINANCE_REJECT', actor: 'REVIEWER', stage: 'FINANCE', decision: 'RETURNED', requiresReason: true, requiresCategory: true, history: 'FINANCE_RETURNED', audit: 'RETURN_TRANSACTION' },
  FIN_REJECT: { from: ['FINANCE_REVIEW'], to: 'REJECTED', permission: 'FINANCE_REJECT', actor: 'REVIEWER', stage: 'FINANCE', decision: 'REJECTED', requiresReason: true, history: 'FINANCE_REJECTED', audit: 'REJECT_TRANSACTION' },
};

/** Maps the stage-agnostic REST verbs (/approve, /reject, /return) to a concrete action. */
export function resolveReviewAction(verb: 'approve' | 'reject' | 'return', status: TransactionStatus): WorkflowAction | null {
  const table: Partial<Record<TransactionStatus, Record<typeof verb, WorkflowAction>>> = {
    SALES_ADMIN_REVIEW: { approve: 'SA_APPROVE', reject: 'SA_REJECT', return: 'SA_RETURN' },
    FINANCE_REVIEW: { approve: 'FIN_APPROVE', reject: 'FIN_REJECT', return: 'FIN_RETURN' },
  };
  return table[status]?.[verb] ?? null;
}

export function stageOf(status: TransactionStatus): ApprovalStage | null {
  if (status === 'SALES_ADMIN_REVIEW') return 'SALES_ADMIN';
  if (status === 'FINANCE_REVIEW') return 'FINANCE';
  return null;
}

// ---- Guards -----------------------------------------------------------------------------------

export interface GuardSubject {
  status: TransactionStatus;
  wingId: string;
  createdById: string;
  fieldForceUserId: string;
  assignedRoleId: string | null;
  assignedUserId: string | null;
  duplicateStatus: DuplicateStatus;
  duplicateResolution: DuplicateResolution | null;
  /** User who gave Sales Admin approval in the current cycle (segregation of duties). */
  salesAdminApproverId: string | null;
}

export interface GuardActor {
  id: string;
  permissions: ReadonlySet<Permission>;
  roleIds: readonly string[];
  /** Wings the actor reviews (ignored when `allWings`). */
  wingIds: readonly string[];
  allWings: boolean;
}

export type GuardResult = { ok: true } | { ok: false; status: 403 | 422; code: ErrorCode; message: string };

const OK: GuardResult = { ok: true };
const deny = (status: 403 | 422, code: ErrorCode, message: string): GuardResult => ({ ok: false, status, code, message });

export function isOwner(subject: Pick<GuardSubject, 'createdById' | 'fieldForceUserId'>, actor: Pick<GuardActor, 'id'>): boolean {
  return subject.createdById === actor.id || subject.fieldForceUserId === actor.id;
}

/** Whether the actor works on the transaction's wing. */
export function onWing(subject: Pick<GuardSubject, 'wingId'>, actor: Pick<GuardActor, 'wingIds' | 'allWings'>): boolean {
  return actor.allWings || actor.wingIds.includes(subject.wingId);
}

/** Whether the actor is an eligible reviewer for the transaction's current stage (ignores claims). */
export function isStageReviewer(subject: GuardSubject, actor: GuardActor): boolean {
  if (isOwner(subject, actor) || !onWing(subject, actor)) return false;
  const stage = stageOf(subject.status);
  if (stage === 'SALES_ADMIN') return actor.permissions.has('SALES_ADMIN_REVIEW');
  if (stage === 'FINANCE') {
    return actor.permissions.has('FINANCE_REVIEW') && !!subject.assignedRoleId && actor.roleIds.includes(subject.assignedRoleId);
  }
  return false;
}

export function checkTransition(action: WorkflowAction, subject: GuardSubject, actor: GuardActor): GuardResult {
  const def = TRANSITIONS[action];
  if (!def.from.includes(subject.status)) {
    return deny(422, ERROR_CODES.INVALID_TRANSITION, `Action ${action} is not allowed while the transaction is ${subject.status}`);
  }
  const owner = isOwner(subject, actor);

  if (def.actor === 'OWNER') {
    if (action === 'CANCEL') {
      const ownerMayCancel =
        owner && actor.permissions.has('SALES_EDIT') && (subject.status === 'DRAFT' || subject.status === 'CORRECTION_REQUIRED');
      if (ownerMayCancel || actor.permissions.has('TRANSACTION_CANCEL_ANY')) return OK;
      return deny(403, ERROR_CODES.FORBIDDEN, 'You cannot cancel this transaction');
    }
    if (!actor.permissions.has(def.permission)) return deny(403, ERROR_CODES.FORBIDDEN, 'You do not have permission to perform this action');
    if (!owner) return deny(403, ERROR_CODES.FORBIDDEN, 'Only the owner of the transaction can perform this action');
    return OK;
  }

  // Reviewer actions
  if (!actor.permissions.has(def.permission)) return deny(403, ERROR_CODES.FORBIDDEN, 'You do not have permission to perform this action');
  if (owner) return deny(403, ERROR_CODES.SELF_APPROVAL_FORBIDDEN, 'You cannot review your own transaction');
  if (!onWing(subject, actor)) return deny(403, ERROR_CODES.WING_NOT_ASSIGNED, 'This transaction belongs to a wing you are not assigned to');
  if (def.stage === 'FINANCE' && !(subject.assignedRoleId && actor.roleIds.includes(subject.assignedRoleId))) {
    return deny(403, ERROR_CODES.NOT_ASSIGNED_ROLE, 'This transaction is assigned to a different finance role');
  }
  if (subject.assignedUserId && subject.assignedUserId !== actor.id) {
    return deny(403, ERROR_CODES.CLAIMED_BY_OTHER, 'This transaction is claimed by another reviewer');
  }
  if (action === 'FIN_APPROVE' && subject.salesAdminApproverId === actor.id) {
    return deny(403, ERROR_CODES.SEGREGATION_OF_DUTIES, 'The Sales Admin approver cannot also give the final approval');
  }
  if (def.decision === 'APPROVED') {
    if (subject.duplicateResolution === 'CONFIRMED_DUPLICATE') {
      return deny(422, ERROR_CODES.DUPLICATE_CONFIRMED, 'This transaction was confirmed as a duplicate and cannot be approved');
    }
    if (subject.duplicateStatus === 'EXACT_DUPLICATE' && subject.duplicateResolution !== 'NOT_DUPLICATE') {
      return deny(422, ERROR_CODES.DUPLICATE_UNRESOLVED, 'Resolve the exact-duplicate warning before approving');
    }
  }
  return OK;
}

// ---- Derived UI capabilities ------------------------------------------------------------------

export interface EditPolicy {
  salesAdminEditableFields: readonly TransactionEditableField[];
  financeEditableFields: readonly TransactionEditableField[];
}

function claimOk(subject: GuardSubject, actor: GuardActor): boolean {
  return !subject.assignedUserId || subject.assignedUserId === actor.id;
}

export function editableFields(subject: GuardSubject, actor: GuardActor, policy: EditPolicy): TransactionEditableField[] {
  switch (subject.status) {
    case 'DRAFT':
    case 'CORRECTION_REQUIRED':
      if (!isOwner(subject, actor) || !actor.permissions.has('SALES_EDIT')) return [];
      return TRANSACTION_EDITABLE_FIELDS.filter((f) => f !== 'fieldForceUserId' || actor.permissions.has('SALES_VIEW_ALL'));
    case 'SALES_ADMIN_REVIEW':
      return actor.permissions.has('SALES_ADMIN_EDIT') && isStageReviewer(subject, actor) && claimOk(subject, actor)
        ? [...policy.salesAdminEditableFields]
        : [];
    case 'FINANCE_REVIEW':
      return actor.permissions.has('FINANCE_EDIT') && isStageReviewer(subject, actor) && claimOk(subject, actor)
        ? [...policy.financeEditableFields]
        : [];
    default:
      return [];
  }
}

export function allowedActions(
  subject: GuardSubject,
  actor: GuardActor,
  policy: EditPolicy,
): (WorkflowAction | TransactionUiAction)[] {
  const out: (WorkflowAction | TransactionUiAction)[] = WORKFLOW_ACTIONS.filter(
    (a) => checkTransition(a, subject, actor).ok,
  );
  const editable = editableFields(subject, actor, policy).length > 0;
  if (editable) out.push('EDIT', 'UPLOAD_ATTACHMENT');
  const inReview = stageOf(subject.status) !== null;
  if (inReview && isStageReviewer(subject, actor) && !subject.assignedUserId) out.push('CLAIM');
  if (inReview && subject.assignedUserId && (subject.assignedUserId === actor.id || actor.permissions.has('TRANSACTION_ASSIGN'))) {
    out.push('RELEASE');
  }
  if (inReview && actor.permissions.has('TRANSACTION_ASSIGN')) out.push('REASSIGN');
  if (
    inReview &&
    actor.permissions.has('EXCEPTION_RESOLVE') &&
    !isOwner(subject, actor) &&
    onWing(subject, actor) &&
    subject.duplicateStatus !== 'NO_DUPLICATE' &&
    subject.duplicateResolution === 'PENDING'
  ) {
    out.push('RESOLVE_DUPLICATE');
  }
  return out;
}
