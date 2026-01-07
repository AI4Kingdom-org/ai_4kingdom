"use client";

import { useEffect, useMemo, useState } from "react";
import Script from "next/script";

import WithChat from "@/app/components/layouts/WithChat";
import ChatkitEmbed from "@/app/components/ChatkitEmbed";
import { useAuth } from "@/app/contexts/AuthContext";

const GUEST_ID_STORAGE_KEY = "routing_agent_guest_user_id";

function getOrCreateGuestUserId(): string {
  if (typeof window === "undefined") return "";

  const existing = window.localStorage.getItem(GUEST_ID_STORAGE_KEY);
  if (existing && existing.trim()) return existing;

  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const next = `guest_${uuid}`;
  window.localStorage.setItem(GUEST_ID_STORAGE_KEY, next);
  return next;
}

export default function RoutingAgentPage() {
  const { user, loading } = useAuth();
  const [guestUserId, setGuestUserId] = useState<string>("");

  useEffect(() => {
    // 不要求登入：未登入時使用本機產生的 guest userId
    if (!loading && !user) {
      setGuestUserId(getOrCreateGuestUserId());
    }
  }, [loading, user]);

  useEffect(() => {
    // ChatKit 的 UI 可能透過 portal 掛在 body 下方，使用 body class 來做「只限此頁」的 CSS scope。
    document.body.classList.add("routing-agent-page");
    return () => {
      document.body.classList.remove("routing-agent-page");
    };
  }, []);

  const userId = useMemo(() => {
    return user?.user_id || guestUserId;
  }, [user?.user_id, guestUserId]);

  // 伺服器端 session API 需要 userId；在客戶端準備好前先顯示 Loading
  if (!userId) {
    return <div style={{ padding: 16 }}>Loading…</div>;
  }

  return (
    <WithChat disableChatContext>
      <style jsx global>{`
        html, body {
          background: transparent !important;
        }

        /* routing_agent only:
           ChatKit UI is rendered inside a cross-origin iframe (cdn.platform.openai.com),
           so we cannot reliably select its internal DOM. We hide the history button by
           covering the top-right corner of the iframe container.
        */
        body.routing-agent-page .routing-agent-chatkit-history-cover {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 48px;
          height: 48px;
          border-radius: 10px;
          background: #fff;
          z-index: 50;
          pointer-events: auto;
        }
      `}</style>
      <div style={{ padding: 16, color: "#000" }}>
        <Script
          src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js"
          strategy="afterInteractive"
        />

        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ width: "90%", maxWidth: 900, margin: "0 auto" }}>
            <div
              style={{
                width: "100%",
                height: 600,
                borderRadius: 12,
                overflow: "hidden",
                boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
                backgroundColor: "transparent",
                position: "relative",
              }}
            >
              <div className="routing-agent-chatkit-history-cover" aria-hidden="true" />
              <div id="routing-agent-chatkit" style={{ width: '100%', height: '100%' }}>
                <ChatkitEmbed userId={userId} module="routing_agent" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </WithChat>
  );
}
