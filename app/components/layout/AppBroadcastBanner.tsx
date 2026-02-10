"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Broadcast = {
  id: string;
  channel: string;
  title: string | null;
  message: string;
  starts_at: string;
  ends_at: string | null;
};

const DISMISSED_KEY = "winagain:broadcast:dismissed:banner";
const UPDATE_EVENT = "app-broadcast-updated";

function isMissingTable(error: any) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("does not exist") && message.includes("relation");
}

export default function AppBroadcastBanner() {
  const [active, setActive] = useState<Broadcast | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setDismissedId(localStorage.getItem(DISMISSED_KEY));
    } catch {
      setDismissedId(null);
    }
  }, []);

  const isDismissed = useMemo(() => {
    if (!active?.id) return false;
    return dismissedId === active.id;
  }, [active?.id, dismissedId]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabaseBrowser
        .from("app_broadcasts")
        .select("id,channel,title,message,starts_at,ends_at")
        .eq("channel", "banner")
        .lte("starts_at", nowIso)
        .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!alive) return;

      if (error) {
        if (!isMissingTable(error)) {
          console.warn("[broadcast] Banner load error:", error);
        }
        setActive(null);
        return;
      }
      if (!data?.message) {
        setActive(null);
        return;
      }
      setActive(data as Broadcast);
    };

    void load();

    const onUpdated = () => void load();
    window.addEventListener(UPDATE_EVENT, onUpdated);
    return () => {
      alive = false;
      window.removeEventListener(UPDATE_EVENT, onUpdated);
    };
  }, []);

  if (!active || !active.message || isDismissed) return null;

  return (
    <div className="mb-4">
      <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-xl px-4 py-3 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {active.title ? (
              <div className="text-xs font-semibold text-white">{active.title}</div>
            ) : null}
            <div className="mt-0.5 text-xs text-white/80 whitespace-pre-line">
              {active.message}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(DISMISSED_KEY, active.id);
              } catch {
                // ignore
              }
              setDismissedId(active.id);
            }}
            className="shrink-0 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/15"
            aria-label="Fermer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

