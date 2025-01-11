"use client";

import { useState, useEffect } from "react";
import "./app.css";
import Chat from "./chat/Chat";
import { AuthProvider } from "./contexts/AuthContext";

export default function Page() {
  useEffect(() => {
    // 防止滚动行为影响父窗口
    window.scrollTo = () => {};
    document.body.style.overflow = 'hidden';
  }, []);

  return (
    <AuthProvider>
      <main style={{ 
        position: 'fixed',  // 改为固定定位
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden'  // 防止主容器滚动
      }}>
        <div style={{ 
          width: '100%',
          height: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden'
        }}>
          <div className="chat-container" style={{
            height: '100%',
            maxHeight: '100vh',
            overflow: 'auto'  // 只允许聊天容器内部滚动
          }}>
            <Chat />
          </div>
        </div>
      </main>
    </AuthProvider>
  );
}