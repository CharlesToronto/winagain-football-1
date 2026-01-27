"use client";

import { useMemo } from "react";
import { TeamResult } from "../types";
import { TeamResultCard } from "./TeamResultCard";

export function SearchResults({
  results,
  loading,
  error,
}: {
  results: TeamResult[];
  loading: boolean;
  error?: string | null;
}) {
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

  const groupedResults = useMemo(() => {
    const byLeague = new Map<string, TeamResult[]>();
    const getTime = (date?: string) => {
      if (!date) return Number.POSITIVE_INFINITY;
      const time = new Date(date).getTime();
      return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
    };

    results.forEach((team) => {
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
      };
    });

    grouped.sort((a, b) => {
      if (a.firstTime !== b.firstTime) return a.firstTime - b.firstTime;
      return a.league.localeCompare(b.league);
    });

    return grouped;
  }, [results]);

  return (
    <div className="mt-4 space-y-6">
      {groupedResults.map((group) => (
        <div key={group.league} className="space-y-3">
          <div className="text-sm font-semibold text-white/80 uppercase tracking-wide">
            {group.league}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {group.teams.map((team) => (
              <TeamResultCard key={team.id} team={team} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

