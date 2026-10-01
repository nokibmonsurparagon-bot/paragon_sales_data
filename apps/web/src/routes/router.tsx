import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import type { Permission } from '@paragon/shared';
import { AppLayout } from '../layouts/AppLayout';
import { NotFoundPage } from '../pages/NotFoundPage';
import { RequireAuth, RequirePermission } from './guards';
import { permissionsFor, REVIEW, VIEW_TRANSACTIONS } from './nav';

/** Lazy page with a permission guard (code-split per page). */
function page(load: () => Promise<{ default: ComponentType }>, any?: Permission[]): Pick<RouteObject, 'lazy'> {
  return {
    lazy: async () => {
      const { default: Page } = await load();
      return {
        Component: () => (
          <RequirePermission any={any}>
            <Page />
          </RequirePermission>
        ),
      };
    },
  };
}

const transactionDetail = () => import('../features/transactions/TransactionDetailPage');
const transactionForm = () => import('../features/transactions/TransactionFormPage');

export const router = createBrowserRouter([
  { path: '/login', ...page(() => import('../features/auth/LoginPage')) },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    handle: { crumb: 'Home' },
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', handle: { crumb: 'Dashboard' }, ...page(() => import('../features/dashboard/DashboardPage')) },
      {
        path: 'transactions',
        handle: { crumb: 'Transactions' },
        children: [
          { index: true, ...page(() => import('../features/transactions/TransactionsListPage'), VIEW_TRANSACTIONS) },
          { path: 'new', handle: { crumb: 'New' }, ...page(transactionForm, ['SALES_CREATE']) },
          { path: ':id', handle: { crumb: 'Details' }, ...page(transactionDetail, VIEW_TRANSACTIONS) },
          { path: ':id/edit', handle: { crumb: 'Edit' }, ...page(transactionForm, ['SALES_EDIT', 'SALES_ADMIN_EDIT', 'FINANCE_EDIT']) },
        ],
      },
      {
        path: 'approvals',
        handle: { crumb: 'Approvals' },
        children: [
          { index: true, ...page(() => import('../features/approvals/ApprovalsQueuePage'), REVIEW) },
          { path: ':id', handle: { crumb: 'Review' }, ...page(transactionDetail, REVIEW) },
        ],
      },
      { path: 'notifications', handle: { crumb: 'Notifications' }, ...page(() => import('../features/notifications/NotificationsPage')) },
      { path: 'reports', handle: { crumb: 'Reports' }, ...page(() => import('../features/reports/ReportsPage'), permissionsFor('/reports')) },
      { path: 'master-data', handle: { crumb: 'Master Data' }, ...page(() => import('../features/master-data/MasterDataPage'), permissionsFor('/master-data')) },
      { path: 'users', handle: { crumb: 'Users' }, ...page(() => import('../features/users/UsersPage'), permissionsFor('/users')) },
      { path: 'roles', handle: { crumb: 'Roles' }, ...page(() => import('../features/roles/RolesPage'), permissionsFor('/roles')) },
      { path: 'workflow-rules', handle: { crumb: 'Workflow Rules' }, ...page(() => import('../features/workflow/WorkflowRulesPage'), permissionsFor('/workflow-rules')) },
      { path: 'settings', handle: { crumb: 'Settings' }, ...page(() => import('../features/settings/SettingsPage'), permissionsFor('/settings')) },
      { path: 'audit-logs', handle: { crumb: 'Audit Logs' }, ...page(() => import('../features/audit/AuditLogsPage'), permissionsFor('/audit-logs')) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
