import type { Prisma } from '@prisma/client';
import type {
  ActivityItem,
  ApprovalDecision,
  ApprovalStage,
  DashboardQuery,
  DashboardSection,
  DashboardSummary,
  DashboardWidget,
  HistoryAction,
  TransactionStatus,
} from '@paragon/shared';
import { hasPermission, type AuthenticatedUser } from '../../core/context.js';
import { prisma } from '../../core/db.js';
import { businessToday, getSetting, startOfDayInZone } from '../../core/settings.js';
import { filterWhere, scopeWhere } from '../transactions/transaction.repository.js';

type Where = Prisma.SalesTransactionWhereInput;

const TONE: Partial<Record<TransactionStatus, DashboardWidget['tone']>> = {
  DRAFT: 'default',
  SALES_ADMIN_REVIEW: 'info',
  FINANCE_REVIEW: 'info',
  CORRECTION_REQUIRED: 'warning',
  REJECTED: 'error',
  READY_FOR_PROCESSING: 'success',
};

/**
 * Role-aware dashboard. Sections are chosen by permission (not by role name), so a user holding
 * several roles sees every relevant section. All counts honour data scope and filters.
 */
export const dashboardService = {
  async summary(q: DashboardQuery, user: AuthenticatedUser): Promise<DashboardSummary> {
    const base: Where = { AND: [scopeWhere(user), filterWhere(q)] };
    const count = (extra: Where) => prisma.salesTransaction.count({ where: { AND: [base, extra] } });
    const decisions = (stage: ApprovalStage, decision: ApprovalDecision, extra: Prisma.ApprovalRecordWhereInput = {}) =>
      prisma.approvalRecord.count({ where: { stage, decision, transaction: base, ...extra } });
    const statusWidget = async (key: string, label: string, status: TransactionStatus, extra: Where = {}): Promise<DashboardWidget> => ({
      key,
      label,
      status,
      tone: TONE[status],
      value: await count({ status, ...extra }),
    });

    const sections: DashboardSection[] = [];

    if (hasPermission(user, 'SALES_CREATE')) {
      const own: Where = { OR: [{ createdById: user.id }, { fieldForceUserId: user.id }] };
      sections.push({
        key: 'field-force',
        title: 'My Transactions',
        widgets: await Promise.all([
          statusWidget('drafts', 'Drafts', 'DRAFT', own),
          statusWidget('submitted', 'Submitted (awaiting Sales Admin)', 'SALES_ADMIN_REVIEW', own),
          statusWidget('under-review', 'Under Finance Review', 'FINANCE_REVIEW', own),
          statusWidget('correction', 'Correction Required', 'CORRECTION_REQUIRED', own),
          statusWidget('rejected', 'Rejected', 'REJECTED', own),
          statusWidget('ready', 'Approved – Ready for Processing', 'READY_FOR_PROCESSING', own),
        ]),
      });
    }

    if (hasPermission(user, 'SALES_ADMIN_REVIEW')) {
      const tz = await getSetting('business.timezone');
      const todayStart = startOfDayInZone(await businessToday(), tz);
      sections.push({
        key: 'sales-admin',
        title: 'Sales Admin',
        widgets: await Promise.all([
          statusWidget('pending', 'Pending Review', 'SALES_ADMIN_REVIEW'),
          decisions('SALES_ADMIN', 'APPROVED', { createdAt: { gte: todayStart } }).then((value) => ({
            key: 'approved-today', label: 'Approved Today', value, tone: 'success' as const,
          })),
          decisions('SALES_ADMIN', 'REJECTED').then((value) => ({ key: 'rejected', label: 'Rejected', value, tone: 'error' as const })),
          statusWidget('correction', 'Correction Required', 'CORRECTION_REQUIRED'),
          count({ status: { not: 'DRAFT' } }).then((value) => ({ key: 'total', label: 'Total Transactions', value })),
        ]),
      });
    }

    if (hasPermission(user, 'FINANCE_REVIEW')) {
      for (const role of user.roles.filter((r) => r.permissions.includes('FINANCE_REVIEW'))) {
        const byRole = { approverRole: role.code };
        sections.push({
          key: `finance-${role.code.toLowerCase()}`,
          title: role.name,
          widgets: await Promise.all([
            statusWidget('pending', 'Pending Review', 'FINANCE_REVIEW', { assignedRoleId: role.id }),
            decisions('FINANCE', 'APPROVED', byRole).then((value) => ({ key: 'approved', label: 'Approved', value, tone: 'success' as const })),
            decisions('FINANCE', 'REJECTED', byRole).then((value) => ({ key: 'rejected', label: 'Rejected', value, tone: 'error' as const })),
            decisions('FINANCE', 'RETURNED', byRole).then((value) => ({
              key: 'correction', label: 'Returned for Correction', value, tone: 'warning' as const,
            })),
          ]),
        });
      }
    }

    if (hasPermission(user, 'SALES_VIEW_ALL')) {
      const widgets: Promise<DashboardWidget>[] = [
        count({ status: { not: 'DRAFT' } }).then((value) => ({ key: 'total', label: 'Total Transactions', value })),
        statusWidget('pending-sa', 'Pending Sales Admin', 'SALES_ADMIN_REVIEW'),
        statusWidget('pending-finance', 'Pending Finance', 'FINANCE_REVIEW'),
        statusWidget('ready', 'Ready for Processing', 'READY_FOR_PROCESSING'),
        statusWidget('rejected', 'Rejected', 'REJECTED'),
        statusWidget('correction', 'Correction Required', 'CORRECTION_REQUIRED'),
      ];
      if (hasPermission(user, 'USER_VIEW')) {
        widgets.push(prisma.user.count({ where: { status: 'ACTIVE' } }).then((value) => ({ key: 'users', label: 'Active Users', value })));
      }
      sections.unshift({ key: 'overview', title: 'Overview', widgets: await Promise.all(widgets) });
    }

    // Per-wing totals for everyone whose view spans several wings.
    const reviewer = hasPermission(user, 'SALES_ADMIN_REVIEW', 'FINANCE_REVIEW');
    if (hasPermission(user, 'SALES_VIEW_ALL') || (reviewer && (user.allWings || user.wings.length > 1))) {
      const [wings, grouped] = await Promise.all([
        prisma.wing.findMany({
          where: hasPermission(user, 'SALES_VIEW_ALL') || user.allWings ? {} : { id: { in: user.wings.map((w) => w.id) } },
          orderBy: { code: 'asc' },
        }),
        prisma.salesTransaction.groupBy({ by: ['wingId'], where: { AND: [base, { status: { not: 'DRAFT' } }] }, _count: { _all: true } }),
      ]);
      const counts = new Map(grouped.map((g) => [g.wingId, g._count._all]));
      sections.push({
        key: 'wings',
        title: 'Transactions by Wing',
        widgets: wings
          .filter((w) => w.status === 'ACTIVE' || counts.has(w.id))
          .map((w) => ({ key: `wing-${w.code.toLowerCase()}`, label: w.name, value: counts.get(w.id) ?? 0, wingId: w.id })),
      });
    }

    const activity = await prisma.salesTransactionHistory.findMany({
      where: { transaction: base },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        actor: { select: { id: true, fullName: true, email: true } },
        transaction: { select: { transactionNumber: true } },
      },
    });
    const recentActivity: ActivityItem[] = activity.map((h) => ({
      id: h.id,
      transactionId: h.transactionId,
      transactionNumber: h.transaction.transactionNumber,
      action: h.action as HistoryAction,
      actor: h.actor,
      actorRole: h.actorRole,
      comment: h.comment,
      createdAt: h.createdAt.toISOString(),
    }));

    return { sections, recentActivity };
  },
};
