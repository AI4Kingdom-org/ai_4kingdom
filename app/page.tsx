"use client";

import { useState, useEffect } from "react";
import "./app.css";
import Chat from "./chat/Chat";
import { AuthProvider } from "./contexts/AuthContext";

export default function Page() {
  return (
    <AuthProvider>
      <main>
        <div className="chat-container">
          <h1>国度AI</h1>
          <Chat />
        </div>
      </main>
    </AuthProvider>
  );
}