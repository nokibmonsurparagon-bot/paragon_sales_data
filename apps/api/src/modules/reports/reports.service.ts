import type { Writable } from 'node:stream';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  CORRECTION_CATEGORY_LABELS,
  TRANSACTION_STATUS_LABELS,
  neutralizeSpreadsheetCell,
  toCsvRow,
  type Permission,
  type ReportColumn,
  type ReportExportQuery,
  type ReportPage,
  type ReportQuery,
  type ReportType,
} from '@paragon/shared';
import { writeAudit } from '../../core/audit.js';
import type { AuthenticatedUser } from '../../core/context.js';
import { prisma } from '../../core/db.js';
import { AuthorizationError } from '../../core/errors.js';
import { getSetting } from '../../core/settings.js';
import { auditWhere } from '../audit/audit.service.js';
import { dateOnly, money } from '../transactions/transaction.mapper.js';
import { filterWhere, scopeWhere } from '../transactions/transaction.repository.js';

type Row = Record<string, string | number | null>;

interface ReportDef {
  title: string;
  /** All listed permissions are required (in addition to REPORT_VIEW). */
  requires: Permission[];
  columns: ReportColumn[];
  count(q: ReportQuery, user: AuthenticatedUser): Promise<number>;
  rows(q: ReportQuery, user: AuthenticatedUser, skip: number, take: number): Promise<Row[]>;
}

const txBase = (q: ReportQuery, user: AuthenticatedUser): Prisma.SalesTransactionWhereInput => ({
  AND: [scopeWhere(user), filterWhere(q)],
});

function decisionWhere(q: ReportQuery, user: AuthenticatedUser, decisions: ('APPROVED' | 'REJECTED' | 'RETURNED')[]): Prisma.ApprovalRecordWhereInput {
  return {
    decision: { in: q.decision && decisions.includes(q.decision) ? [q.decision] : decisions },
    ...(q.stage ? { stage: q.stage } : {}),
    ...(q.userId ? { approverId: q.userId } : {}),
    transaction: txBase(q, user),
  };
}

const decisionInclude = {
  approver: { select: { fullName: true } },
  transaction: {
    select: { transactionNumber: true, amount: true, wing: { select: { name: true } }, party: { select: { name: true } } },
  },
} satisfies Prisma.ApprovalRecordInclude;

function decisionRow(a: Prisma.ApprovalRecordGetPayload<{ include: typeof decisionInclude }>): Row {
  return {
    decidedAt: a.createdAt.toISOString(),
    transactionNumber: a.transaction.transactionNumber,
    wing: a.transaction.wing.name,
    stage: a.stage,
    decision: a.decision,
    approver: a.approver.fullName,
    approverRole: a.approverRole,
    cycle: a.cycle,
    amount: money(a.transaction.amount),
    party: a.transaction.party?.name ?? null,
    category: a.correctionCategory ? CORRECTION_CATEGORY_LABELS[a.correctionCategory] : null,
    reason: a.reason,
  };
}

const decisionColumns: ReportColumn[] = [
  { key: 'decidedAt', label: 'Decided At' },
  { key: 'transactionNumber', label: 'Transaction No.' },
  { key: 'wing', label: 'Wing' },
  { key: 'stage', label: 'Stage' },
  { key: 'decision', label: 'Decision' },
  { key: 'approver', label: 'Reviewer' },
  { key: 'approverRole', label: 'Role' },
  { key: 'cycle', label: 'Cycle' },
  { key: 'amount', label: 'Amount' },
  { key: 'party', label: 'Farmer / Customer' },
  { key: 'category', label: 'Category' },
  { key: 'reason', label: 'Reason / Comment' },
];

function auditReportWhere(q: ReportQuery) {
  return auditWhere({ userId: q.userId, action: q.action, entityType: q.entityType, dateFrom: q.dateFrom, dateTo: q.dateTo });
}

const REPORTS: Record<ReportType, ReportDef> = {
  sales: {
    title: 'Sales Transaction Report',
    requires: [],
    columns: [
      { key: 'transactionNumber', label: 'Transaction No.' },
      { key: 'wing', label: 'Wing' },
      { key: 'transactionDate', label: 'Date' },
      { key: 'status', label: 'Status' },
      { key: 'fieldForce', label: 'Field Force' },
      { key: 'line', label: 'Line Name' },
      { key: 'branch', label: 'Branch Code' },
      { key: 'cvCode', label: 'CV Code' },
      { key: 'party', label: 'Farmer / Customer' },
      { key: 'amount', label: 'Deposit Amount' },
      { key: 'creditAmount', label: 'Amount (CR)' },
      { key: 'bankCharge', label: 'Bank Charge' },
      { key: 'bank', label: 'Bank' },
      { key: 'account', label: 'Account' },
      { key: 'bankDetails', label: 'Bank Branch / Bank Details' },
      { key: 'paymentReference', label: 'Payment Reference' },
      { key: 'salesType', label: 'Sales Type' },
      { key: 'narration', label: 'Narration' },
      { key: 'duplicateStatus', label: 'Duplicate Check' },
      { key: 'submittedAt', label: 'Submitted At' },
      { key: 'finalApprovedAt', label: 'Final Approval' },
    ],
    count: (q, user) => prisma.salesTransaction.count({ where: txBase(q, user) }),
    async rows(q, user, skip, take) {
      const rows = await prisma.salesTransaction.findMany({
        where: txBase(q, user),
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
        include: {
          wing: { select: { name: true } },
          fieldForce: { select: { fullName: true } },
          line: { select: { name: true } },
          branch: { select: { code: true } },
          cvCode: { select: { code: true } },
          party: { select: { name: true } },
          bank: { select: { name: true } },
          account: { select: { code: true, name: true } },
          salesType: { select: { name: true } },
        },
      });
      return rows.map((t) => ({
        transactionNumber: t.transactionNumber,
        wing: t.wing.name,
        transactionDate: dateOnly(t.transactionDate),
        status: TRANSACTION_STATUS_LABELS[t.status],
        fieldForce: t.fieldForce.fullName,
        line: t.line?.name ?? null,
        branch: t.branch?.code ?? null,
        cvCode: t.cvCode?.code ?? null,
        party: t.party?.name ?? null,
        amount: money(t.amount),
        creditAmount: money(t.creditAmount),
        bankCharge: money(t.bankCharge),
        bank: t.bank?.name ?? null,
        account: t.account ? `${t.account.code} – ${t.account.name}` : null,
        bankDetails: t.bankDetails,
        paymentReference: t.paymentReference,
        salesType: t.salesType?.name ?? null,
        narration: t.remarks,
        duplicateStatus: t.duplicateStatus,
        submittedAt: t.submittedAt?.toISOString() ?? null,
        finalApprovedAt: t.finalApprovedAt?.toISOString() ?? null,
      }));
    },
  },
  approvals: {
    title: 'Approval Report',
    requires: [],
    columns: decisionColumns.filter((c) => c.key !== 'category'),
    count: (q, user) => prisma.approvalRecord.count({ where: decisionWhere(q, user, ['APPROVED']) }),
    async rows(q, user, skip, take) {
      const rows = await prisma.approvalRecord.findMany({
        where: decisionWhere(q, user, ['APPROVED']),
        include: decisionInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      });
      return rows.map(decisionRow);
    },
  },
  rejections: {
    title: 'Rejection Report',
    requires: [],
    columns: decisionColumns,
    count: (q, user) => prisma.approvalRecord.count({ where: decisionWhere(q, user, ['REJECTED', 'RETURNED']) }),
    async rows(q, user, skip, take) {
      const rows = await prisma.approvalRecord.findMany({
        where: decisionWhere(q, user, ['REJECTED', 'RETURNED']),
        include: decisionInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      });
      return rows.map(decisionRow);
    },
  },
  'user-activity': {
    title: 'User Activity Report',
    requires: ['AUDIT_VIEW'],
    columns: [
      { key: 'createdAt', label: 'Time' },
      { key: 'user', label: 'User' },
      { key: 'role', label: 'Role' },
      { key: 'action', label: 'Action' },
      { key: 'entityType', label: 'Entity' },
      { key: 'entityId', label: 'Entity ID' },
      { key: 'ipAddress', label: 'IP Address' },
    ],
    count: (q) => prisma.auditLog.count({ where: { ...auditReportWhere(q), userId: q.userId ?? { not: null } } }),
    async rows(q, _user, skip, take) {
      const rows = await prisma.auditLog.findMany({
        where: { ...auditReportWhere(q), userId: q.userId ?? { not: null } },
        include: { user: { select: { fullName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      });
      return rows.map((a) => ({
        createdAt: a.createdAt.toISOString(),
        user: a.user?.fullName ?? null,
        role: a.role,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        ipAddress: a.ipAddress,
      }));
    },
  },
  audit: {
    title: 'Audit Report',
    requires: ['AUDIT_VIEW'],
    columns: [
      { key: 'createdAt', label: 'Time' },
      { key: 'user', label: 'User' },
      { key: 'role', label: 'Role' },
      { key: 'action', label: 'Action' },
      { key: 'entityType', label: 'Entity' },
      { key: 'entityId', label: 'Entity ID' },
      { key: 'previousData', label: 'Previous Data' },
      { key: 'newData', label: 'New Data' },
      { key: 'ipAddress', label: 'IP Address' },
      { key: 'requestId', label: 'Request ID' },
    ],
    count: (q) => prisma.auditLog.count({ where: auditReportWhere(q) }),
    async rows(q, _user, skip, take) {
      const rows = await prisma.auditLog.findMany({
        where: auditReportWhere(q),
        include: { user: { select: { fullName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      });
      return rows.map((a) => ({
        createdAt: a.createdAt.toISOString(),
        user: a.user?.fullName ?? null,
        role: a.role,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        previousData: a.previousData === null ? null : JSON.stringify(a.previousData),
        newData: a.newData === null ? null : JSON.stringify(a.newData),
        ipAddress: a.ipAddress,
        requestId: a.requestId,
      }));
    },
  },
};

function definition(type: ReportType, user: AuthenticatedUser): ReportDef {
  const def = REPORTS[type];
  if (!def.requires.every((p) => user.permissions.has(p))) throw new AuthorizationError();
  return def;
}

const BATCH = 1000;

export const reportsService = {
  async page(type: ReportType, q: ReportQuery, user: AuthenticatedUser): Promise<ReportPage> {
    const def = definition(type, user);
    const [total, rows] = await Promise.all([def.count(q, user), def.rows(q, user, (q.page - 1) * q.limit, q.limit)]);
    return { columns: def.columns, rows, page: q.page, limit: q.limit, total };
  },

  /** Streams the export in batches (never loads the full result set in memory). */
  async export(type: ReportType, q: ReportExportQuery, user: AuthenticatedUser, out: Writable & { setHeader?: (k: string, v: string) => void }) {
    const def = definition(type, user);
    const maxRows = await getSetting('report.maxExportRows');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const fileName = `${type}-report-${stamp}.${q.format}`;
    out.setHeader?.('Content-Disposition', `attachment; filename="${fileName}"`);
    out.setHeader?.('Cache-Control', 'no-store');

    let written = 0;
    const forEachBatch = async (fn: (rows: Row[]) => Promise<void> | void) => {
      for (let skip = 0; skip < maxRows; skip += BATCH) {
        const rows = await def.rows(q, user, skip, Math.min(BATCH, maxRows - skip));
        if (!rows.length) break;
        await fn(rows);
        written += rows.length;
        if (rows.length < BATCH) break;
      }
    };

    if (q.format === 'csv') {
      out.setHeader?.('Content-Type', 'text/csv; charset=utf-8');
      out.write('﻿' + toCsvRow(def.columns.map((c) => c.label)) + '\r\n');
      await forEachBatch((rows) => {
        out.write(rows.map((r) => toCsvRow(def.columns.map((c) => r[c.key]))).join('\r\n') + '\r\n');
      });
      out.end();
    } else {
      out.setHeader?.('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true });
      const ws = wb.addWorksheet(def.title.slice(0, 31));
      ws.columns = def.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4) }));
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).commit();
      await forEachBatch((rows) => {
        for (const r of rows) {
          ws.addRow(Object.fromEntries(def.columns.map((c) => [c.key, neutralizeSpreadsheetCell(r[c.key])]))).commit();
        }
      });
      ws.commit();
      await wb.commit();
    }

    await writeAudit({
      action: 'EXPORT_REPORT',
      entityType: 'Report',
      entityId: type,
      newData: { format: q.format, rows: written, filters: { ...q, page: undefined, limit: undefined } },
    });
  },
};
