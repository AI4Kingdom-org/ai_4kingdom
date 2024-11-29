"use client";

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./app.css";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { Amplify } from 'aws-amplify';

// 确保环境变量存在
const identityPoolId = process.env.NEXT_PUBLIC_IDENTITY_POOL_ID;
const userPoolId = process.env.NEXT_PUBLIC_USER_POOL_ID;
const userPoolClientId = process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID;

if (!identityPoolId || !userPoolId || !userPoolClientId) {
  throw new Error('必要的 Amplify 配置环境变量缺失');
}

Amplify.configure({
  Auth: {
    Cognito: {
      identityPoolId,
      userPoolId,
      userPoolClientId
    }
  }
});

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Authenticator initialState="signIn">
          {({ signOut, user }) => (
            <main>
              {children}
              {user && (
                <button onClick={signOut} className="signout-button">登出</button>
              )}
            </main>
          )}
        </Authenticator>
      </body>
    </html>
  );
}
