import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface MembershipStatus {
  id: string;
  is_active: boolean;
  status: string;
  start_date: string;
  expiration_date: string;
}

interface MembershipResponse {
  user_id: string;
  membership_status: {
    ultimate?: MembershipStatus;
    // 可以添加其他会员类型
  };
  has_active_membership: boolean;
  timestamp: string;
}

export const useMembership = () => {
  const [membershipData, setMembershipData] = useState<MembershipResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkMembership = async () => {
    try {
      const response = await axios.get<MembershipResponse>('https://ai4kingdom.com/wp-json/custom/v1/check-membership');
      setMembershipData(response.data);
    } catch (err) {
      setError('获取会员状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkMembership();
  }, []);

  const isUltimateMember = membershipData?.membership_status?.ultimate?.is_active || false;
  
  return {
    isUltimateMember,
    membershipData,
    loading,
    error,
    checkMembership
  };
}; 