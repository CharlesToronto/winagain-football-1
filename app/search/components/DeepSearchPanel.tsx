"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getTeamFixturesAllSeasons } from "@/lib/queries/fixtures";
import { getProbabilityEngines } from "@/lib/adapters/probabilities";
import {
  getGoalsForMode,
  resolveIsHome,
  type Mode,
} from "@/app/team/[id]/components/probabilities/GoalsScoredTrendCard";
import TeamAiAnalysis from "@/app/team/[id]/components/TeamAiAnalysis";

type TeamOption = {
  id: number;
  name: string | null;
  logo: string | null;
  competition_id?: number | null;
};

type MarketSnapshot = {
  id: string;
  filter: "FT" | "HT" | "2H";
  category: string;
  label: string;
  overallPercent: number;
  overallRaw: number;
  overallTotal: number;
  recentPercent: number | null;
  recentRaw: number | null;
  recentTotal: number | null;
};

const SEARCH_MIN_CHARS = 2;
const SEARCH_LIMIT = 12;
const RECENT_SAMPLE = 10;
const MARKET_LINES = ["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"];

function normalizeTeamFixtures(fixtures: any[], teamId: number) {
  const played = (fixtures ?? []).filter(
    (f) => f?.goals_home != null && f?.goals_away != null
  );
  const sorted = [...played].sort(
    (a, b) => new Date(b.date_utc ?? 0).getTime() - new Date(a.date_utc ?? 0).getTime()
  );
  return sorted.map((f) => ({
    ...f,
    isHome: f.home_team_id === teamId,
    home_team_name: f.teams?.name ?? f.home_team_name ?? "Unknown",
    home_team_logo: f.teams?.logo ?? f.home_team_logo ?? null,
    away_team_name: f.opp?.name ?? f.away_team_name ?? "Unknown",
    away_team_logo: f.opp?.logo ?? f.away_team_logo ?? null,
  }));
}

function computeTeamGoalOverUnder(fixtures: any[], mode: Mode, focus: "for" | "against") {
  const totals = fixtures
    .map((f) => {
      const goals = getGoalsForMode(f, mode);
      if (!goals) return null;
      const isHome = resolveIsHome(f);
      if (isHome == null) return null;
      const scored = isHome ? goals.home : goals.away;
      const conceded = isHome ? goals.away : goals.home;
      const value = focus === "for" ? scored : conceded;
      return typeof value === "number" ? value : null;
    })
    .filter((value): value is number => value != null);
  const total = totals.length;
  const over: Record<string, { raw: number; percent: number }> = {};
  const under: Record<string, { raw: number; percent: number }> = {};
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  MARKET_LINES.forEach((t) => {
    const threshold = Number(t);
    const overCount = totals.filter((x) => x > threshold).length;
    const underCount = totals.filter((x) => x <= threshold).length;
    over[t] = { raw: overCount, percent: pct(overCount) };
    under[t] = { raw: underCount, percent: pct(underCount) };
  });
  return { total, over, under };
}

function buildMarketSnapshot(
  statsByFilter: Record<"FT" | "HT" | "2H", any> | null,
  recentStatsByFilter: Record<"FT" | "HT" | "2H", any> | null
) {
  if (!statsByFilter) return [];
  const markets: MarketSnapshot[] = [];

  const addMarket = (
    filter: "FT" | "HT" | "2H",
    category: string,
    label: string,
    overall: { raw?: number; percent?: number } | null,
    recent: { raw?: number; percent?: number } | null,
    total: number,
    recentTotal: number | null
  ) => {
    const percent = Number(overall?.percent ?? 0);
    const raw = Number(overall?.raw ?? 0);
    const recentPercent = recent ? Number(recent.percent ?? 0) : null;
    const recentRaw = recent ? Number(recent.raw ?? 0) : null;
    markets.push({
      id: `${filter}:${category}:${label}`,
      filter,
      category,
      label,
      overallPercent: percent,
      overallRaw: raw,
      overallTotal: total,
      recentPercent,
      recentRaw,
      recentTotal,
    });
  };

  (["FT", "HT", "2H"] as const).forEach((filter) => {
    const stats = statsByFilter[filter];
    if (!stats || !stats.total) return;
    const recent = recentStatsByFilter?.[filter] ?? null;
    const total = Number(stats.total ?? 0);
    const recentTotal = recent ? Number(recent.total ?? 0) : null;

    addMarket(filter, "Résultat", "Victoire", stats.win, recent?.win, total, recentTotal);
    addMarket(filter, "Résultat", "Nul", stats.draw, recent?.draw, total, recentTotal);
    addMarket(filter, "Résultat", "Défaite", stats.lose, recent?.lose, total, recentTotal);
    addMarket(filter, "BTTS", "BTTS", stats.btts, recent?.btts, total, recentTotal);
    addMarket(filter, "Clean sheet", "Clean sheet", stats.clean_home, recent?.clean_home, total, recentTotal);
    addMarket(filter, "Clean sheet", "Équipe muette", stats.clean_away, recent?.clean_away, total, recentTotal);

    addMarket(filter, "Double chance", "1X", stats.dc_1x, recent?.dc_1x, total, recentTotal);
    addMarket(filter, "Double chance", "X2", stats.dc_x2, recent?.dc_x2, total, recentTotal);
    addMarket(filter, "Double chance", "12", stats.dc_12, recent?.dc_12, total, recentTotal);
    addMarket(filter, "Draw no bet", "DNB 1", stats.dnb_home, recent?.dnb_home, total, recentTotal);
    addMarket(filter, "Draw no bet", "DNB 2", stats.dnb_away, recent?.dnb_away, total, recentTotal);

    MARKET_LINES.forEach((line) => {
      addMarket(
        filter,
        "Over/Under",
        `Over ${line}`,
        stats.over?.[line],
        recent?.over?.[line],
        total,
        recentTotal
      );
      addMarket(
        filter,
        "Over/Under",
        `Under ${line}`,
        stats.under?.[line],
        recent?.under?.[line],
        total,
        recentTotal
      );
    });
  });

  return markets;
}

export default function DeepSearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TeamOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<TeamOption | null>(null);
  const [fixtures, setFixtures] = useState<any[]>([]);
  const [fixturesLoading, setFixturesLoading] = useState(false);
  const [fixturesError, setFixturesError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<number | null>(null);

  const { engines } = useMemo(() => getProbabilityEngines(), []);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      window.clearTimeout(searchTimeoutRef.current);
    }
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_CHARS) {
      setResults([]);
      return;
    }
    searchTimeoutRef.current = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const { data, error } = await supabaseBrowser
          .from("teams")
          .select("id,name,logo,competition_id")
          .ilike("name", `%${trimmed}%`)
          .limit(SEARCH_LIMIT);
        if (error) {
          setResults([]);
        } else {
          setResults(
            (data ?? []).map((row: any) => ({
              id: Number(row.id),
              name: row.name ?? null,
              logo: row.logo ?? null,
              competition_id: row.competition_id ?? null,
            }))
          );
        }
      } catch {
        setResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        window.clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query]);

  useEffect(() => {
    if (!selectedTeam?.id) {
      setFixtures([]);
      setFixturesError(null);
      return;
    }
    let active = true;
    setFixturesLoading(true);
    setFixturesError(null);
    getTeamFixturesAllSeasons(selectedTeam.id)
      .then((raw) => {
        if (!active) return;
        const normalized = normalizeTeamFixtures(raw ?? [], selectedTeam.id);
        setFixtures(normalized);
      })
      .catch((error: any) => {
        if (!active) return;
        setFixtures([]);
        setFixturesError(error?.message ?? "Erreur chargement matchs.");
      })
      .finally(() => {
        if (!active) return;
        setFixturesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedTeam?.id]);

  const recentFixtures = useMemo(
    () => fixtures.slice(0, RECENT_SAMPLE),
    [fixtures]
  );

  const statsByFilter = useMemo(() => {
    if (!fixtures.length) return null;
    return {
      FT: engines.FT(fixtures),
      HT: engines.HT(fixtures),
      "2H": engines["2H"](fixtures),
    };
  }, [fixtures, engines]);

  const recentStatsByFilter = useMemo(() => {
    if (!recentFixtures.length) return null;
    return {
      FT: engines.FT(recentFixtures),
      HT: engines.HT(recentFixtures),
      "2H": engines["2H"](recentFixtures),
    };
  }, [recentFixtures, engines]);

  const marketSnapshot = useMemo(
    () => buildMarketSnapshot(statsByFilter, recentStatsByFilter),
    [statsByFilter, recentStatsByFilter]
  );

  const marketCandidates = useMemo(
    () => marketSnapshot.filter((item) => item.overallPercent >= 80),
    [marketSnapshot]
  );

  const teamGoalOverUnder = useMemo(() => {
    if (!fixtures.length) return null;
    return {
      FT: {
        scored: computeTeamGoalOverUnder(fixtures, "FT", "for"),
        conceded: computeTeamGoalOverUnder(fixtures, "FT", "against"),
      },
    };
  }, [fixtures]);

  const payloadExtra = useMemo(() => {
    if (!fixtures.length || !selectedTeam) return null;
    return {
      deepSeek: true,
      fixturesTotal: fixtures.length,
      recentSampleSize: recentFixtures.length,
      statsByFilter,
      recentStatsByFilter,
      marketSnapshot,
      marketCandidates,
      teamGoalOverUnder,
    };
  }, [
    fixtures.length,
    selectedTeam,
    recentFixtures.length,
    statsByFilter,
    recentStatsByFilter,
    marketSnapshot,
    marketCandidates,
    teamGoalOverUnder,
  ]);

  const autoPrompt = useMemo(() => {
    if (!selectedTeam || !fixtures.length) return "";
    return [
      "Deep Seek : tu analyses toutes les données disponibles (payload.extra).",
      "Objectif : proposer un seul pronostic prioritaire avec un taux de réussite global >= 80%.",
      "Base-toi sur payload.extra.marketCandidates (déjà filtrés >=80%).",
      "Si marketCandidates est vide, dis clairement qu'aucun pronostic >=80% n'est disponible.",
      `Donne pour le pronostic : % global, réussite sur les ${RECENT_SAMPLE} derniers matchs (recentPercent + counts), et une explication courte.`,
      "Ajoute une mini-simulation : sur les derniers matchs, combien auraient été gagnants pour ce marché.",
    ].join(" ");
  }, [selectedTeam, fixtures.length]);

  const handleSelectTeam = (team: TeamOption) => {
    setSelectedTeam(team);
    setQuery(team.name ?? "");
    setResults([]);
  };

  const clearSelection = () => {
    setSelectedTeam(null);
    setQuery("");
    setResults([]);
    setFixtures([]);
    setFixturesError(null);
  };

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-white/70">Nouveau moteur</p>
          <h2 className="text-2xl font-semibold">Deep Search</h2>
        </div>
      </div>

      <div className="relative max-w-2xl">
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher une équipe..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
          {selectedTeam ? (
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs text-white/60 hover:text-white"
            >
              Effacer
            </button>
          ) : (
            <span className="text-xs text-white/50">
              {searchLoading ? "Recherche..." : "Entrée"}
            </span>
          )}
        </div>

        {results.length > 0 && (
          <div className="absolute z-20 mt-2 w-full rounded-xl border border-white/10 bg-[#120a24] shadow-lg">
            {results.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => handleSelectTeam(team)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/10"
              >
                {team.logo ? (
                  <img
                    src={team.logo}
                    alt={team.name ?? "Équipe"}
                    className="w-7 h-7 object-contain"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-white/10" />
                )}
                <span className="text-sm font-semibold">{team.name ?? "Équipe"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedTeam && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center gap-3">
          {selectedTeam.logo ? (
            <img
              src={selectedTeam.logo}
              alt={selectedTeam.name ?? "Équipe"}
              className="w-10 h-10 object-contain"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-white/10" />
          )}
          <div className="flex-1">
            <div className="text-sm text-white/60">Équipe sélectionnée</div>
            <div className="text-lg font-semibold">{selectedTeam.name}</div>
          </div>
          <div className="text-xs text-white/50">
            {fixturesLoading
              ? "Chargement..."
              : fixtures.length
                ? `${fixtures.length} match(s)`
                : "Aucun match"}
          </div>
        </div>
      )}

      {fixturesError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {fixturesError}
        </div>
      ) : null}

      {selectedTeam && fixtures.length > 0 ? (
        <TeamAiAnalysis
          key={selectedTeam.id}
          team={selectedTeam}
          league={null}
          nextMatch={null}
          fixtures={fixtures}
          opponentFixtures={[]}
          filter="FT"
          range={fixtures.length}
          nextOpponentName={null}
          nextOpponentId={null}
          payloadExtra={payloadExtra}
          autoPrompt={autoPrompt}
        />
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/60">
          Sélectionne une équipe pour lancer Deep Search.
        </div>
      )}
    </div>
  );
}
