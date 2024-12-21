import React from 'react';
import { useMembership } from '../hooks/useMembership';

const FeatureComponent = () => {
  const { isUltimateMember, loading, error } = useMembership();

  if (loading) return <div>加载中...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div>
      {isUltimateMember ? (
        <div>高级功能区域</div>
      ) : (
        <div>
          <p>请升级到 Ultimate 会员以使用此功能</p>
          <button>立即升级</button>
        </div>
      )}
    </div>
  );
};

export default FeatureComponent; 