"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FAVORITES_STORAGE_KEY, type FavoriteTeam } from "@/lib/favorites";

export default function FavoritesBubbles() {
  const [favorites, setFavorites] = useState<FavoriteTeam[]>([]);
  const [open, setOpen] = useState(false);
  const [swipeId, setSwipeId] = useState<number | null>(null);
  const [dragX, setDragX] = useState(0);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdIdRef = useRef<number | null>(null);

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

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdIdRef.current = null;
  };

  const removeFavorite = (id: number) => {
    setFavorites((prev) => {
      const next = prev.filter((fav) => fav.id !== id);
      try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
        window.dispatchEvent(new Event("favorites-updated"));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const handlePointerDown = (id: number) => (event: React.PointerEvent) => {
    if (event.pointerType === "mouse") return;
    clearHoldTimer();
    setDragX(0);
    holdIdRef.current = id;
    holdTimerRef.current = setTimeout(() => {
      setSwipeId(id);
      holdTimerRef.current = null;
    }, 1000);
  };

  const handlePointerMove = (id: number) => (event: React.PointerEvent) => {
    if (event.pointerType === "mouse") return;
    if (holdIdRef.current === id && holdTimerRef.current) {
      const moveDistance = Math.abs(event.movementX);
      if (moveDistance > 4) {
        clearHoldTimer();
        return;
      }
    }
    if (swipeId !== id) return;
    setDragX((prev) => Math.min(0, Math.max(-80, prev + event.movementX)));
  };

  const handlePointerUp = (id: number) => () => {
    if (holdIdRef.current === id) {
      clearHoldTimer();
    }
    if (swipeId !== id) return;
    if (dragX <= -60) {
      removeFavorite(id);
    }
    setSwipeId(null);
    setDragX(0);
  };

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
          {favorites.map((fav) => {
            const isActive = swipeId === fav.id;
            const translateStyle = isActive ? { transform: `translateX(${dragX}px)` } : undefined;
            return (
              <Link
                key={fav.id}
                href={`/team/${fav.id}?tab=stats`}
                className={`w-10 h-10 rounded-full bg-white/10 border border-white/10 backdrop-blur-md shadow flex items-center justify-center overflow-hidden ${
                  isActive ? "transition-none" : "transition-transform"
                }`}
                title={fav.name || "Équipe"}
                aria-label={fav.name || "Équipe"}
                style={translateStyle}
                onPointerDown={handlePointerDown(fav.id)}
                onPointerMove={handlePointerMove(fav.id)}
                onPointerUp={handlePointerUp(fav.id)}
                onPointerCancel={handlePointerUp(fav.id)}
                onClick={(event) => {
                  if (swipeId === fav.id || dragX < 0) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
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
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
