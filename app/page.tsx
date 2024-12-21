"use client";

import { useState, useEffect } from "react";
import "./app.css";
import Chat from "./chat/Chat";

interface UserData {
  ID: string;
  user_email: string;
  display_name: string;
}

export default function Page() {
  const [userData, setUserData] = useState<UserData | null>(null);

  useEffect(() => {
    // 监听来自WordPress的消息
    const handleMessage = (event: MessageEvent) => {
      if (event.origin === 'https://ai4kingdom.com') {
        if (event.data.type === 'USER_DATA') {
          setUserData(event.data.data);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <main>
      <div className="chat-container">
        <h1>国度AI</h1>
        {userData ? (
          <Chat userId={userData.ID} />
        ) : (
          <div>加载中...</div>
        )}
      </div>
    </main>
  );
}