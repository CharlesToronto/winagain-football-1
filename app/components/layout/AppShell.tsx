"use client";

import Link from "next/link";
import { ReactNode, useEffect, useState } from "react";
import { FAVORITES_STORAGE_KEY, type FavoriteTeam } from "@/lib/favorites";

type Props = {
  children: ReactNode;
};

export default function AppShell({ children }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ id: string; role: "user" | "assistant"; text: string }>>([]);
  const [input, setInput] = useState("");
  const [favorites, setFavorites] = useState<FavoriteTeam[]>([]);

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

  const sendMessage = () => {
    const value = input.trim();
    if (!value) return;
    const newMsg = { id: `${Date.now()}-${Math.random()}`, role: "user" as const, text: value };
    setMessages((prev) => [...prev, newMsg]);
    setInput("");
  };

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-50 h-14 bg-black/40 backdrop-blur-md border-b border-white/10">
        <div className="h-full max-w-[1400px] mx-auto px-4 sm:px-6 flex items-center">
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
          <div className="flex-1 text-center text-sm text-white/80">
            We have update Charly IA 2.4
          </div>
          <div className="min-w-[180px] flex justify-end">
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
      </div>

      <div className="min-h-screen flex pt-14">
        <main className="team-page min-h-screen mobile-main ml-0 md:ml-64 p-4 sm:p-6 pb-24 md:pb-6 flex-1">
          {favorites.length ? (
            <div className="md:hidden sticky top-14 z-40 mb-4 flex items-center gap-2 overflow-x-auto no-scrollbar rounded-xl border border-white/10 bg-black/40 backdrop-blur-md px-3 py-2">
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
          ) : null}
          {children}
        </main>

        <aside
          className={`hidden md:flex sticky top-14 h-[calc(100vh-56px)] border-l border-white/10 bg-black/40 backdrop-blur-xl transition-[width] duration-300 ease-out overflow-hidden ${
            open ? "w-64 sm:w-72" : "w-0"
          }`}
        >
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="text-sm font-semibold">Charly IA chat</div>
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
                  className="rounded-md bg-orange-500/80 hover:bg-orange-500 px-3 py-2 text-xs font-semibold text-white"
                >
                  Envoyer
                </button>
              </div>
            </form>
          </div>
        </aside>
      </div>

      <div
        className={`md:hidden fixed top-14 left-0 right-0 z-50 border-b border-white/10 bg-black/50 backdrop-blur-xl transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        <div className="h-[calc(100vh-56px)] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="text-sm font-semibold">Charly IA chat</div>
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
                className="rounded-md bg-orange-500/80 hover:bg-orange-500 px-3 py-2 text-xs font-semibold text-white"
              >
                Envoyer
              </button>
            </div>
          </form>
        </div>
      </div>

    </>
  );
}
