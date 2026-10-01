/**
 * Permission catalogue. Codes are referenced by code, so they are defined here (not editable in the UI)
 * and synchronised into the `permissions` table by the seed. Roles → permissions mapping is data.
 */
export const PERMISSION_CATALOGUE = {
  USER_VIEW: { module: 'Users', description: 'View users' },
  USER_CREATE: { module: 'Users', description: 'Create users' },
  USER_UPDATE: { module: 'Users', description: 'Update users, roles and reset passwords' },
  USER_DISABLE: { module: 'Users', description: 'Disable / enable users' },

  ROLE_VIEW: { module: 'Roles', description: 'View roles and permissions' },
  ROLE_CREATE: { module: 'Roles', description: 'Create roles' },
  ROLE_UPDATE: { module: 'Roles', description: 'Update roles and their permissions' },

  SALES_CREATE: { module: 'Sales', description: 'Create sales transactions' },
  SALES_VIEW_OWN: { module: 'Sales', description: 'View own sales transactions' },
  SALES_VIEW_ALL: { module: 'Sales', description: 'View all sales transactions' },
  SALES_EDIT: { module: 'Sales', description: 'Edit own draft / returned transactions' },
  SALES_SUBMIT: { module: 'Sales', description: 'Submit and resubmit own transactions' },

  SALES_ADMIN_REVIEW: { module: 'Sales Admin', description: 'Access the Sales Admin review queue' },
  SALES_ADMIN_EDIT: { module: 'Sales Admin', description: 'Edit permitted fields during Sales Admin review' },
  SALES_ADMIN_APPROVE: { module: 'Sales Admin', description: 'Approve at Sales Admin stage' },
  SALES_ADMIN_REJECT: { module: 'Sales Admin', description: 'Reject / return at Sales Admin stage' },

  FINANCE_REVIEW: { module: 'Finance', description: 'Access the finance review queue for own role' },
  FINANCE_EDIT: { module: 'Finance', description: 'Edit permitted fields during finance review' },
  FINANCE_APPROVE: { module: 'Finance', description: 'Give final (finance) approval' },
  FINANCE_REJECT: { module: 'Finance', description: 'Reject / return at finance stage' },

  TRANSACTION_ASSIGN: { module: 'Sales', description: 'Reassign a transaction to another reviewer' },
  TRANSACTION_CANCEL_ANY: { module: 'Sales', description: 'Cancel any non-final transaction' },

  EXCEPTION_VIEW: { module: 'Exceptions', description: 'View duplicate / exception details' },
  EXCEPTION_RESOLVE: { module: 'Exceptions', description: 'Resolve duplicate / exception flags' },

  MASTER_DATA_MANAGE: { module: 'Master Data', description: 'Create and update banks, accounts, parties, sales types' },

  REPORT_VIEW: { module: 'Reports', description: 'View reports' },
  REPORT_EXPORT: { module: 'Reports', description: 'Export reports to CSV / Excel' },

  AUDIT_VIEW: { module: 'Audit', description: 'View audit logs and user activity' },

  SYSTEM_SETTINGS_VIEW: { module: 'System', description: 'View settings, workflow and business rules' },
  SYSTEM_SETTINGS_UPDATE: { module: 'System', description: 'Change settings, workflow and business rules' },
} as const satisfies Record<string, { module: string; description: string }>;

export type Permission = keyof typeof PERMISSION_CATALOGUE;

export const PERMISSIONS = Object.fromEntries(
  Object.keys(PERMISSION_CATALOGUE).map((k) => [k, k]),
) as { readonly [K in Permission]: K };

export const ALL_PERMISSIONS = Object.keys(PERMISSION_CATALOGUE) as Permission[];

export const SYSTEM_ROLES = ['ADMIN', 'FIELD_FORCE', 'SALES_ADMIN', 'ACCOUNTANT', 'TREASURY', 'AUDITOR'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** Permissions that take part in creating or approving transactions (segregation of duties). */
const OPERATIONAL_PERMISSIONS: readonly Permission[] = [
  'SALES_CREATE',
  'SALES_EDIT',
  'SALES_SUBMIT',
  'SALES_VIEW_OWN',
  'SALES_ADMIN_REVIEW',
  'SALES_ADMIN_EDIT',
  'SALES_ADMIN_APPROVE',
  'SALES_ADMIN_REJECT',
  'FINANCE_REVIEW',
  'FINANCE_EDIT',
  'FINANCE_APPROVE',
  'FINANCE_REJECT',
];

/** Default role → permission mapping used by the seed. Editable afterwards through the Roles screen. */
export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  // Administrators administer and oversee; they do not create or approve transactions
  // (assign an operational role explicitly if a person must do both).
  ADMIN: ALL_PERMISSIONS.filter((p) => !OPERATIONAL_PERMISSIONS.includes(p)),
  FIELD_FORCE: ['SALES_CREATE', 'SALES_VIEW_OWN', 'SALES_EDIT', 'SALES_SUBMIT'],
  SALES_ADMIN: [
    'SALES_ADMIN_REVIEW',
    'SALES_ADMIN_EDIT',
    'SALES_ADMIN_APPROVE',
    'SALES_ADMIN_REJECT',
    'EXCEPTION_VIEW',
    'EXCEPTION_RESOLVE',
    'REPORT_VIEW',
    'REPORT_EXPORT',
  ],
  ACCOUNTANT: ['FINANCE_REVIEW', 'FINANCE_EDIT', 'FINANCE_APPROVE', 'FINANCE_REJECT', 'EXCEPTION_VIEW', 'REPORT_VIEW', 'REPORT_EXPORT'],
  TREASURY: ['FINANCE_REVIEW', 'FINANCE_EDIT', 'FINANCE_APPROVE', 'FINANCE_REJECT', 'EXCEPTION_VIEW', 'REPORT_VIEW', 'REPORT_EXPORT'],
  AUDITOR: [
    'SALES_VIEW_ALL',
    'EXCEPTION_VIEW',
    'REPORT_VIEW',
    'REPORT_EXPORT',
    'AUDIT_VIEW',
    'USER_VIEW',
    'ROLE_VIEW',
    'SYSTEM_SETTINGS_VIEW',
  ],
};
