import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { Spinner } from '../../ui/components';

/** Editors and admins only. The server checks again on every call; this just keeps students out of the screens. */
export function StaffOnly({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  if (!profile) return <Spinner />;
  if (profile.role !== 'editor' && profile.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}
