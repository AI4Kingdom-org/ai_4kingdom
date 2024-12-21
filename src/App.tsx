import React, { useEffect, useState } from 'react';

interface UserData {
  ID: string;
  user_email: string;
  display_name: string;
}

function App() {
  const [userData, setUserData] = useState<UserData | null>(null);

  useEffect(() => {
    // 监听来自WordPress的消息
    const handleMessage = (event: MessageEvent) => {
      // 确保消息来源是WordPress站点
      if (event.origin === 'https://ai4kingdom.com') {
        if (event.data.type === 'USER_DATA') {
          setUserData(event.data.data);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // 如果有用户数据，直接显示主界面
  if (userData) {
    return (
      <div>
        <h1>欢迎, {userData.display_name}!</h1>
        {/* 这里放置您的主应用内容 */}
      </div>
    );
  }

  // 如果没有用户数据，显示加载中
  return <div>加载中...</div>;
}

export default App; 