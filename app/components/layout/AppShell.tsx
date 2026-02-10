"use client";

import Link from "next/link";
import { ReactNode, useEffect, useState } from "react";
import { FAVORITES_STORAGE_KEY, type FavoriteTeam } from "@/lib/favorites";
import SearchAlgoScanBanner from "@/app/components/search/SearchAlgoScanBanner";
import AppBroadcastBanner from "@/app/components/layout/AppBroadcastBanner";
import AppAnalyticsTracker from "@/app/components/analytics/AppAnalyticsTracker";
import { supabaseBrowser } from "@/lib/supabase/client";

type Props = {
  children: ReactNode;
};

const DEFAULT_TOPBAR_MESSAGE = "We have update Charly IA 2.4";
const BROADCAST_UPDATE_EVENT = "app-broadcast-updated";

function isMissingTable(error: any) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("does not exist") && message.includes("relation");
}

export default function AppShell({ children }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<
    Array<{ id: string; role: "user" | "assistant"; text: string }>
  >([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<FavoriteTeam[]>([]);
  const [topbarMessage, setTopbarMessage] = useState<string>(DEFAULT_TOPBAR_MESSAGE);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const loadFavorites = () => {
      try {
        const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
        if (!raw) {
          setFavorites([]);
          return;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setFavorites(
            parsed
              .filter((item) => item && typeof item.id === "number")
              .map((item) => ({
                id: item.id,
                name: item.name ?? "",
                logo: item.logo ?? null,
              }))
          );
        } else {
          setFavorites([]);
        }
      } catch {
        setFavorites([]);
      }
    };
    loadFavorites();
    const handleFavoritesUpdated = () => loadFavorites();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === FAVORITES_STORAGE_KEY) loadFavorites();
    };
    window.addEventListener("favorites-updated", handleFavoritesUpdated);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("favorites-updated", handleFavoritesUpdated);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const loadTopbar = async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabaseBrowser
        .from("app_broadcasts")
        .select("message,starts_at,ends_at")
        .eq("channel", "topbar")
        .lte("starts_at", nowIso)
        .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!alive) return;

      if (error) {
        if (!isMissingTable(error)) {
          console.warn("[broadcast] Topbar load error:", error);
        }
        setTopbarMessage(DEFAULT_TOPBAR_MESSAGE);
        return;
      }
      const message = String(data?.message ?? "").trim();
      setTopbarMessage(message || DEFAULT_TOPBAR_MESSAGE);
    };

    void loadTopbar();
    const onUpdated = () => void loadTopbar();
    window.addEventListener(BROADCAST_UPDATE_EVENT, onUpdated);
    return () => {
      alive = false;
      window.removeEventListener(BROADCAST_UPDATE_EVENT, onUpdated);
    };
  }, []);

  const buildPageContext = () => {
    if (typeof window === "undefined") return {};
    const headings = Array.from(
      document.querySelectorAll("h1, h2")
    )
      .map((el) => (el.textContent ?? "").trim())
      .filter(Boolean)
      .slice(0, 6);
    return {
      url: window.location.href,
      path: window.location.pathname,
      query: window.location.search,
      title: document.title,
      headings,
    };
  };

  const sendMessage = async () => {
    const value = input.trim();
    if (!value || sending) return;
    setSendError(null);
    const newMsg = {
      id: `${Date.now()}-${Math.random()}`,
      role: "user" as const,
      text: value,
    };
    setMessages((prev) => [...prev, newMsg]);
    setInput("");
    setSending(true);
    try {
      const res = await fetch("/api/charly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, newMsg].map((msg) => ({
            role: msg.role,
            content: msg.text,
          })),
          context: buildPageContext(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erreur Chat IA");
      const answer = String(data?.reply ?? "").trim();
      if (answer) {
        setMessages((prev) => [
          ...prev,
          { id: `${Date.now()}-${Math.random()}`, role: "assistant", text: answer },
        ]);
      }
    } catch (err: any) {
      setSendError(err?.message ?? "Erreur Chat IA");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <AppAnalyticsTracker />
      <div className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-black">
        <div className="h-14 max-w-[1400px] mx-auto px-3 sm:px-6 flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2 min-w-[180px]">
            {favorites.length ? (
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {favorites.map((fav) => (
                  <Link
                    key={fav.id}
                    href={`/team/${fav.id}?tab=stats`}
                    className="w-7 h-7 rounded-full bg-white/10 border border-white/10 flex items-center justify-center overflow-hidden"
                    title={fav.name || "Équipe"}
                    aria-label={fav.name || "Équipe"}
                  >
                    {fav.logo ? (
                      <img
                        src={fav.logo}
                        alt={fav.name || "Équipe"}
                        className="w-5 h-5 object-contain"
                      />
                    ) : (
                      <span className="text-[10px] font-semibold text-white">
                        {(fav.name || "??").slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-xs text-white/50">Aucun favori</div>
            )}
          </div>
          <div className="flex-1 min-w-0 md:hidden text-left text-[11px] sm:text-xs text-white/80 whitespace-nowrap leading-tight overflow-x-auto no-scrollbar">
            {topbarMessage}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden md:block text-left text-sm text-white/80 whitespace-nowrap">
              {topbarMessage}
            </div>
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 via-orange-500 to-amber-500 text-white font-semibold shadow-lg"
              aria-label="Ouvrir le chat IA"
            >
              IA
            </button>
          </div>
        </div>
        {favorites.length ? (
          <div className="md:hidden border-t border-white/10 bg-black/70 backdrop-blur-xl">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-3 py-2">
              {favorites.map((fav) => (
                <Link
                  key={`mobile-fav-${fav.id}`}
                  href={`/team/${fav.id}?tab=stats`}
                  className="w-8 h-8 rounded-full bg-white/10 border border-white/10 flex items-center justify-center overflow-hidden"
                  title={fav.name || "Équipe"}
                  aria-label={fav.name || "Équipe"}
                >
                  {fav.logo ? (
                    <img
                      src={fav.logo}
                      alt={fav.name || "Équipe"}
                      className="w-5 h-5 object-contain"
                    />
                  ) : (
                    <span className="text-[10px] font-semibold text-white">
                      {(fav.name || "??").slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="min-h-screen flex pt-14 md:pt-14">
        <main
          className={`team-page min-h-screen mobile-main ml-0 md:ml-64 p-4 sm:p-6 pb-24 md:pb-6 flex-1 transition-[padding] duration-300 ease-out ${
            open ? "md:pr-64 lg:pr-72" : "md:pr-0"
          }`}
        >
          <AppBroadcastBanner />
          <SearchAlgoScanBanner />
          {children}
        </main>

        <aside
          className={`hidden md:flex fixed top-14 right-0 h-[calc(100dvh-56px)] border-l border-white/10 bg-black/40 backdrop-blur-xl transition-[width] duration-300 ease-out overflow-hidden ${
            open ? "w-64 sm:w-72" : "w-0"
          }`}
        >
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="text-sm font-semibold">
              {sending ? (
                <span className="inline-flex items-center gap-1">
                  {["C", "h", "a", "r", "l", "y", " ", "r", "é", "f", "l", "é", "c", "h", "i", ".", ".", "."].map(
                    (letter, index) => (
                      <span
                        key={`${letter}-${index}`}
                        className="inline-block animate-[charly-bounce_1.2s_ease-in-out_infinite]"
                        style={{ animationDelay: `${index * 0.05}s` }}
                      >
                        {letter}
                      </span>
                    )
                  )}
                </span>
              ) : (
                "Charly IA chat"
              )}
            </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-white/60 hover:text-white"
                aria-label="Fermer le chat IA"
              >
                Fermer
              </button>
            </div>
            <div className="flex-1 p-4 text-sm text-white/80 space-y-2 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="text-white/50">Commence une conversation…</div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                      msg.role === "user"
                        ? "ml-auto bg-emerald-500/20 text-emerald-100 border border-emerald-500/30"
                        : "bg-white/10 text-white/80 border border-white/10"
                    }`}
                  >
                    {msg.text}
                  </div>
                ))
              )}
            </div>
            <form
              className="border-t border-white/10 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
            >
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Écris ton message…"
                  className="flex-1 rounded-md bg-white/10 border border-white/10 px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-orange-400/60"
                />
                <button
                  type="submit"
                  disabled={sending}
                  className="rounded-md bg-orange-500/80 hover:bg-orange-500 px-3 py-2 text-xs font-semibold text-white"
                >
                  {sending ? "..." : "Envoyer"}
                </button>
              </div>
              {sendError ? (
                <div className="mt-2 text-[11px] text-rose-200">{sendError}</div>
              ) : null}
            </form>
          </div>
        </aside>
      </div>

      {open ? (
        <div className="md:hidden fixed top-14 left-0 right-0 z-50 border-b border-white/10 bg-black/50 backdrop-blur-xl">
          <div className="h-[calc(100vh-56px)] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="text-sm font-semibold">
              {sending ? (
                <span className="inline-flex items-center gap-1">
                  {["C", "h", "a", "r", "l", "y", " ", "r", "é", "f", "l", "é", "c", "h", "i", ".", ".", "."].map(
                    (letter, index) => (
                      <span
                        key={`${letter}-${index}`}
                        className="inline-block animate-[charly-bounce_1.2s_ease-in-out_infinite]"
                        style={{ animationDelay: `${index * 0.05}s` }}
                      >
                        {letter}
                      </span>
                    )
                  )}
                </span>
              ) : (
                "Charly IA chat"
              )}
            </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-white/60 hover:text-white"
                aria-label="Fermer le chat IA"
              >
                Fermer
              </button>
            </div>
            <div className="flex-1 p-4 text-sm text-white/80 space-y-2 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="text-white/50">Commence une conversation…</div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                      msg.role === "user"
                        ? "ml-auto bg-emerald-500/20 text-emerald-100 border border-emerald-500/30"
                        : "bg-white/10 text-white/80 border border-white/10"
                    }`}
                  >
                    {msg.text}
                  </div>
                ))
              )}
            </div>
            <form
              className="border-t border-white/10 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
            >
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Écris ton message…"
                  className="flex-1 rounded-md bg-white/10 border border-white/10 px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-orange-400/60"
                />
                <button
                  type="submit"
                  disabled={sending}
                  className="rounded-md bg-orange-500/80 hover:bg-orange-500 px-3 py-2 text-xs font-semibold text-white"
                >
                  {sending ? "..." : "Envoyer"}
                </button>
              </div>
              {sendError ? (
                <div className="mt-2 text-[11px] text-rose-200">{sendError}</div>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}

    </>
  );
}
