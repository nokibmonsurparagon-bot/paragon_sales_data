import type { ReactElement } from 'react';
import DashboardIcon from '@mui/icons-material/SpaceDashboard';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import NotificationsIcon from '@mui/icons-material/Notifications';
import AssessmentIcon from '@mui/icons-material/Assessment';
import StorageIcon from '@mui/icons-material/Storage';
import PeopleIcon from '@mui/icons-material/People';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import SettingsIcon from '@mui/icons-material/Settings';
import HistoryEduIcon from '@mui/icons-material/HistoryEdu';
import type { Permission } from '@paragon/shared';

export const VIEW_TRANSACTIONS: Permission[] = ['SALES_VIEW_OWN', 'SALES_VIEW_ALL', 'SALES_ADMIN_REVIEW', 'FINANCE_REVIEW'];
export const REVIEW: Permission[] = ['SALES_ADMIN_REVIEW', 'FINANCE_REVIEW'];

export interface NavItem {
  label: string;
  path: string;
  icon: ReactElement;
  any?: Permission[];
  group: 'main' | 'admin';
}

/** Single source for the sidebar and the route guards. */
export const NAV: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: <DashboardIcon />, group: 'main' },
  { label: 'Transactions', path: '/transactions', icon: <ReceiptLongIcon />, any: VIEW_TRANSACTIONS, group: 'main' },
  { label: 'Approvals', path: '/approvals', icon: <FactCheckIcon />, any: REVIEW, group: 'main' },
  { label: 'Notifications', path: '/notifications', icon: <NotificationsIcon />, group: 'main' },
  { label: 'Reports', path: '/reports', icon: <AssessmentIcon />, any: ['REPORT_VIEW'], group: 'main' },
  { label: 'Master Data', path: '/master-data', icon: <StorageIcon />, any: ['MASTER_DATA_MANAGE'], group: 'admin' },
  { label: 'Users', path: '/users', icon: <PeopleIcon />, any: ['USER_VIEW'], group: 'admin' },
  { label: 'Roles', path: '/roles', icon: <AdminPanelSettingsIcon />, any: ['ROLE_VIEW'], group: 'admin' },
  { label: 'Workflow Rules', path: '/workflow-rules', icon: <AccountTreeIcon />, any: ['SYSTEM_SETTINGS_VIEW'], group: 'admin' },
  { label: 'Settings', path: '/settings', icon: <SettingsIcon />, any: ['SYSTEM_SETTINGS_VIEW'], group: 'admin' },
  { label: 'Audit Logs', path: '/audit-logs', icon: <HistoryEduIcon />, any: ['AUDIT_VIEW'], group: 'admin' },
];

export const permissionsFor = (path: string): Permission[] | undefined => NAV.find((n) => n.path === path)?.any;
