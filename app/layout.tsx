"use client";

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./app.css";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { Amplify } from 'aws-amplify';

Amplify.configure({
  Auth: {
    Cognito: {
      identityPoolId: 'us-east-2:e39629e5-24d5-45b7-8fff-1c2b219a9a7b',
      userPoolId: 'us-east-2_covgiAC78',
      userPoolClientId: '2uhbcgreed9lkahgrlh9b9bn7k'
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
