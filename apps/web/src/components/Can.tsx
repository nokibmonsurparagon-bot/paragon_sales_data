import type { ReactNode } from 'react';
import type { Permission } from '@paragon/shared';
import { useAuth } from '../store/auth';

/**
 * Renders children only if the user holds ANY of the permissions.
 * UX convenience only – every action is re-authorised by the API.
 */
export function Can({ any, children, fallback = null }: { any: Permission[]; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useAuth();
  return <>{can(...any) ? children : fallback}</>;
}
