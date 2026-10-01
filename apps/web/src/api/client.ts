import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { ApiErrorDetail, ApiFailure, ApiSuccess, LoginResult } from '@paragon/shared';

/** Normalised API error used everywhere in the UI. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetail[] = [],
    readonly requestId?: string,
  ) {
    super(message);
  }
}

// Access token lives in memory only (never localStorage). The refresh token is an HttpOnly cookie.
let accessToken: string | null = null;
export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => {
    accessToken = t;
  },
};

type Listener = () => void;
const expiredListeners = new Set<Listener>();
export function onSessionExpired(fn: Listener): () => void {
  expiredListeners.add(fn);
  return () => expiredListeners.delete(fn);
}

export const http = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

http.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

let refreshing: Promise<LoginResult | null> | null = null;

/** Single-flight refresh: concurrent 401s share one refresh call. */
export function refreshSession(): Promise<LoginResult | null> {
  refreshing ??= axios
    .post<ApiSuccess<LoginResult>>('/api/auth/refresh', null, {
      withCredentials: true,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    .then((r) => {
      tokenStore.set(r.data.data.accessToken);
      return r.data.data;
    })
    .catch(() => {
      tokenStore.set(null);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof AxiosError) {
    const body = err.response?.data as Partial<ApiFailure> | Blob | undefined;
    if (body && !(body instanceof Blob) && body.error) {
      return new ApiError(err.response!.status, body.error.code, body.error.message, body.error.details ?? [], body.requestId);
    }
    if (!err.response) return new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
    return new ApiError(err.response.status, 'HTTP_ERROR', err.message);
  }
  return new ApiError(0, 'UNKNOWN', err instanceof Error ? err.message : 'Unexpected error');
}

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const cfg = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const isAuthCall = cfg?.url?.startsWith('/auth/login') || cfg?.url?.startsWith('/auth/refresh');
    if (error.response?.status === 401 && cfg && !cfg._retried && !isAuthCall) {
      cfg._retried = true;
      const session = await refreshSession();
      if (session) return http(cfg);
      expiredListeners.forEach((fn) => fn());
    }
    throw toApiError(error);
  },
);

export async function get<T>(url: string, params?: object): Promise<T> {
  return (await http.get<ApiSuccess<T>>(url, { params: clean(params) })).data.data;
}
export async function post<T>(url: string, body?: unknown): Promise<{ data: T; message?: string }> {
  const r = await http.post<ApiSuccess<T>>(url, body ?? {});
  return { data: r.data.data, message: r.data.message };
}
export async function patch<T>(url: string, body: unknown): Promise<{ data: T; message?: string }> {
  const r = await http.patch<ApiSuccess<T>>(url, body);
  return { data: r.data.data, message: r.data.message };
}
export async function del<T>(url: string): Promise<{ data: T; message?: string }> {
  const r = await http.delete<ApiSuccess<T>>(url);
  return { data: r.data.data, message: r.data.message };
}

/** Removes empty values so they are not sent as `?x=`. */
export function clean(params?: object): Record<string, unknown> | undefined {
  if (!params) return undefined;
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

/** Authenticated file download (exports, attachments). */
export async function download(url: string, params?: object, fallbackName = 'download'): Promise<void> {
  const res = await http.get<Blob>(url, { params: clean(params), responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
  const name = star ? decodeURIComponent(star) : (plain ?? fallbackName);
  const href = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
