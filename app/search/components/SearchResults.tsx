"use client";

import { useEffect, useMemo, useState } from "react";
import { TeamResult } from "../types";
import { TeamResultCard } from "./TeamResultCard";

const FAVORITE_COMPETITIONS_STORAGE_KEY = "winagain:fav_competitions";

export function SearchResults({
  results,
  loading,
  error,
}: {
  results: TeamResult[];
  loading: boolean;
  error?: string | null;
}) {
  const [favoriteCompetitions, setFavoriteCompetitions] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITE_COMPETITIONS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const cleaned = parsed
        .map((value) => (typeof value === "string" ? value : null))
        .filter((value): value is string => Boolean(value));
      setFavoriteCompetitions(new Set(cleaned));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const toggleCompetitionFavorite = (league: string) => {
    setFavoriteCompetitions((prev) => {
      const next = new Set(prev);
      if (next.has(league)) next.delete(league);
      else next.add(league);
      try {
        window.localStorage.setItem(
          FAVORITE_COMPETITIONS_STORAGE_KEY,
          JSON.stringify(Array.from(next))
        );
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const groupedResults = useMemo(() => {
    const byLeague = new Map<string, TeamResult[]>();
    const getTime = (date?: string) => {
      if (!date) return Number.POSITIVE_INFINITY;
      const time = new Date(date).getTime();
      return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
    };

    (results ?? []).forEach((team) => {
      const league = team.league || "Autres";
      const list = byLeague.get(league) ?? [];
      list.push(team);
      byLeague.set(league, list);
    });

    const grouped = Array.from(byLeague.entries()).map(([league, teams]) => {
      teams.sort((a, b) => {
        const timeA = getTime(a.nextMatchDate);
        const timeB = getTime(b.nextMatchDate);
        if (timeA !== timeB) return timeA - timeB;
        return a.name.localeCompare(b.name);
      });
      return {
        league,
        teams,
        firstTime: getTime(teams[0]?.nextMatchDate),
        isFavorite: favoriteCompetitions.has(league),
      };
    });

    grouped.sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      if (a.firstTime !== b.firstTime) return a.firstTime - b.firstTime;
      return a.league.localeCompare(b.league);
    });

    return grouped;
  }, [results, favoriteCompetitions]);

  if (error) {
    return (
      <div className="mt-4 text-red-300 text-sm bg-red-900/30 border border-red-500/20 rounded-lg p-4">
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mt-4 text-white/70 text-sm bg-white/5 border border-white/10 rounded-lg p-4">
        Recherche en cours...
      </div>
    );
  }

  if (!results || results.length === 0) {
    return (
      <div className="mt-4 text-white/70 text-sm bg-white/5 border border-white/10 rounded-lg p-4">
        Aucun resultat pour ces filtres. Ajuste la condition ou la serie.
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      {groupedResults.map((group) => (
        <details
          key={group.league}
          className="rounded-xl border border-white/10 bg-white/5 p-4"
        >
          <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
            <div className="flex items-center gap-2 text-sm font-semibold text-white/80 uppercase tracking-wide">
              <button
                type="button"
                className={`shrink-0 rounded p-1 text-[18px] leading-none transition ${
                  group.isFavorite
                    ? "text-amber-300 hover:text-amber-200"
                    : "text-white/30 hover:text-white/60"
                }`}
                aria-label={
                  group.isFavorite
                    ? `Retirer ${group.league} des favoris`
                    : `Ajouter ${group.league} aux favoris`
                }
                aria-pressed={group.isFavorite}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleCompetitionFavorite(group.league);
                }}
              >
                <span aria-hidden="true">{group.isFavorite ? "★" : "☆"}</span>
              </button>
              <span>
                {group.league} • {group.teams.length} équipes
              </span>
            </div>
          </summary>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            {group.teams.map((team) => (
              <TeamResultCard key={team.id} team={team} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
