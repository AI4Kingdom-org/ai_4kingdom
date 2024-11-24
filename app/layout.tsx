"use client";

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./app.css";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { Amplify } from 'aws-amplify';
import awsconfig from "@/aws-exports";

Amplify.configure({
  ...awsconfig,
  Auth: {
    Cognito: {
      userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID!,
      userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID!,
      identityPoolId: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!,
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
