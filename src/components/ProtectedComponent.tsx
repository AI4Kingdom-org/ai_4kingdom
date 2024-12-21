import React from 'react';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedComponentProps {
  children: React.ReactNode;
  requireUltimate?: boolean;
}

export function ProtectedComponent({ children, requireUltimate = false }: ProtectedComponentProps) {
  const { isAuthenticated, membershipStatus, loading } = useAuth();

  if (loading) {
    return <div>加载中...</div>;
  }

  if (!isAuthenticated) {
    return <div>请登录后查看此内容</div>;
  }

  if (requireUltimate && !membershipStatus?.membership_status?.ultimate?.is_active) {
    return <div>此内容仅对Ultimate会员开放</div>;
  }

  return <>{children}</>;
} 