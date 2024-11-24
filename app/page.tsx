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
      userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID!,
      userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID!,
      identityPoolId: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!,
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