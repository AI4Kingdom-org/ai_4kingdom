"use client";

import { useState, useEffect } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import "./../app/app.css";
import { Amplify } from "aws-amplify";
import awsconfig from "@/aws-exports";
import outputs from "@/amplify_outputs.json";
import "@aws-amplify/ui-react/styles.css";
import Chat from "./chat/Chat";

Amplify.configure({
  ...awsconfig,
  Auth: {
    Cognito: {
      userPoolId: 'us-east-2_VnxerjL1q',
      userPoolClientId: '31bsofh52pmgt5h1t2jdorcv88',
      identityPoolId: 'us-east-2:cd501363-bb36-4790-901e-13e9fd66ae6c',
      signUpVerificationMethod: "code"
    }
  }
});

const client = generateClient<Schema>();

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
        {userId ? <Chat userId={userId} /> : <p>加载中...</p>}
      </div>
    </main>
  );
}