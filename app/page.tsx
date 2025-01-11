"use client";

import { useState, useEffect } from "react";
import "./app.css";
import Chat from "./chat/Chat";
import { AuthProvider } from "./contexts/AuthContext";

export default function Page() {
  return (
    <AuthProvider>
      <main>
        <div style={{ 
          width: '100%',
          height: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden'
        }}>
          <div className="chat-container">
            <Chat />
          </div>
        </div>
      </main>
    </AuthProvider>
  );
}