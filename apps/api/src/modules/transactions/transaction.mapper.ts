import type { Prisma } from '@prisma/client';
import type {
  AttachmentDto,
  TransactionDetail,
  TransactionEditableField,
  TransactionListItem,
  TransactionUiAction,
  WorkflowAction,
} from '@paragon/shared';
import type { TransactionDetailRow, TransactionListRow } from './transaction.repository.js';

export const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
export const money = (d: Prisma.Decimal | null): string | null => (d ? d.toFixed(2) : null);

export function toListItem(t: TransactionListRow): TransactionListItem {
  return {
    id: t.id,
    transactionNumber: t.transactionNumber,
    transactionDate: dateOnly(t.transactionDate),
    amount: money(t.amount),
    paymentReference: t.paymentReference,
    status: t.status,
    duplicateStatus: t.duplicateStatus,
    wing: t.wing,
    line: t.line,
    branch: t.branch,
    party: t.party,
    bank: t.bank,
    account: t.account,
    bankDetails: t.bankDetails,
    salesType: t.salesType ? { id: t.salesType.id, code: t.salesType.code, name: t.salesType.name } : null,
    creditAmount: money(t.creditAmount),
    bankCharge: money(t.bankCharge),
    fieldForce: t.fieldForce,
    assignedRole: t.assignedRole,
    assignedUser: t.assignedUser,
    attachmentCount: t._count.attachments,
    version: t.version,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toAttachmentDto(a: TransactionDetailRow['attachments'][number]): AttachmentDto {
  return {
    id: a.id,
    originalName: a.originalName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    sha256: a.sha256,
    uploadedAt: a.uploadedAt.toISOString(),
    uploadedBy: a.uploadedBy,
  };
}

export function toDetail(
  t: TransactionDetailRow,
  extras: {
    allowedActions: (WorkflowAction | TransactionUiAction)[];
    editableFields: TransactionEditableField[];
    warnings?: string[];
  },
): TransactionDetail {
  return {
    ...toListItem(t),
    remarks: t.remarks,
    rejectionReason: t.rejectionReason,
    correctionCategory: t.correctionCategory,
    latestComment: t.latestComment,
    duplicateOf: t.duplicateOf,
    duplicateResolution: t.duplicateResolution,
    duplicateResolutionNote: t.duplicateResolutionNote,
    submittedAt: t.submittedAt?.toISOString() ?? null,
    finalApprovedAt: t.finalApprovedAt?.toISOString() ?? null,
    createdBy: t.createdBy,
    updatedBy: t.updatedBy,
    attachments: t.attachments.map(toAttachmentDto),
    allowedActions: extras.allowedActions,
    editableFields: extras.editableFields,
    warnings: extras.warnings ?? [],
  };
}

/** Business-field values in API form (strings), used for validation, diffing and rules. */
export function businessFields(t: {
  wingId: string;
  transactionDate: Date | null;
  fieldForceUserId: string;
  lineId: string | null;
  branchId: string | null;
  partyId: string | null;
  amount: Prisma.Decimal | null;
  bankId: string | null;
  accountId: string | null;
  bankDetails: string | null;
  paymentReference: string | null;
  salesTypeId: string | null;
  remarks: string | null;
}): Record<TransactionEditableField, string | null> {
  return {
    wingId: t.wingId,
    transactionDate: dateOnly(t.transactionDate),
    fieldForceUserId: t.fieldForceUserId,
    lineId: t.lineId,
    branchId: t.branchId,
    partyId: t.partyId,
    amount: money(t.amount),
    bankId: t.bankId,
    accountId: t.accountId,
    bankDetails: t.bankDetails,
    paymentReference: t.paymentReference,
    salesTypeId: t.salesTypeId,
    remarks: t.remarks,
  };
}
