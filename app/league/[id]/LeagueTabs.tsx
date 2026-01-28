"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import StandingsList from "./StandingsList";

type LeagueMatch = {
  id: number;
  round?: string;
  status?: string;
  timestamp?: number;
  date?: string;
  time?: string;
  homeTeam?: { id?: number; name?: string; logo?: string };
  awayTeam?: { id?: number; name?: string; logo?: string };
};

type LeagueTabsProps = {
  leagueId: string;
  table: any[];
  opponentByTeam: Record<number, number | undefined>;
};

export default function LeagueTabs({ leagueId, table, opponentByTeam }: LeagueTabsProps) {
  const [tab, setTab] = useState<"standings" | "matches">("standings");
  const [matches, setMatches] = useState<LeagueMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (tab !== "matches" || loaded) return;
    let active = true;
    setLoading(true);
    setError(null);

    fetch(`/api/competitions/${leagueId}/matches?season=2025`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Erreur chargement matchs");
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        setMatches(Array.isArray(data) ? data : []);
        setLoaded(true);
      })
      .catch((err: any) => {
        if (!active) return;
        setError(err?.message ?? "Erreur chargement matchs");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tab, leagueId, loaded]);

  const upcomingMatches = useMemo(() => {
    const now = Date.now();
    const list = (matches ?? []).filter((match) => {
      const ts = Number(match.timestamp ?? 0);
      if (Number.isFinite(ts) && ts > 0) {
        return ts * 1000 >= now - 5 * 60 * 1000;
      }
      return match.status && match.status !== "FT";
    });
    return list.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  }, [matches]);

  const formatRoundLabel = (round: string) => {
    const match = round.match(/(\\d+)/);
    if (match?.[1]) return `Journée ${match[1]}`;
    return round;
  };

  const nextRoundInfo = useMemo(() => {
    if (!upcomingMatches.length) {
      return { matches: [] as LeagueMatch[], roundLabel: null as string | null };
    }
    const firstRound =
      upcomingMatches.find((match) => match.round && match.round.trim().length > 0)?.round ??
      null;
    if (!firstRound) {
      return { matches: upcomingMatches, roundLabel: null };
    }
    return {
      matches: upcomingMatches.filter((match) => match.round === firstRound),
      roundLabel: formatRoundLabel(firstRound),
    };
  }, [upcomingMatches]);

  const groupedMatches = useMemo(() => {
    const map = new Map<string, LeagueMatch[]>();
    const formatLabel = (date: Date | null) =>
      date
        ? date.toLocaleDateString("fr-FR", {
            weekday: "short",
            day: "2-digit",
            month: "short",
          })
        : "Date inconnue";

    nextRoundInfo.matches.forEach((match) => {
      const date = match.timestamp ? new Date(match.timestamp * 1000) : null;
      const label = formatLabel(date);
      const list = map.get(label) ?? [];
      list.push(match);
      map.set(label, list);
    });

    return Array.from(map.entries()).map(([label, items]) => ({
      label,
      items,
    }));
  }, [nextRoundInfo.matches]);

  const resolveTimeLabel = (match: LeagueMatch) => {
    if (match.timestamp) {
      const date = new Date(match.timestamp * 1000);
      if (Number.isFinite(date.getTime())) {
        return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      }
    }
    return match.time ?? "--:--";
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">League #{leagueId}</h1>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("standings")}
          className={`px-3 py-1 rounded-lg text-sm transition ${
            tab === "standings"
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
        >
          Classement
        </button>
        <button
          type="button"
          onClick={() => setTab("matches")}
          className={`px-3 py-1 rounded-lg text-sm transition ${
            tab === "matches"
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
        >
          Matchs
        </button>
      </div>

      {tab === "standings" ? (
        table.length === 0 ? (
          <p className="text-sm text-white/70">No standings available.</p>
        ) : (
          <StandingsList table={table} opponentByTeam={opponentByTeam} />
        )
      ) : loading ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
          Chargement des matchs...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      ) : nextRoundInfo.matches.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
          Aucun prochain match pour cette ligue.
        </div>
      ) : (
        <div className="space-y-4">
          {groupedMatches.map((group) => (
            <div key={group.label} className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-white/60">
                {group.label}
                {nextRoundInfo.roundLabel ? ` • ${nextRoundInfo.roundLabel}` : ""}
              </div>
              <div className="space-y-2">
                {group.items.map((match) => (
                  (() => {
                    const targetHref = match.homeTeam?.id
                      ? `/team/${match.homeTeam.id}`
                      : null;
                    const Wrapper = targetHref ? Link : "div";
                    return (
                      <Wrapper
                        key={match.id}
                        href={targetHref ?? undefined}
                        className={`rounded-lg border border-white/10 bg-white/5 px-3 py-2 block ${
                          targetHref ? "hover:border-white/30 hover:bg-white/10 transition" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] text-white/60">
                          <span>{resolveTimeLabel(match)}</span>
                        </div>
                        <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            {match.homeTeam?.logo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={match.homeTeam.logo}
                                alt={match.homeTeam.name ?? "Home"}
                                className="h-5 w-5 object-contain"
                              />
                            ) : (
                              <div className="h-5 w-5 rounded-full bg-white/10" />
                            )}
                            <span className="truncate font-semibold">
                              {match.homeTeam?.name ?? "Home"}
                            </span>
                          </div>
                          <div className="text-xs text-white/60 text-center">VS</div>
                          <div className="flex items-center justify-end gap-2 min-w-0 text-right">
                            <span className="truncate font-semibold">
                              {match.awayTeam?.name ?? "Away"}
                            </span>
                            {match.awayTeam?.logo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={match.awayTeam.logo}
                                alt={match.awayTeam.name ?? "Away"}
                                className="h-5 w-5 object-contain"
                              />
                            ) : (
                              <div className="h-5 w-5 rounded-full bg-white/10" />
                            )}
                          </div>
                        </div>
                      </Wrapper>
                    );
                  })()
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
