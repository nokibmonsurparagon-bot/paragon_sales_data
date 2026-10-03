import type {
  AttachmentDto,
  AuditLogDto,
  AuthUser,
  BulkActionResult,
  BusinessRuleDto,
  ClientConfig,
  DashboardSummary,
  DuplicateCandidate,
  HistoryEntry,
  LoginResult,
  MasterDataEntity,
  MasterDataItem,
  MasterImportResult,
  NotificationDto,
  Paginated,
  PermissionDto,
  ReportPage,
  ReportType,
  RoleDto,
  SystemSettingDto,
  TransactionDetail,
  TransactionListItem,
  UserDto,
  UserRef,
  WorkflowResult,
  WorkflowRuleDto,
} from '@paragon/shared';
import { del, download, get, http, patch, post } from './client';

export type Query = Record<string, string | number | boolean | undefined | null>;
export type ReviewVerb = 'submit' | 'resubmit' | 'cancel' | 'approve' | 'reject' | 'return';

export const api = {
  auth: {
    login: (email: string, password: string) => post<LoginResult>('/auth/login', { email, password }),
    logout: () => post<null>('/auth/logout'),
    me: () => get<AuthUser>('/auth/me'),
    changePassword: (currentPassword: string, newPassword: string) =>
      post<LoginResult>('/auth/change-password', { currentPassword, newPassword }),
  },
  config: () => get<ClientConfig>('/config/client'),

  transactions: {
    list: (q: Query) => get<Paginated<TransactionListItem>>('/transactions', q),
    get: (id: string) => get<TransactionDetail>(`/transactions/${id}`),
    create: (body: object) => post<TransactionDetail>('/transactions', body),
    update: (id: string, body: object) => patch<TransactionDetail>(`/transactions/${id}`, body),
    history: (id: string) => get<HistoryEntry[]>(`/transactions/${id}/history`),
    workflow: (id: string, verb: ReviewVerb, body: object) => post<WorkflowResult>(`/transactions/${id}/${verb}`, body),
    bulk: (verb: 'approve' | 'reject', body: object) => post<BulkActionResult>(`/transactions/bulk-${verb}`, body),
    assign: (id: string, verb: 'claim' | 'release' | 'reassign', body: object) =>
      post<TransactionDetail>(`/transactions/${id}/${verb}`, body),
    duplicates: (id: string) => get<DuplicateCandidate[]>(`/transactions/${id}/duplicates`),
    resolveDuplicate: (id: string, body: object) => post<TransactionDetail>(`/transactions/${id}/duplicates/resolve`, body),
    upload: async (id: string, file: File, onProgress?: (pct: number) => void) => {
      const form = new FormData();
      form.append('file', file);
      const r = await http.post<{ data: AttachmentDto; message?: string }>(`/transactions/${id}/attachments`, form, {
        onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
      });
      return r.data.data;
    },
    downloadAttachment: (attachmentId: string, name: string) => download(`/attachments/${attachmentId}/download`, undefined, name),
    removeAttachment: (attachmentId: string) => del<null>(`/attachments/${attachmentId}`),
  },

  master: {
    list: (entity: MasterDataEntity, q: Query) => get<Paginated<MasterDataItem>>(`/${entity}`, q),
    get: (entity: MasterDataEntity, id: string) => get<MasterDataItem>(`/${entity}/${id}`),
    create: (entity: MasterDataEntity, body: object) => post<MasterDataItem>(`/${entity}`, body),
    update: (entity: MasterDataEntity, id: string, body: object) => patch<MasterDataItem>(`/${entity}/${id}`, body),
    template: (entity: MasterDataEntity, withData: boolean) =>
      download(`/${entity}/import-template`, { withData }, `${entity}-${withData ? 'export' : 'template'}.xlsx`),
    importFile: async (entity: MasterDataEntity, file: File, dryRun: boolean) => {
      const form = new FormData();
      form.append('file', file);
      const r = await http.post<{ data: MasterImportResult; message?: string }>(`/${entity}/import`, form, { params: { dryRun } });
      return r.data.data;
    },
  },

  users: {
    list: (q: Query) => get<Paginated<UserDto>>('/users', q),
    lookup: (q: Query) => get<Paginated<UserRef>>('/users/lookup', q),
    create: (body: object) => post<UserDto>('/users', body),
    update: (id: string, body: object) => patch<UserDto>(`/users/${id}`, body),
    resetPassword: (id: string, newPassword: string) => post<null>(`/users/${id}/reset-password`, { newPassword }),
  },
  roles: {
    list: () => get<RoleDto[]>('/roles'),
    create: (body: object) => post<RoleDto>('/roles', body),
    update: (id: string, body: object) => patch<RoleDto>(`/roles/${id}`, body),
    permissions: () => get<PermissionDto[]>('/permissions'),
  },
  workflowRules: {
    list: () => get<WorkflowRuleDto[]>('/workflow/rules'),
    create: (body: object) => post<WorkflowRuleDto>('/workflow/rules', body),
    update: (id: string, body: object) => patch<WorkflowRuleDto>(`/workflow/rules/${id}`, body),
    simulate: (body: object) => post<{ rule: WorkflowRuleDto }>('/workflow/rules/simulate', body),
  },
  businessRules: {
    list: () => get<BusinessRuleDto[]>('/business-rules'),
    create: (body: object) => post<BusinessRuleDto>('/business-rules', body),
    update: (id: string, body: object) => patch<BusinessRuleDto>(`/business-rules/${id}`, body),
  },
  settings: {
    list: () => get<SystemSettingDto[]>('/system-settings'),
    update: (key: string, value: unknown) => patch<SystemSettingDto>(`/system-settings/${key}`, { value }),
  },
  notifications: {
    list: (q: Query) => get<Paginated<NotificationDto>>('/notifications', q),
    unreadCount: () => get<{ count: number }>('/notifications/unread-count'),
    read: (id: string) => post<NotificationDto>(`/notifications/${id}/read`),
    readAll: () => post<{ updated: number }>('/notifications/read-all'),
  },
  dashboard: (q: Query) => get<DashboardSummary>('/dashboard/summary', q),
  audit: (q: Query) => get<Paginated<AuditLogDto>>('/audit-logs', q),
  reports: {
    page: (type: ReportType, q: Query) => get<ReportPage>(`/reports/${type}`, q),
    export: (type: ReportType, q: Query, format: 'csv' | 'xlsx') =>
      download(`/reports/${type}/export`, { ...q, format, page: undefined, limit: undefined }, `${type}.${format}`),
  },
};
