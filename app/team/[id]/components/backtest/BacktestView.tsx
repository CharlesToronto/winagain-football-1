"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import Card from "@/app/components/ui/Card";
import { getLeagueFixturesBySeason } from "@/lib/queries/fixtures";
import { useTeamAlgoSettings } from "@/app/components/algo/useTeamAlgoSettings";
import AlgoComparator from "./AlgoComparator";
import AlgoAutoTester from "./AlgoAutoTester";
import {
  AlgoSettings,
  Rolling,
  createRolling,
  addRolling,
  weightedRollingAvg,
} from "@/lib/analysisEngine/overUnderModel";
import {
  computeBacktest,
  computePoissonOutcomes,
  computeEmpiricalOutcomes,
  mixOutcomes,
  getDoubleChanceProbability,
  type BacktestFixture,
  type BacktestPick,
} from "@/lib/analysisEngine/overUnderBacktest";

const BASELINE_HOME = 1.35;
const BASELINE_AWAY = 1.15;
const TREND_WINDOW_SIZE = 10;

type RangeOption = number | "season";

type FixtureRow = BacktestFixture;

type PickRow = BacktestPick;

type BacktestViewProps = {
  teamId: number | null;
  leagueId: number | null;
  range: RangeOption;
  currentSeason: number;
  nextMatch?: {
    fixture?: { date?: string | null; id?: number | null };
    teams?: {
      home?: { id?: number | null; name?: string | null; logo?: string | null };
      away?: { id?: number | null; name?: string | null; logo?: string | null };
    };
  } | null;
};

type NextMatchInfo = {
  fixtureId: number | null;
  dateUtc: string | null;
  homeId: number | null;
  awayId: number | null;
  homeName: string | null;
  awayName: string | null;
};

type PickResult = {
  status: "pick" | "no-bet" | "no-data";
  pick?: string;
  probability?: number;
  reason?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function poissonCdf(lambda: number, k: number) {
  if (k < 0) return 0;
  const L = Math.exp(-lambda);
  let sum = L;
  let p = L;
  for (let i = 1; i <= k; i += 1) {
    p = (p * lambda) / i;
    sum += p;
  }
  return sum;
}

function shrink(avg: number, n: number, priorAvg: number, priorN: number) {
  if (!n) return priorAvg;
  return (avg * n + priorAvg * priorN) / (n + priorN);
}

function buildNextMatchInfo(nextMatch: BacktestViewProps["nextMatch"]): NextMatchInfo | null {
  if (!nextMatch) return null;
  const home = nextMatch.teams?.home ?? null;
  const away = nextMatch.teams?.away ?? null;
  const fixtureId = Number(nextMatch.fixture?.id ?? 0);
  const homeId = Number(home?.id ?? 0);
  const awayId = Number(away?.id ?? 0);
  if (!Number.isFinite(homeId) || !Number.isFinite(awayId)) return null;
  return {
    fixtureId: Number.isFinite(fixtureId) && fixtureId > 0 ? fixtureId : null,
    dateUtc: nextMatch.fixture?.date ?? null,
    homeId,
    awayId,
    homeName: home?.name ?? null,
    awayName: away?.name ?? null,
  };
}

function computeUpcomingPick(
  fixtures: FixtureRow[],
  nextMatch: NextMatchInfo | null,
  settings: AlgoSettings
): PickResult {
  if (!nextMatch) {
    return { status: "no-data", reason: "Prochain match indisponible." };
  }

  const targetTime = nextMatch.dateUtc ? new Date(nextMatch.dateUtc).getTime() : Infinity;
  const ordered = fixtures
    .filter((fixture) => fixture.date_utc)
    .map((fixture) => ({
      ...fixture,
      dateTime: fixture.date_utc ? new Date(fixture.date_utc).getTime() : 0,
    }))
    .filter((fixture) => Number.isFinite(fixture.dateTime) && fixture.dateTime < targetTime)
    .sort((a, b) => a.dateTime - b.dateTime);

  const teamHistory = new Map<number, { home: Rolling; away: Rolling }>();
  let leagueHomeGoals = 0;
  let leagueAwayGoals = 0;
  let leagueMatches = 0;

  for (const fixture of ordered) {
    const homeId = Number(fixture.home_team_id);
    const awayId = Number(fixture.away_team_id);
    const goalsHome = Number(fixture.goals_home);
    const goalsAway = Number(fixture.goals_away);

    if (!Number.isFinite(homeId) || !Number.isFinite(awayId)) continue;
    if (!Number.isFinite(goalsHome) || !Number.isFinite(goalsAway)) continue;

    if (!teamHistory.has(homeId)) {
      teamHistory.set(homeId, { home: createRolling(), away: createRolling() });
    }
    if (!teamHistory.has(awayId)) {
      teamHistory.set(awayId, { home: createRolling(), away: createRolling() });
    }

    addRolling(teamHistory.get(homeId)!.home, goalsHome, goalsAway, settings.windowSize);
    addRolling(teamHistory.get(awayId)!.away, goalsAway, goalsHome, settings.windowSize);
    leagueHomeGoals += goalsHome;
    leagueAwayGoals += goalsAway;
    leagueMatches += 1;
  }

  const homeStats = teamHistory.get(nextMatch.homeId ?? 0)?.home ?? null;
  const awayStats = teamHistory.get(nextMatch.awayId ?? 0)?.away ?? null;

  if (!homeStats || !awayStats) {
    return { status: "no-data", reason: "Pas assez de data historique." };
  }

  const homeAvg = weightedRollingAvg(homeStats, settings.bucketSize, settings.weights);
  const awayAvg = weightedRollingAvg(awayStats, settings.bucketSize, settings.weights);
  if (homeAvg.n < settings.minMatches || awayAvg.n < settings.minMatches) {
    return { status: "no-data", reason: "Pas assez de matchs récents." };
  }

  const leagueHomeAvg =
    leagueMatches >= settings.minLeagueMatches ? leagueHomeGoals / leagueMatches : BASELINE_HOME;
  const leagueAwayAvg =
    leagueMatches >= settings.minLeagueMatches ? leagueAwayGoals / leagueMatches : BASELINE_AWAY;

  const adjHomeGF = shrink(homeAvg.gf, homeAvg.n, leagueHomeAvg, settings.windowSize);
  const adjHomeGA = shrink(homeAvg.ga, homeAvg.n, leagueAwayAvg, settings.windowSize);
  const adjAwayGF = shrink(awayAvg.gf, awayAvg.n, leagueAwayAvg, settings.windowSize);
  const adjAwayGA = shrink(awayAvg.ga, awayAvg.n, leagueHomeAvg, settings.windowSize);

  const attackHome = adjHomeGF / leagueHomeAvg;
  const defenseHome = adjHomeGA / leagueAwayAvg;
  const attackAway = adjAwayGF / leagueAwayAvg;
  const defenseAway = adjAwayGA / leagueHomeAvg;

  const xGHome = clamp(attackHome * defenseAway * leagueHomeAvg, 0.1, 6);
  const xGAway = clamp(attackAway * defenseHome * leagueAwayAvg, 0.1, 6);
  const lambda = xGHome + xGAway;

  const poissonOutcomes = computePoissonOutcomes(xGHome, xGAway);
  const empiricalOutcomes = computeEmpiricalOutcomes(
    homeStats,
    awayStats,
    settings.bucketSize,
    settings.weights
  );
  const blendedOutcomes = mixOutcomes(poissonOutcomes, empiricalOutcomes);

  let bestPick:
    | { type: "over" | "under"; line: number; probability: number }
    | { type: "dc"; line: "1X" | "X2" | "12"; probability: number }
    | null = null;
  for (const line of settings.lines) {
    if (typeof line === "number") {
      const thresholdLine = Math.floor(line);
      const pUnder = poissonCdf(lambda, thresholdLine);
      const pOver = 1 - pUnder;
      if (!bestPick || pOver > bestPick.probability) {
        bestPick = { type: "over", line, probability: pOver };
      }
      if (pUnder > bestPick.probability) {
        bestPick = { type: "under", line, probability: pUnder };
      }
    } else {
      const probability = getDoubleChanceProbability(blendedOutcomes, line);
      if (!bestPick || probability > bestPick.probability) {
        bestPick = { type: "dc", line, probability };
      }
    }
  }

  if (!bestPick) {
    return { status: "no-data", reason: "Pas assez de data pour calculer." };
  }

  if (bestPick.probability < settings.threshold) {
    return {
      status: "no-bet",
      reason: `Proba ${bestPick.probability.toFixed(2)} < seuil ${settings.threshold.toFixed(2)}`,
    };
  }

  return {
    status: "pick",
    pick:
      bestPick.type === "dc"
        ? bestPick.line
        : `${bestPick.type === "over" ? "Over" : "Under"} ${bestPick.line}`,
    probability: bestPick.probability,
  };
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "-";
  return format(parsed, "dd MMM yyyy");
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "-";
  return format(parsed, "dd MMM yyyy HH:mm");
}

export default function BacktestView({
  teamId,
  leagueId,
  range,
  currentSeason,
  nextMatch,
}: BacktestViewProps) {
  const { settings } = useTeamAlgoSettings(teamId);
  const [seasonMode, setSeasonMode] = useState<"current" | "previous" | "both">("current");
  const [showAllLatest, setShowAllLatest] = useState(false);
  const [algoTab, setAlgoTab] = useState<"auto" | "quick">("auto");
  const [fixturesBySeason, setFixturesBySeason] = useState<Record<number, FixtureRow[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seasons = useMemo(() => {
    if (seasonMode === "both") return [currentSeason - 1, currentSeason];
    if (seasonMode === "previous") return [currentSeason - 1];
    return [currentSeason];
  }, [seasonMode, currentSeason]);

  const fixtures = useMemo(() => {
    return seasons.flatMap((season) => fixturesBySeason[season] ?? []);
  }, [seasons, fixturesBySeason]);

  const seasonLabel = useMemo(() => {
    if (seasonMode === "both") return `${currentSeason - 1}+${currentSeason}`;
    if (seasonMode === "previous") return `${currentSeason - 1}`;
    return `${currentSeason}`;
  }, [seasonMode, currentSeason]);

  useEffect(() => {
    if (!leagueId) return;
    const toFetch = seasons.filter((season) => !fixturesBySeason[season]);
    if (!toFetch.length) return;
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all(
      toFetch.map(async (season) => {
        const data = await getLeagueFixturesBySeason(leagueId, season);
        return { season, data: Array.isArray(data) ? (data as FixtureRow[]) : [] };
      })
    )
      .then((results) => {
        if (!active) return;
        setFixturesBySeason((prev) => {
          const next = { ...prev };
          results.forEach((res) => {
            next[res.season] = res.data;
          });
          return next;
        });
      })
      .catch((err: any) => {
        if (!active) return;
        setError(err?.message ?? "Erreur chargement fixtures.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [leagueId, seasons, fixturesBySeason]);

  const result = useMemo(
    () => computeBacktest(fixtures, teamId, settings),
    [fixtures, teamId, settings]
  );
  const nextMatchInfo = useMemo(() => buildNextMatchInfo(nextMatch ?? null), [nextMatch]);
  const nextPick = useMemo(
    () => computeUpcomingPick(fixtures, nextMatchInfo, settings),
    [fixtures, nextMatchInfo, settings]
  );
  const hasUpcomingPick = nextPick.status === "pick";

  const picksForRange = useMemo(() => {
    const sorted = [...result.picks].sort((a, b) => b.dateTime - a.dateTime);
    if (range === "season") return sorted;
    const limit = Number(range);
    return sorted.slice(0, limit);
  }, [result.picks, range]);

  const filteredPicks = useMemo(
    () => picksForRange.filter((pick) => pick.probability >= settings.threshold),
    [picksForRange, settings.threshold]
  );

  const displayPicks = useMemo(() => filteredPicks, [filteredPicks]);

  const latestPicks = useMemo(
    () => (showAllLatest ? displayPicks : []),
    [showAllLatest, displayPicks]
  );

  const hits = displayPicks.filter((pick) => pick.hit).length;
  const picksCount = displayPicks.length;
  const hitRate = picksCount ? (hits / picksCount) * 100 : 0;
  const coverage = picksForRange.length ? (picksCount / picksForRange.length) * 100 : 0;

  const rollingSeries = useMemo(() => {
    const ordered = [...displayPicks].sort((a, b) => a.dateTime - b.dateTime);
    const series: number[] = [];
    for (let i = 0; i < ordered.length; i += 1) {
      const start = Math.max(0, i - TREND_WINDOW_SIZE + 1);
      const slice = ordered.slice(start, i + 1);
      const hitCount = slice.filter((pick) => pick.hit).length;
      series.push(slice.length ? Math.round((hitCount / slice.length) * 100) : 0);
    }
    return series.length >= 2 ? series : [0, 0];
  }, [displayPicks]);

  if (!leagueId) {
    return (
      <div className="p-6 bg-white/10 border border-white/10 rounded-xl text-white">
        League data not available yet.
      </div>
    );
  }

  return (
    <div className="space-y-6 text-white">
      <Card
        className={`text-white !bg-gradient-to-br ${
          hasUpcomingPick
            ? "!border-0 from-[#7a0b4b] via-[#a01468] to-[#d02a82]"
            : nextPick.status === "no-bet"
            ? "!border-0 from-[#7a0b4b]/70 via-[#a01468]/70 to-[#d02a82]/70"
            : "!border-0 from-[#2a0b1a] via-[#1f0b20] to-[#140815]"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/60">
              Prochain match
            </p>
            <p className="text-lg font-semibold">
              {nextMatchInfo
                ? `${nextMatchInfo.homeName ?? "Home"} vs ${
                    nextMatchInfo.awayName ?? "Away"
                  }`
                : "Indisponible"}
            </p>
            <p className="text-xs text-white/60">
              {nextMatchInfo?.dateUtc ? formatDateTime(nextMatchInfo.dateUtc) : "Date inconnue"}
            </p>
            <p className="text-[11px] text-white/50">Saison analysée : {seasonLabel}</p>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1">
            {nextPick.status === "pick" ? (
              <>
                <p className="text-sm text-white/70">Pick recommandé</p>
                <p className="text-lg font-semibold">{nextPick.pick}</p>
                <p className="text-xs text-white/60">
                  {((nextPick.probability ?? 0) * 100).toFixed(1)}%
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-white font-semibold">NO BET</p>
                <p className="text-xs text-white/60">{nextPick.reason}</p>
              </>
            )}
            <p className="text-[11px] text-white/50">Seuil: {settings.threshold.toFixed(2)}</p>
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-6">
        <div className="order-2 md:order-1 space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAlgoTab("auto")}
              className={`px-3 py-1 rounded-lg text-sm transition ${
                algoTab === "auto"
                  ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                  : "bg-white/10 text-white/70 hover:bg-white/20"
              }`}
            >
              Algo AutoTests
            </button>
            <button
              type="button"
              onClick={() => setAlgoTab("quick")}
              className={`px-3 py-1 rounded-lg text-sm transition ${
                algoTab === "quick"
                  ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                  : "bg-white/10 text-white/70 hover:bg-white/20"
              }`}
            >
              Algo - Comparaison
            </button>
          </div>

          {algoTab === "auto" ? (
            <AlgoAutoTester
              teamId={teamId}
              leagueId={leagueId}
              currentSeason={currentSeason}
            />
          ) : (
            <AlgoComparator
              teamId={teamId}
              leagueId={leagueId}
              currentSeason={currentSeason}
            />
          )}
        </div>

        <div className="order-1 md:order-2 space-y-6">
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory sm:flex-wrap sm:overflow-visible sm:gap-3">
            <div className="flex flex-nowrap gap-2 sm:flex-wrap">
              {([
                { key: "current", label: `Season ${currentSeason}` },
                { key: "previous", label: `Season ${currentSeason - 1}` },
                { key: "both", label: `Season ${currentSeason - 1}+${currentSeason}` },
              ] as const).map((option) => (
                <button
                  key={`season-${option.key}`}
                  type="button"
                  onClick={() => setSeasonMode(option.key)}
                  className={`px-3 py-1 rounded-lg text-sm snap-start whitespace-nowrap transition ${
                    seasonMode === option.key
                      ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                      : "bg-white/10 text-white/70 hover:bg-white/15"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-6 bg-white/10 border border-white/10 rounded-xl text-white">
              Loading league fixtures...
            </div>
          ) : error ? (
            <div className="p-6 bg-white/10 border border-white/10 rounded-xl text-white">
              {error}
            </div>
          ) : (
            <>
              <div className="md:hidden space-y-4">
                <div className="flex flex-nowrap gap-4 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                  <div className="snap-start shrink-0 w-[85%]">
                    <Card className="!bg-gradient-to-br from-orange-500 via-orange-400 to-orange-600 text-white !border-0">
                      <p className="text-sm text-white/70">Picks</p>
                      <p className="text-3xl font-semibold">{picksCount}</p>
                      <p className="text-xs text-white/60">
                        Range: {range === "season" ? "Season" : `${range} matches`}
                      </p>
                    </Card>
                  </div>
                  <div className="snap-start shrink-0 w-[85%]">
                    <Card className="!bg-gradient-to-br from-orange-500 via-orange-400 to-orange-600 text-white !border-0">
                      <p className="text-sm text-white/70">Hits</p>
                      <p className="text-3xl font-semibold">{hits}</p>
                      <p className="text-xs text-white/60">
                        Threshold {settings.threshold.toFixed(2)}
                      </p>
                    </Card>
                  </div>
                </div>
                <div className="flex flex-nowrap gap-4 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                  <div className="snap-start shrink-0 w-[85%]">
                    <Card className="!bg-gradient-to-br from-orange-500 via-orange-400 to-orange-600 text-white !border-0">
                      <p className="text-sm text-white/70">Hit Rate</p>
                      <p className="text-3xl font-semibold">{hitRate.toFixed(1)}%</p>
                      <p className="text-xs text-white/60">
                        Rolling window {settings.windowSize}
                      </p>
                    </Card>
                  </div>
                  <div className="snap-start shrink-0 w-[85%]">
                    <Card className="!bg-gradient-to-br from-orange-500 via-orange-400 to-orange-600 text-white !border-0">
                      <p className="text-sm text-white/70">Coverage</p>
                      <p className="text-3xl font-semibold">{coverage.toFixed(1)}%</p>
                      <p className="text-xs text-white/60">Based on picks in range</p>
                    </Card>
                  </div>
                </div>
              </div>

              <div className="hidden md:grid md:grid-cols-4 gap-4">
                <Card className="!bg-gradient-to-br from-orange-500 via-orange-400 to-orange-600 text-white !border-0">
                  <p className="text-sm text-white/70">Picks</p>
                  <p className="text-3xl font-semibold">{picksCount}</p>
                  <p className="text-xs text-white/60">
                    Range: {range === "season" ? "Season" : `${range} matches`}
                  </p>
                </Card>
                <Card className="!bg-gradient-to-br from-orange-500 via-orange-400 to-orange-600 text-white !border-0">
                  <p className="text-sm text-white/70">Hits</p>
                  <p className="text-3xl font-semibold">{hits}</p>
                  <p className="text-xs text-white/60">
                    Threshold {settings.threshold.toFixed(2)}
                  </p>
                </Card>
                <Card className="!bg-gradient-to-br from-orange-500 via-orange-400 to-orange-600 text-white !border-0">
                  <p className="text-sm text-white/70">Hit Rate</p>
                  <p className="text-3xl font-semibold">{hitRate.toFixed(1)}%</p>
                  <p className="text-xs text-white/60">
                    Rolling window {settings.windowSize}
                  </p>
                </Card>
                <Card className="!bg-gradient-to-br from-orange-500 via-orange-400 to-orange-600 text-white !border-0">
                  <p className="text-sm text-white/70">Coverage</p>
                  <p className="text-3xl font-semibold">{coverage.toFixed(1)}%</p>
                  <p className="text-xs text-white/60">Based on picks in range</p>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>

      {!loading && !error && (
        <Card className="bg-white/10 border-orange-400/60 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="text-lg font-semibold">Latest Picks</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={showAllLatest}
                onClick={() => setShowAllLatest((prev) => !prev)}
                className="px-3 py-1 rounded-lg text-sm bg-white/10 text-white/70 hover:bg-white/15"
              >
                {showAllLatest ? "Réduire" : "Dérouler"}
              </button>
            </div>
          </div>
          {displayPicks.length === 0 ? (
            <p className="text-sm text-white/70">
              No picks for this range/threshold yet.
            </p>
          ) : !showAllLatest ? (
            <p className="text-sm text-white/70">Liste masquée.</p>
          ) : (
            <div className="space-y-3">
              {latestPicks.map((pick) => (
                <div
                  key={`pick-${pick.fixtureId}`}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border border-white/10 rounded-lg px-3 py-2 bg-white/5"
                >
                  <div>
                    <p className="text-sm font-medium">{pick.label}</p>
                    <p className="text-xs text-white/60">
                      {formatDate(pick.dateUtc)} • Score {pick.score}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-white/70">{pick.pick}</span>
                    <span className="text-white/70">{(pick.probability * 100).toFixed(1)}%</span>
                    <span
                      className={`px-2 py-1 rounded-md text-xs font-semibold ${
                        pick.hit ? "bg-green-500/20 text-green-200" : "bg-red-500/20 text-red-200"
                      }`}
                    >
                      {pick.hit ? "HIT" : "MISS"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
