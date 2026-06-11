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
      <div style={{ padding: 16 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ width: '90%', maxWidth: 900, margin: '0 auto' }}>
            <div style={{
              width: '100%',
              height: '80vh',
              minHeight: 600,
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
              backgroundColor: '#fff',
            }}>
              <ChatkitEmbed userId={user.user_id} module="jian-zhu-navigator" className="jian-zhu-chatkit" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
