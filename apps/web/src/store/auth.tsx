import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthUser, LoginResult, Permission } from '@paragon/shared';
import { onSessionExpired, refreshSession, tokenStore } from '../api/client';
import { api } from '../api/endpoints';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: AuthUser | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  applySession(session: LoginResult): void;
  /** true if the user holds ANY of the permissions */
  can(...perms: Permission[]): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const queryClient = useQueryClient();

  const applySession = useCallback((session: LoginResult) => {
    tokenStore.set(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
  }, []);

  const reset = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  // Restore the session from the HttpOnly refresh cookie on first load.
  useEffect(() => {
    let active = true;
    void refreshSession().then((session) => {
      if (!active) return;
      if (session) applySession(session);
      else setStatus('anonymous');
    });
    return () => {
      active = false;
    };
  }, [applySession]);

  useEffect(() => onSessionExpired(reset), [reset]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      applySession,
      async login(email, password) {
        const { data } = await api.auth.login(email, password);
        applySession(data);
      },
      async logout() {
        try {
          await api.auth.logout();
        } finally {
          reset();
        }
      },
      can: (...perms) => !!user && perms.some((p) => user.permissions.includes(p)),
    }),
    [status, user, applySession, reset],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
