"use client";

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./app.css";
import { AuthProvider } from './contexts/AuthContext';
import { CreditProvider } from './contexts/CreditContext';

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <CreditProvider>
            <main>{children}</main>
          </CreditProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
