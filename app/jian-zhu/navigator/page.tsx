'use client';

import { useAuth } from '../../contexts/AuthContext';
import ChatkitEmbed from '../../components/ChatkitEmbed';
import Script from 'next/script';

export default function JianZhuChatkitPage() {
  const { user, loading } = useAuth();

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: 16 }}>Loading...</div>;
  if (!user) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: 16 }}>請先登入</div>;

  return (
    <>
      <Script src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js" strategy="afterInteractive" />
      <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <ChatkitEmbed userId={user.user_id} module="jian-zhu-navigator" className="jian-zhu-chatkit" />
      </div>
    </>
  );
}
