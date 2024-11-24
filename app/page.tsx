"use client";

import { useState, useEffect } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import "./../app/app.css";
import "@aws-amplify/ui-react/styles.css";
import Chat from "./chat/Chat";

export default function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const { user } = useAuthenticator();

  useEffect(() => {
    if (user) {
      setUserId(user.username);
    }
  }, [user]);

  return (
    <main>
      <div className="chat-container">
        <h1>国度AI</h1>
        {userId ? <Chat userId={userId} /> : <p>请先登录</p>}
      </div>
    </main>
  );
}