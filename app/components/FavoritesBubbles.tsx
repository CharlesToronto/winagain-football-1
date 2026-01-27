"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FAVORITES_STORAGE_KEY, type FavoriteTeam } from "@/lib/favorites";

export default function FavoritesBubbles() {
  const [favorites, setFavorites] = useState<FavoriteTeam[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    if (!isMobile) {
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    const loadFavorites = () => {
      try {
        const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
        if (!raw) {
          setFavorites([]);
          return;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const cleaned = parsed
            .filter((item) => item && typeof item.id === "number")
            .map((item) => ({
              id: item.id,
              name: item.name ?? "",
              logo: item.logo ?? null,
            }));
          setFavorites(cleaned);
        } else {
          setFavorites([]);
        }
      } catch (error) {
        setFavorites([]);
      }
    };

    loadFavorites();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === FAVORITES_STORAGE_KEY) {
        loadFavorites();
      }
    };

    const handleFavoritesUpdated = () => {
      loadFavorites();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("favorites-updated", handleFavoritesUpdated);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("favorites-updated", handleFavoritesUpdated);
    };
  }, []);

  if (favorites.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col items-end gap-2 md:top-auto md:right-6 md:left-auto md:bottom-6 md:flex-col-reverse mobile-fab">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label="Favoris"
        title="Favoris"
        className={`w-10 h-10 rounded-full border border-white/10 backdrop-blur-md shadow flex items-center justify-center transition ${
          open ? "bg-white/20 text-white" : "bg-white/10 text-white/90"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z"
          />
        </svg>
      </button>

      {open ? (
        <div className="flex flex-col items-start gap-2 md:items-end">
          {favorites.map((fav) => (
            <Link
              key={fav.id}
              href={`/team/${fav.id}?tab=stats`}
              className="w-10 h-10 rounded-full bg-white/10 border border-white/10 backdrop-blur-md shadow flex items-center justify-center overflow-hidden"
              title={fav.name || "Équipe"}
              aria-label={fav.name || "Équipe"}
            >
              {fav.logo ? (
                <img
                  src={fav.logo}
                  alt={fav.name || "Équipe"}
                  className="w-6 h-6 object-contain"
                />
              ) : (
                <span className="text-xs font-semibold text-white">
                  {(fav.name || "??").slice(0, 2).toUpperCase()}
                </span>
              )}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
