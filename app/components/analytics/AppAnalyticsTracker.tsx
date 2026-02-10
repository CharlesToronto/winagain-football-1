"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

const SESSION_KEY = "winagain:analytics:session_id";

function safeNowIso() {
  return new Date().toISOString();
}

function getOrCreateSessionId() {
  if (typeof window === "undefined") return null;
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return null;
  }
}

function isMissingTable(error: any) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("does not exist") && message.includes("relation");
}

export default function AppAnalyticsTracker() {
  const pathname = usePathname();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const lastLoggedPath = useRef<string | null>(null);
  const missingTablesMuted = useRef(false);

  const timezone = useMemo(() => {
    if (typeof Intl === "undefined") return null;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  useEffect(() => {
    let active = true;
    supabaseBrowser.auth
      .getUser()
      .then(({ data }) => {
        if (!active) return;
        setUserId(data.user?.id ?? null);
      })
      .catch(() => {
        if (!active) return;
        setUserId(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const upsertSession = async (override?: { lastSeenAt?: string }) => {
    if (!sessionId) return;
    const nowIso = override?.lastSeenAt ?? safeNowIso();
    const payload: any = {
      session_id: sessionId,
      last_seen_at: nowIso,
      updated_at: nowIso,
      timezone,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      user_id: userId,
    };

    const { error } = await supabaseBrowser
      .from("app_analytics_sessions")
      .upsert(payload, { onConflict: "session_id" });
    if (error && isMissingTable(error) && !missingTablesMuted.current) {
      missingTablesMuted.current = true;
      console.warn("[analytics] Missing table app_analytics_sessions.");
    }
  };

  const insertPageView = async (path: string) => {
    if (!sessionId) return;
    const payload: any = {
      session_id: sessionId,
      user_id: userId,
      path,
      title: typeof document !== "undefined" ? document.title : null,
      referrer: typeof document !== "undefined" ? document.referrer || null : null,
    };
    const { error } = await supabaseBrowser.from("app_analytics_page_views").insert(payload);
    if (error && isMissingTable(error) && !missingTablesMuted.current) {
      missingTablesMuted.current = true;
      console.warn("[analytics] Missing table app_analytics_page_views.");
    }
  };

  useEffect(() => {
    if (!sessionId) return;
    void upsertSession();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void upsertSession();
      } else {
        void upsertSession();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, userId, timezone]);

  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void upsertSession();
    }, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, userId, timezone]);

  useEffect(() => {
    if (!sessionId) return;
    const path = pathname || "/";
    if (lastLoggedPath.current === path) return;
    lastLoggedPath.current = path;
    void insertPageView(path);
    void upsertSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, sessionId]);

  return null;
}
