import React, { createContext, useContext, useState, useEffect } from 'react';

interface MembershipStatus {
  user_id: string;
  membership_status: {
    ultimate?: {
      is_active: boolean;
      status: string;
      expiration_date: string;
    };
  };
  has_active_membership: boolean;
}

interface AuthContextType {
  isAuthenticated: boolean;
  membershipStatus: MembershipStatus | null;
  loading: boolean;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const response = await fetch('https://ai4kingdom.com/wp-json/custom/v1/check-membership', {
        credentials: 'include' // 重要：包含cookies
      });
      const data = await response.json();
      
      setMembershipStatus(data);
      setIsAuthenticated(data.has_active_membership);
    } catch (error) {
      console.error('认证检查失败:', error);
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, membershipStatus, loading, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 