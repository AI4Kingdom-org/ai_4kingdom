"use client";

import { useState, useEffect } from "react";
import "./app.css";
import Chat from "./chat/Chat";
import { AuthProvider } from "./contexts/AuthContext";

async function validateSession() {
  try {
    console.log('Attempting session validation...');
    const response = await fetch('https://ai4kingdom.com/wp-json/custom/v1/validate_session', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'action=validate_session'
    });

    console.log('Response Status:', response.status);
    console.log('Response Headers:', Object.fromEntries(response.headers));
    
    const data = await response.json();
    console.log('Response Data:', data);
    
    // 检查cookie
    console.log('Current Cookies:', document.cookie);
    
    // 检查localStorage和sessionStorage
    console.log('localStorage:', localStorage);
    console.log('sessionStorage:', sessionStorage);
  } catch (error) {
    console.error('Session Validation Error:', error);
  }
}

export default function Page() {
  useEffect(() => {
    // 防止滚动行为影响父窗口
    window.scrollTo = () => {};
    document.body.style.overflow = 'hidden';
    
    // 在组件加载时验证会话
    validateSession();
    
    // 定期检查会话状态
    const sessionCheckInterval = setInterval(validateSession, 5 * 60 * 1000); // 每5分钟检查一次
    
    return () => {
      clearInterval(sessionCheckInterval);
    };
  }, []);

  return (
    <AuthProvider>
      <main style={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden'
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
            overflow: 'auto'
          }}>
            <Chat />
          </div>
        </div>
      </main>
    </AuthProvider>
  );
}