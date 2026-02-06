"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getLeagueFixturesBySeason } from "@/lib/queries/fixtures";
import {
  AlgoSettings,
  type MarketLine,
  normalizeAlgoSettings,
  createRolling,
  addRolling,
  weightedRollingAvg,
} from "@/lib/analysisEngine/overUnderModel";
import {
  computeBacktest,
  computeEmpiricalOutcomes,
  computePoissonOutcomes,
  getDoubleChanceProbability,
  mixOutcomes,
  type BacktestFixture,
} from "@/lib/analysisEngine/overUnderBacktest";
import { logAlgoEvent } from "@/lib/adapters/algoEvents";

const WINDOWS = [10, 15, 20, 25, 30];
const BUCKETS = [3, 5];
const THRESHOLDS = [0.55, 0.6, 0.65, 0.7, 0.75];
const MIN_MATCHES = [5, 7, 10];
const MIN_LEAGUE_MATCHES = [5, 10, 15];
const LINE_SETS: MarketLine[][] = [
  [1.5, 2.5, 3.5],
  [2.5, 3.5, 4.5],
  [1.5, 2.5],
  ["1X", "X2", "12"],
  [1.5, "1X", "X2"],
  [2.5, "1X", "X2"],
];
const HIT_MIN = 0.8;
const MIN_TOTAL_PICKS = 25;
const MIN_ODDS = 1.18;
const MIN_ODDS_RETRY = 1.2;
const V3_COVERAGE_MIN = 0.3;
const CURRENT_SEASON = 2025;
const SETTINGS_STORAGE_PREFIX = "winagain:algo-settings:team:";
const SCAN_STORAGE_KEY = "winagain:daily-scanner:last";
const FAVORITE_COMPETITIONS_STORAGE_KEY = "winagain:fav_competition_ids";
const ANON_USER_ID = "00000000-0000-0000-0000-000000000000";
const TEAM_EVENT_NAME = "algo-settings-team-updated";

type FixtureLite = {
  id: number;
  date_utc: string | null;
  season: number | null;
  status_short: string | null;
  competition_id: number | null;
  home?: { id?: number | null; name?: string | null; logo?: string | null } | null;
  away?: { id?: number | null; name?: string | null; logo?: string | null } | null;
};

type TeamSettingsRow = {
  team_id: number;
  settings: AlgoSettings;
};

type TeamEval = {
  settings: AlgoSettings;
  stats: {
    picks: number;
    hits: number;
    hitRate: number;
    coverage: number;
    evaluated: number;
    avgProbability: number;
    valueScore: number;
    roiScore: number;
  };
};

type ScanResult = {
  fixtureId: number;
  competitionId: number | null;
  competitionName: string | null;
  competitionCountry: string | null;
  competitionLogo: string | null;
  season: number | null;
  dateUtc: string | null;
  homeId: number | null;
  awayId: number | null;
  homeName: string | null;
  awayName: string | null;
  homeLogo: string | null;
  awayLogo: string | null;
  teamId: number;
  teamName: string | null;
  side: "home" | "away";
  pick: string;
  probability: number;
  hitRate: number;
  coverage: number;
  picks: number;
  evaluated: number;
  threshold: number;
  odd: number | null;
  meetsOdds: boolean;
  meetsCriteria: boolean;
  isDiscouraged: boolean;
};

type NextMatchInfo = {
  fixtureId: number | null;
  dateUtc: string | null;
  homeId: number | null;
  awayId: number | null;
};

const normalizeBacktestFixture = (fixture: any): BacktestFixture => {
  const resolveTeam = (value: any) => {
    if (!value) return null;
    if (Array.isArray(value)) return value[0] ?? null;
    return value;
  };

  return {
    id: Number(fixture?.id ?? 0),
    date_utc: fixture?.date_utc ?? null,
    competition_id: fixture?.competition_id ?? null,
    home_team_id: fixture?.home_team_id ?? null,
    away_team_id: fixture?.away_team_id ?? null,
    goals_home: fixture?.goals_home ?? null,
    goals_away: fixture?.goals_away ?? null,
    teams: resolveTeam(fixture?.teams),
    opp: resolveTeam(fixture?.opp),
  };
};

const BASELINE_HOME = 1.35;
const BASELINE_AWAY = 1.15;

function lineKey(line: MarketLine) {
  return typeof line === "number" ? line.toString() : line;
}

type FixtureOdds = {
  overUnder: { over: Record<string, string>; under: Record<string, string> };
  doubleChance: Record<"1X" | "X2" | "12", string>;
};

function parseOddValue(value?: string | null) {
  if (!value) return null;
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveOddForPick(pick: string, odds?: FixtureOdds | null) {
  if (!odds || !pick) return null;
  const trimmed = pick.trim();
  if (trimmed === "1X" || trimmed === "X2" || trimmed === "12") {
    return parseOddValue(odds.doubleChance?.[trimmed as "1X" | "X2" | "12"]);
  }
  const match = trimmed.match(/^(Over|Under)\s+([0-9]+(?:[.,][0-9]+)?)$/i);
  if (!match) return null;
  const lineValue = Number(String(match[2]).replace(",", "."));
  if (!Number.isFinite(lineValue)) return null;
  const key = String(lineValue);
  if (match[1].toLowerCase() === "over") {
    return parseOddValue(odds.overUnder?.over?.[key]);
  }
  return parseOddValue(odds.overUnder?.under?.[key]);
}

function extractPickLine(pick: string): MarketLine | null {
  if (!pick) return null;
  const trimmed = pick.trim();
  if (trimmed === "1X" || trimmed === "X2" || trimmed === "12") return trimmed as MarketLine;
  const match = trimmed.match(/^(Over|Under)\s+([0-9.]+)$/i);
  if (!match) return null;
  const line = Number(match[2]);
  if (!Number.isFinite(line)) return null;
  return line as MarketLine;
}

function isSameLine(a: MarketLine, b: MarketLine) {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "string" && typeof b === "string") return a === b;
  return false;
}

function createRateLimiter(maxConcurrent: number, minIntervalMs: number) {
  let active = 0;
  let lastStart = 0;
  let scheduled = false;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= maxConcurrent || queue.length === 0) return;
    const now = Date.now();
    const wait = Math.max(0, minIntervalMs - (now - lastStart));
    if (wait > 0) {
      if (!scheduled) {
        scheduled = true;
        setTimeout(() => {
          scheduled = false;
          next();
        }, wait);
      }
      return;
    }
    active += 1;
    lastStart = Date.now();
    const run = queue.shift();
    if (run) run();
  };

  return async function limitTask<T>(task: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        task()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            active -= 1;
            next();
          });
      };
      queue.push(run);
      next();
    });
  };
}

const ODDS_MIN_INTERVAL_MS = 250; // ~240 req/min to stay under 300/min
const oddsLimiter = createRateLimiter(1, ODDS_MIN_INTERVAL_MS);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchFixtureOdds(
  fixtureId: number,
  leagueId: number | null,
  season: number | null
): Promise<FixtureOdds | null> {
  if (!Number.isFinite(fixtureId)) return null;
  const resolvedSeason =
    Number.isFinite(season) && (season ?? 0) > 0 ? (season as number) : CURRENT_SEASON;
  if (!Number.isFinite(resolvedSeason)) return null;
  const params = new URLSearchParams({
    fixture: String(fixtureId),
    season: String(resolvedSeason),
    bookmakers: "4,16",
  });
  if (Number.isFinite(leagueId) && (leagueId ?? 0) > 0) {
    params.set("league", String(leagueId));
  }
  return oddsLimiter(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(`/api/odds/fixture?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          return data?.odds ?? null;
        }
        if (res.status === 429 && attempt === 0) {
          await sleep(600);
          continue;
        }
        return null;
      } catch {
        if (attempt === 0) {
          await sleep(600);
          continue;
        }
        return null;
      }
    }
    return null;
  });
}

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

function computeUpcomingPick(
  fixtures: BacktestFixture[],
  nextMatch: NextMatchInfo,
  settings: AlgoSettings,
  excludeLine?: MarketLine | null
) {
  if (!nextMatch?.homeId || !nextMatch?.awayId) {
    return { status: "no-data" as const };
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

  const teamHistory = new Map<number, { home: ReturnType<typeof createRolling>; away: ReturnType<typeof createRolling> }>();
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

  const homeStats = teamHistory.get(nextMatch.homeId)?.home ?? null;
  const awayStats = teamHistory.get(nextMatch.awayId)?.away ?? null;
  if (!homeStats || !awayStats) return { status: "no-data" as const };

  const homeAvg = weightedRollingAvg(homeStats, settings.bucketSize, settings.weights);
  const awayAvg = weightedRollingAvg(awayStats, settings.bucketSize, settings.weights);
  if (homeAvg.n < settings.minMatches || awayAvg.n < settings.minMatches) {
    return { status: "no-data" as const };
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
    if (excludeLine != null && isSameLine(line, excludeLine)) continue;
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

  if (!bestPick) return { status: "no-data" as const };
  if (bestPick.probability < settings.threshold) {
    return { status: "no-bet" as const };
  }

  return {
    status: "pick" as const,
    pick:
      bestPick.type === "dc"
        ? bestPick.line
        : `${bestPick.type === "over" ? "Over" : "Under"} ${bestPick.line}`,
    probability: bestPick.probability,
  };
}

function buildAllSettings(lineSets: MarketLine[][], weightModes: Array<"soft" | "medium" | "hard">) {
  const combos: AlgoSettings[] = [];
  for (const windowSize of WINDOWS) {
    for (const bucketSize of BUCKETS) {
      for (const threshold of THRESHOLDS) {
        for (const minMatches of MIN_MATCHES) {
          for (const minLeagueMatches of MIN_LEAGUE_MATCHES) {
            for (const lines of lineSets) {
              for (const mode of weightModes) {
                const buckets = Math.max(1, Math.ceil(windowSize / bucketSize));
                const weights = Array.from({ length: buckets }, (_, idx) => {
                  const minValue = mode === "soft" ? 0.7 : mode === "medium" ? 0.5 : 0.3;
                  const step = buckets <= 1 ? 0 : (1 - minValue) / (buckets - 1);
                  const value = 1 - idx * step;
                  return Math.round(value * 100) / 100;
                });
                combos.push(
                  normalizeAlgoSettings({
                    windowSize,
                    bucketSize,
                    threshold,
                    minMatches,
                    minLeagueMatches,
                    weights,
                    lines,
                  })
                );
              }
            }
          }
        }
      }
    }
  }
  return combos;
}

function loadLocalTeamSettings(teamId: number) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${SETTINGS_STORAGE_PREFIX}${teamId}`);
    if (!raw) return null;
    return normalizeAlgoSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persistLocalTeamSettings(teamId: number, settings: AlgoSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${SETTINGS_STORAGE_PREFIX}${teamId}`,
      JSON.stringify(settings)
    );
    window.dispatchEvent(
      new CustomEvent(TEAM_EVENT_NAME, {
        detail: { teamId, settings },
      })
    );
  } catch {
    // Ignore storage errors
  }
}

export default function DailyScannerPanel() {
  const [results, setResults] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScanInfo, setLastScanInfo] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dayTab, setDayTab] = useState<"today" | "tomorrow">("today");
  const [hideDiscouraged, setHideDiscouraged] = useState(true);
  const [favoriteCompetitionIds, setFavoriteCompetitionIds] = useState<Set<number>>(
    () => new Set()
  );
  const [leagueHistoryStats, setLeagueHistoryStats] = useState<
    Record<number, { total: number; hits: number; hitRate: number }>
  >({});
  const cacheRef = useRef<Map<string, TeamEval>>(new Map());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITE_COMPETITIONS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const cleaned = parsed
        .map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null))
        .filter((value): value is number => value != null);
      setFavoriteCompetitionIds(new Set(cleaned));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const toggleFavoriteCompetitionId = (id: number) => {
    setFavoriteCompetitionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  const discouragedCompetitionKeys = useMemo(
    () =>
      new Set([
        "Israel|||Liga Leumit",
        "Scotland|||Football League - Highland League",
        "Scotland|||League One",
        "Belgium|||Challenger Pro League",
        "Hungary|||NB II",
        "Italy|||Serie C - Girone A",
      ]),
    []
  );

  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local",
    []
  );

  const isDiscouragedCompetition = (country: string | null, name: string | null) => {
    if (!country || !name) return false;
    return discouragedCompetitionKeys.has(`${country}|||${name}`);
  };

  const toDateKey = (value: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);

  const todayLabel = useMemo(() => {
    const now = new Date();
    return now.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "short" });
  }, []);

  const tomorrowLabel = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "short" });
  }, []);

  const todayKey = useMemo(() => toDateKey(new Date()), [timeZone]);
  const tomorrowKey = useMemo(() => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    return toDateKey(next);
  }, [timeZone]);

  const filteredResults = useMemo(() => {
    const key = dayTab === "today" ? todayKey : tomorrowKey;
    return results.filter((row) => {
      if (!row.dateUtc) return false;
      const date = new Date(row.dateUtc);
      if (!Number.isFinite(date.getTime())) return false;
      if (toDateKey(date) !== key) return false;
      if (hideDiscouraged && row.isDiscouraged) return false;
      return true;
    });
  }, [results, dayTab, todayKey, tomorrowKey, hideDiscouraged]);

  const leagueIdsForHistory = useMemo(() => {
    return Array.from(
      new Set(
        filteredResults
          .map((row) => row.competitionId)
          .filter((id): id is number => Number.isFinite(id))
          .map((id) => Number(id))
      )
    ).sort((a, b) => a - b);
  }, [filteredResults]);

  const leagueIdsForHistoryKey = useMemo(() => leagueIdsForHistory.join(","), [leagueIdsForHistory]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!leagueIdsForHistory.length) {
        setLeagueHistoryStats({});
        return;
      }

      const { data, error } = await supabaseBrowser
        .from("daily_algo_picks_v3")
        .select("league_id,status")
        .in("league_id", leagueIdsForHistory);

      if (!active) return;
      if (error) {
        setLeagueHistoryStats({});
        return;
      }

      const map: Record<number, { total: number; hits: number; hitRate: number }> = {};
      (data ?? []).forEach((row: any) => {
        const leagueId = Number(row?.league_id);
        if (!Number.isFinite(leagueId) || !leagueId) return;
        if (!map[leagueId]) map[leagueId] = { total: 0, hits: 0, hitRate: 0 };
        map[leagueId].total += 1;
        if (row?.status === "hit") map[leagueId].hits += 1;
      });

      Object.values(map).forEach((entry) => {
        entry.hitRate = entry.total ? (entry.hits / entry.total) * 100 : 0;
      });

      setLeagueHistoryStats(map);
    };

    load();
    return () => {
      active = false;
    };
  }, [leagueIdsForHistoryKey]);

  const summaryStats = useMemo(() => {
    const count = filteredResults.length;
    const avgHit =
      count > 0
        ? (filteredResults.reduce((sum, row) => sum + (row.hitRate ?? 0), 0) / count) * 100
        : 0;
    const odds = filteredResults
      .map((row) => Number(row.odd))
      .filter((val) => Number.isFinite(val) && val > 1);
    const avgOdd = odds.length ? odds.reduce((sum, val) => sum + val, 0) / odds.length : 0;
    return { count, avgHit, avgOdd };
  }, [filteredResults]);

  const phase1Candidates = useMemo(
    () => buildAllSettings(LINE_SETS, ["soft"]),
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SCAN_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        results?: ScanResult[];
        lastScanInfo?: string | null;
      };
      if (Array.isArray(parsed.results) && parsed.results.length) {
        setResults(parsed.results);
        setLastScanInfo(parsed.lastScanInfo ?? null);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (!loading) {
      setProgress(0);
      return;
    }
    setProgress(5);
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 96) return prev;
        const next = prev < 80 ? prev + 4 : prev + 1;
        return Math.min(96, next);
      });
    }, 250);
    return () => clearInterval(timer);
  }, [loading]);

  const computeTeamEval = (
    fixtures: BacktestFixture[],
    teamId: number,
    baseSettings: AlgoSettings
  ): TeamEval | null => {
    const cacheKey = `${teamId}:${baseSettings.windowSize}:${baseSettings.bucketSize}:${baseSettings.threshold}:${baseSettings.minMatches}:${baseSettings.minLeagueMatches}:${baseSettings.lines.map(lineKey).join(",")}:${baseSettings.weights.join(",")}`;
    if (cacheRef.current.has(cacheKey)) {
      return cacheRef.current.get(cacheKey) ?? null;
    }
    const result = computeBacktest(fixtures, teamId, baseSettings);
    const allPicks = result.picks;
    const filtered = allPicks.filter((pick) => pick.probability >= baseSettings.threshold);
    const hits = filtered.filter((pick) => pick.hit).length;
    const picks = filtered.length;
    const hitRate = picks ? hits / picks : 0;
    const coverage = allPicks.length ? picks / allPicks.length : 0;
    const avgProbability = picks
      ? filtered.reduce((sum, pick) => sum + (pick.probability || 0), 0) / picks
      : 0;
    const valueScore = avgProbability - baseSettings.threshold;
    const roiScore = hitRate * avgProbability;
    const evalResult: TeamEval = {
      settings: baseSettings,
      stats: {
        picks,
        hits,
        hitRate,
        coverage,
        evaluated: allPicks.length,
        avgProbability,
        valueScore,
        roiScore,
      },
    };
    cacheRef.current.set(cacheKey, evalResult);
    return evalResult;
  };

  const findBestSettingsV3 = (
    fixtures: BacktestFixture[],
    teamId: number
  ): { evalResult: TeamEval; meetsCriteria: boolean } | null => {
    const phase2WeightModes: Array<"soft" | "medium" | "hard"> = ["soft", "medium", "hard"];

    const phase1Computed: TeamEval[] = [];
    phase1Candidates.forEach((settings) => {
      const evalResult = computeTeamEval(fixtures, teamId, settings);
      if (!evalResult) return;
      phase1Computed.push(evalResult);
    });
    const phase1Filtered = phase1Computed.filter(
      (row) =>
        row.stats.hitRate >= HIT_MIN &&
        row.stats.coverage >= V3_COVERAGE_MIN &&
        row.stats.picks >= MIN_TOTAL_PICKS
    );
    const rank = (a: TeamEval, b: TeamEval) => {
      if (b.stats.roiScore !== a.stats.roiScore) return b.stats.roiScore - a.stats.roiScore;
      if (b.stats.hitRate !== a.stats.hitRate) return b.stats.hitRate - a.stats.hitRate;
      if (b.stats.valueScore !== a.stats.valueScore) return b.stats.valueScore - a.stats.valueScore;
      if (b.stats.picks !== a.stats.picks) return b.stats.picks - a.stats.picks;
      return b.stats.coverage - a.stats.coverage;
    };

    const topPhase1 = phase1Filtered.slice().sort(rank).slice(0, 50);
    const phase2Candidates: AlgoSettings[] = [];
    topPhase1.forEach((row) => {
      const buckets = Math.max(1, Math.ceil(row.settings.windowSize / row.settings.bucketSize));
      phase2WeightModes.forEach((mode) => {
        const minValue = mode === "soft" ? 0.7 : mode === "medium" ? 0.5 : 0.3;
        const step = buckets <= 1 ? 0 : (1 - minValue) / (buckets - 1);
        const weights = Array.from({ length: buckets }, (_, idx) => {
          const value = 1 - idx * step;
          return Math.round(value * 100) / 100;
        });
        phase2Candidates.push(
          normalizeAlgoSettings({
            ...row.settings,
            weights,
          })
        );
      });
    });
    const unique = new Map<string, AlgoSettings>();
    phase2Candidates.forEach((settings) => unique.set(JSON.stringify(settings), settings));
    const finalCandidates = Array.from(unique.values());
    const phase2Computed: TeamEval[] = [];
    finalCandidates.forEach((settings) => {
      const evalResult = computeTeamEval(fixtures, teamId, settings);
      if (!evalResult) return;
      phase2Computed.push(evalResult);
    });
    const phase2Filtered = phase2Computed.filter(
      (row) =>
        row.stats.hitRate >= HIT_MIN &&
        row.stats.coverage >= V3_COVERAGE_MIN &&
        row.stats.picks >= MIN_TOTAL_PICKS
    );

    if (phase2Filtered.length) {
      return { evalResult: phase2Filtered.slice().sort(rank)[0], meetsCriteria: true };
    }
    if (phase2Computed.length) {
      return { evalResult: phase2Computed.slice().sort(rank)[0], meetsCriteria: false };
    }
    if (phase1Computed.length) {
      return { evalResult: phase1Computed.slice().sort(rank)[0], meetsCriteria: false };
    }
    return null;
  };

  const runScan = async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    cacheRef.current.clear();
    try {
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 2);

      const { data: fixtureRows, error: fixturesError } = await supabaseBrowser
        .from("fixtures")
        .select(
          `
          id,
          date_utc,
          season,
          status_short,
          competition_id,
          home:home_team_id ( id, name, logo ),
          away:away_team_id ( id, name, logo )
        `
        )
        .gte("date_utc", start.toISOString())
        .lt("date_utc", end.toISOString())
        .order("date_utc", { ascending: true });

      if (fixturesError) {
        throw new Error(fixturesError.message);
      }

      const fixtures = (fixtureRows ?? []) as FixtureLite[];
      if (!fixtures.length) {
        setLastScanInfo("Aucune rencontre aujourd'hui / demain.");
        setResults([]);
        return;
      }

      const teamIds = Array.from(
        new Set(
          fixtures
            .flatMap((fixture) => [fixture.home?.id, fixture.away?.id])
            .filter((id): id is number => Number.isFinite(id))
            .map((id) => Number(id))
        )
      );

      const {
        data: { user },
      } = await supabaseBrowser.auth.getUser();
      const userId = user?.id ?? ANON_USER_ID;

      const leagueIds = Array.from(
        new Set(
          fixtures
            .map((fixture) => fixture.competition_id)
            .filter((id): id is number => Number.isFinite(id))
            .map((id) => Number(id))
        )
      );

      const leagueSeasonMap = new Map<number, number>();
      fixtures.forEach((fixture) => {
        if (!Number.isFinite(fixture.competition_id)) return;
        const leagueId = Number(fixture.competition_id);
        const season = Number(fixture.season);
        if (!Number.isFinite(season) || season <= 0) return;
        const current = leagueSeasonMap.get(leagueId) ?? 0;
        if (season > current) leagueSeasonMap.set(leagueId, season);
      });

      const resolveSeason = (fixture: FixtureLite) => {
        const season = Number(fixture.season);
        if (Number.isFinite(season) && season > 0) return season;
        const leagueId = Number(fixture.competition_id);
        const fallback = leagueSeasonMap.get(leagueId);
        if (Number.isFinite(fallback) && (fallback ?? 0) > 0) return fallback as number;
        return CURRENT_SEASON;
      };

      const leagueFixturesMap = new Map<number, BacktestFixture[]>();
      await Promise.all(
        leagueIds.map(async (leagueId) => {
          const currentSeason = leagueSeasonMap.get(leagueId) ?? CURRENT_SEASON;
          const seasons = [currentSeason - 1, currentSeason];
          const seasonFixtures = await Promise.all(
            seasons.map((season) => getLeagueFixturesBySeason(leagueId, season))
          );
          const normalized = seasonFixtures
            .flat()
            .map(normalizeBacktestFixture)
            .filter((fixture) => Number.isFinite(fixture.id) && fixture.id > 0);
          leagueFixturesMap.set(leagueId, normalized);
        })
      );

      const competitionNameMap = new Map<number, string>();
      const competitionCountryMap = new Map<number, string>();
      const competitionLogoMap = new Map<number, string>();
      if (leagueIds.length) {
        try {
          const { data: competitions } = await supabaseBrowser
            .from("competitions")
            .select("id,name,country,logo")
            .in("id", leagueIds);
          (competitions ?? []).forEach((row: any) => {
            const id = Number(row?.id);
            if (!Number.isFinite(id)) return;
            const name = row?.name ? String(row.name) : `Competition ${id}`;
            competitionNameMap.set(id, name);
            if (row?.country) competitionCountryMap.set(id, String(row.country));
            if (row?.logo) competitionLogoMap.set(id, String(row.logo));
          });
        } catch {
          // Ignore API errors and fallback to generic labels
        }
      }

      const allowedCompetitionIds = new Set<number>(Array.from(competitionNameMap.keys()));
      const visibleFixtures = fixtures.filter((fixture) =>
        allowedCompetitionIds.has(Number(fixture.competition_id ?? 0))
      );

      const totalEvaluations = visibleFixtures.reduce((sum, fixture) => {
        const homeValid = Number.isFinite(fixture.home?.id) ? 1 : 0;
        const awayValid = Number.isFinite(fixture.away?.id) ? 1 : 0;
        return sum + homeValid + awayValid;
      }, 0);

      const localSettings = new Map<number, AlgoSettings>();
      teamIds.forEach((teamId) => {
        const local = loadLocalTeamSettings(teamId);
        if (local) localSettings.set(teamId, local);
      });

      let remoteSettings: TeamSettingsRow[] = [];
      if (teamIds.length) {
        const { data: settingsRows } = await supabaseBrowser
          .from("team_algo_settings")
          .select("team_id, settings")
          .eq("user_id", userId)
          .in("team_id", teamIds);
        remoteSettings =
          (settingsRows ?? []).map((row: any) => ({
            team_id: Number(row.team_id),
            settings: normalizeAlgoSettings(row.settings),
          })) ?? [];
      }

      const teamSettingsMap = new Map<number, AlgoSettings>();
      remoteSettings.forEach((row) => {
        if (Number.isFinite(row.team_id)) {
          teamSettingsMap.set(row.team_id, row.settings);
        }
      });
      localSettings.forEach((settings, teamId) => {
        teamSettingsMap.set(teamId, settings);
      });

      const bestSettingsCache = new Map<
        string,
        { evalResult: TeamEval; meetsCriteria: boolean } | null
      >();
      const settingsByRow = new Map<string, AlgoSettings>();
      const autoSavedTeams = new Set<number>();
      const output: ScanResult[] = [];

      visibleFixtures.forEach((fixture) => {
        const leagueId = Number(fixture.competition_id ?? 0);
        const leagueFixtures = leagueFixturesMap.get(leagueId) ?? [];
        if (!leagueFixtures.length) return;

        const matchInfo: NextMatchInfo = {
          fixtureId: fixture.id,
          dateUtc: fixture.date_utc ?? null,
          homeId: fixture.home?.id ?? null,
          awayId: fixture.away?.id ?? null,
        };

        ([
          { side: "home" as const, team: fixture.home },
          { side: "away" as const, team: fixture.away },
        ] as const).forEach((entry) => {
          const teamId = Number(entry.team?.id ?? 0);
          if (!Number.isFinite(teamId)) return;
          const cacheKey = `${leagueId}:${teamId}`;
          let cached = bestSettingsCache.get(cacheKey) ?? null;
          let evalResult = cached?.evalResult ?? null;
          let meetsCriteria = cached?.meetsCriteria ?? true;
          if (!bestSettingsCache.has(cacheKey)) {
            const best = findBestSettingsV3(leagueFixtures, teamId);
            evalResult = best?.evalResult ?? null;
            meetsCriteria = best?.meetsCriteria ?? true;
            bestSettingsCache.set(cacheKey, best);
          }
          if (!evalResult) return;

          if (!teamSettingsMap.has(teamId) && !autoSavedTeams.has(teamId)) {
            const resolvedSettings = evalResult.settings;
            teamSettingsMap.set(teamId, resolvedSettings);
            persistLocalTeamSettings(teamId, resolvedSettings);
            autoSavedTeams.add(teamId);
            void (async () => {
              try {
                await supabaseBrowser
                  .from("team_algo_settings")
                  .upsert(
                    {
                      user_id: userId,
                      team_id: teamId,
                      settings: resolvedSettings,
                      updated_at: new Date().toISOString(),
                    },
                    { onConflict: "user_id,team_id" }
                  );
              } catch {
                // Ignore persist errors for background auto-saves
              }
            })();
          }

          const pickResult = computeUpcomingPick(leagueFixtures, matchInfo, evalResult.settings);
          if (pickResult.status !== "pick" || !pickResult.pick) return;

          settingsByRow.set(`${fixture.id}:${teamId}`, evalResult.settings);
          output.push({
            fixtureId: fixture.id,
            competitionId: Number.isFinite(leagueId) ? leagueId : null,
            competitionName: competitionNameMap.get(leagueId) ?? null,
            competitionCountry: competitionCountryMap.get(leagueId) ?? null,
            competitionLogo: competitionLogoMap.get(leagueId) ?? null,
            season: resolveSeason(fixture),
            dateUtc: fixture.date_utc ?? null,
            homeId: fixture.home?.id ?? null,
            awayId: fixture.away?.id ?? null,
            homeName: fixture.home?.name ?? null,
            awayName: fixture.away?.name ?? null,
            homeLogo: fixture.home?.logo ?? null,
            awayLogo: fixture.away?.logo ?? null,
            teamId,
            teamName: entry.team?.name ?? null,
            side: entry.side,
            pick: pickResult.pick,
            probability: pickResult.probability ?? 0,
            hitRate: evalResult.stats.hitRate,
            coverage: evalResult.stats.coverage,
            picks: evalResult.stats.picks,
            evaluated: evalResult.stats.evaluated,
            threshold: evalResult.settings.threshold,
            odd: null,
            meetsOdds: false,
            meetsCriteria,
            isDiscouraged: false,
          });
        });
      });

      output.sort((a, b) => {
        if (b.hitRate !== a.hitRate) return b.hitRate - a.hitRate;
        if (b.coverage !== a.coverage) return b.coverage - a.coverage;
        return (b.probability ?? 0) - (a.probability ?? 0);
      });

      const seen = new Set<string>();
      const filteredOutput = output.filter((row) => {
        const key = `${row.fixtureId}:${row.pick}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const oddsCache = new Map<number, FixtureOdds | null>();
      const enrichedOutput = await Promise.all(
        filteredOutput.map(async (row) => {
          let odds = oddsCache.get(row.fixtureId) ?? null;
          if (!oddsCache.has(row.fixtureId)) {
            odds = await fetchFixtureOdds(row.fixtureId, row.competitionId, row.season);
            oddsCache.set(row.fixtureId, odds ?? null);
          }
          let pick = row.pick;
          let probability = row.probability;
          let oddValue = resolveOddForPick(pick, odds);

          const baseCriteria =
            row.hitRate >= HIT_MIN &&
            row.coverage >= V3_COVERAGE_MIN &&
            row.picks >= MIN_TOTAL_PICKS;

          if (
            baseCriteria &&
            (oddValue == null || oddValue < MIN_ODDS_RETRY)
          ) {
            const settings = settingsByRow.get(`${row.fixtureId}:${row.teamId}`);
            const leagueFixtures = leagueFixturesMap.get(row.competitionId ?? 0) ?? [];
            const excludeLine = extractPickLine(pick);
            if (settings && excludeLine && leagueFixtures.length) {
              const alt = computeUpcomingPick(
                leagueFixtures,
                {
                  fixtureId: row.fixtureId,
                  dateUtc: row.dateUtc ?? null,
                  homeId: row.homeId ?? null,
                  awayId: row.awayId ?? null,
                },
                settings,
                excludeLine
              );
              if (alt.status === "pick" && alt.pick) {
                const altOdd = resolveOddForPick(alt.pick, odds);
                const currentOdd = oddValue == null ? 0 : oddValue;
                if (altOdd != null && altOdd > currentOdd) {
                  pick = alt.pick;
                  probability = alt.probability ?? probability;
                  oddValue = altOdd;
                }
              }
            }
          }

          const meetsOdds = oddValue == null ? true : oddValue >= MIN_ODDS;
          const isDiscouraged =
            isDiscouragedCompetition(row.competitionCountry, row.competitionName) ||
            pick.trim() === "12";
          return {
            ...row,
            pick,
            probability,
            odd: oddValue,
            meetsOdds,
            meetsCriteria: row.meetsCriteria,
            isDiscouraged,
          };
        })
      );

      setResults(enrichedOutput);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            SCAN_STORAGE_KEY,
            JSON.stringify({
              results: enrichedOutput,
              lastScanInfo: `${visibleFixtures.length} match(s) analysé(s) • ${filteredOutput.length} match(s) retenu(s) • ${totalEvaluations} évaluations`,
            })
          );
        } catch {
          // Ignore storage errors
        }
      }
      setLastScanInfo(
        `${visibleFixtures.length} match(s) analysé(s) • ${filteredOutput.length} match(s) retenu(s) • ${totalEvaluations} évaluations`
      );
      void logAlgoEvent({
        eventType: "scan_daily",
        payload: {
          matchCount: visibleFixtures.length,
          retained: filteredOutput.length,
          totalEvaluations,
          timezone: timeZone,
          criteria: { hitMin: HIT_MIN, picksMin: V3_COVERAGE_MIN },
          autoSavedTeams: autoSavedTeams.size,
          results: filteredOutput.map((row) => ({
            fixtureId: row.fixtureId,
            teamId: row.teamId,
            pick: row.pick,
            probability: row.probability,
            hitRate: row.hitRate,
            coverage: row.coverage,
            picks: row.picks,
            evaluated: row.evaluated,
            threshold: row.threshold,
          })),
        },
      });
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors du scan.");
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (value?: string | null) => {
    if (!value) return "--:--";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "--:--";
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  };

  const formatDateLabel = (label: string) =>
    label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : label;

  return (
    <div className="w-full space-y-6">
      {loading ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative w-full max-w-sm rounded-xl border border-white/10 bg-white/10 backdrop-blur-md shadow-lg p-4">
            <div className="text-sm font-semibold text-white">Recherche en cours...</div>
            <div className="mt-3 h-2 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-400 via-emerald-400 to-lime-400 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-2 text-[11px] text-white/60">{progress}%</div>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center justify-center gap-2 overflow-x-auto no-scrollbar md:justify-start">
          <button
            type="button"
            onClick={() => setDayTab("today")}
            className={`px-3 py-1 rounded-lg text-sm transition whitespace-nowrap ${
              dayTab === "today"
                ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            Aujourd&apos;hui
          </button>
          <button
            type="button"
            onClick={() => setDayTab("tomorrow")}
            className={`px-3 py-1 rounded-lg text-sm transition whitespace-nowrap ${
              dayTab === "tomorrow"
                ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            Demain
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-white/70 self-center md:self-auto">
          <input
            type="checkbox"
            checked={hideDiscouraged}
            onChange={() => setHideDiscouraged((prev) => !prev)}
            className="accent-red-500"
          />
          <span>Masquer les choix déconseillés</span>
        </label>
        <button
          type="button"
          onClick={runScan}
          className="self-center md:self-auto px-3 py-1 rounded-lg text-sm bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white transition hover:from-green-400 hover:via-emerald-400 hover:to-lime-400"
          disabled={loading}
        >
          {loading ? "Scan en cours..." : "Lancer une recherche"}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {lastScanInfo ? (
        <div className="text-xs text-white/60">{lastScanInfo}</div>
      ) : null}

      {filteredResults.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 text-xs text-white/70">
          <div className="rounded-lg border border-pink-400/60 bg-pink-500/20 px-3 py-2 text-center text-pink-100">
            <div className="text-[10px] text-pink-200/70">Matchs</div>
            <div className="text-sm font-semibold">{summaryStats.count}</div>
          </div>
          <div className="rounded-lg border border-pink-400/60 bg-pink-500/20 px-3 py-2 text-center text-pink-100">
            <div className="text-[10px] text-pink-200/70">Hit moyen</div>
            <div className="text-sm font-semibold">
              {summaryStats.avgHit.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-lg border border-pink-400/60 bg-pink-500/20 px-3 py-2 text-center text-pink-100">
            <div className="text-[10px] text-pink-200/70">Cote moyenne</div>
            <div className="text-sm font-semibold">
              {summaryStats.avgOdd ? summaryStats.avgOdd.toFixed(2) : "-"}
            </div>
          </div>
        </div>
      ) : null}

      {results.length === 0 && !loading ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/60">
          Lancer une recherche pour trouver les meilleurs opportunités
        </div>
      ) : null}

      {results.length > 0 && filteredResults.length === 0 && !loading ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/60">
          Aucun match pour {dayTab === "today" ? formatDateLabel(todayLabel) : formatDateLabel(tomorrowLabel)}.
        </div>
      ) : null}

      {filteredResults.length > 0 ? (
        <div className="space-y-3 -mx-4 px-2 md:mx-0 md:px-0">
          {Array.from(
            filteredResults
              .reduce((map, row) => {
                const key = row.competitionId ? String(row.competitionId) : "unknown";
                if (!map.has(key)) {
                  map.set(key, {
                    id: key,
                    name: row.competitionName ?? `Competition ${row.competitionId ?? "-"}`,
                    country: row.competitionCountry ?? null,
                    logo: row.competitionLogo ?? null,
                    items: [] as ScanResult[],
                  });
                }
                map.get(key)!.items.push(row);
                return map;
              }, new Map<string, { id: string; name: string; country: string | null; logo: string | null; items: ScanResult[] }>())
              .values()
          )
            .sort((a, b) => {
              const idA = Number(a.id);
              const idB = Number(b.id);
              const favA = Number.isFinite(idA) ? favoriteCompetitionIds.has(idA) : false;
              const favB = Number.isFinite(idB) ? favoriteCompetitionIds.has(idB) : false;
              if (favA !== favB) return favA ? -1 : 1;
              return (a.name ?? "").localeCompare(b.name ?? "");
            })
            .map((group) => (
              <details
                key={group.id}
                className="group -mx-4 px-2 rounded-xl bg-transparent"
              >
                <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none rounded-xl border border-white/10 group-open:border-transparent text-[11px] list-none [&::-webkit-details-marker]:hidden">
                  {(() => {
                    const leagueId = Number(group.id);
                    if (!Number.isFinite(leagueId)) {
                      return <div className="w-6" aria-hidden />;
                    }
                    const isFavorite = favoriteCompetitionIds.has(leagueId);
                    return (
                      <button
                        type="button"
                        className={`shrink-0 rounded p-1 text-[18px] leading-none transition ${
                          isFavorite
                            ? "text-amber-300 hover:text-amber-200"
                            : "text-white/30 hover:text-white/60"
                        }`}
                        aria-label={
                          isFavorite
                            ? `Retirer ${group.name} des favoris`
                            : `Ajouter ${group.name} aux favoris`
                        }
                        aria-pressed={isFavorite}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleFavoriteCompetitionId(leagueId);
                        }}
                      >
                        <span aria-hidden="true">{isFavorite ? "★" : "☆"}</span>
                      </button>
                    );
                  })()}
                  {group.logo ? (
                    <img
                      src={group.logo}
                      alt={group.name ?? "Competition"}
                      className="w-8 h-8 rounded-md object-contain bg-white/10"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-md bg-white/10 border border-white/10" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate text-[12px]">
                      {[group.name, group.country].filter(Boolean).join(" - ") || "Compétition"}
                    </div>
                    <div className="text-[10px] text-white/60 flex items-center gap-2">
                      <span>{group.items.length} matchs</span>
                      {(() => {
                        const leagueId = Number(group.id);
                        if (!Number.isFinite(leagueId)) return null;
                        const stats = leagueHistoryStats[leagueId];
                        if (!stats?.total) return null;
                        return (
                          <>
                            <span className="text-white/40">•</span>
                            <span className="tabular-nums text-[11px] font-medium">
                              Hit rate {stats.hitRate.toFixed(1)}% • {stats.total} picks
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <span className="text-white/50 transition-transform group-open:rotate-180 animate-pulse group-open:animate-none motion-reduce:animate-none">
                    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden>
                      <path
                        d="M6 9l6 6 6-6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </summary>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {group.items.map((row) => {
                    const targetHref = row.homeId ? `/team/${row.homeId}` : null;
                    const hits = row.picks
                      ? Math.min(row.picks, Math.max(0, Math.round(row.hitRate * row.picks)))
                      : 0;
                    const hitPercent = row.picks ? (hits / row.picks) * 100 : 0;
                    const isBlacklisted = isDiscouragedCompetition(
                      row.competitionCountry,
                      row.competitionName
                    );
                    const isMarket12 = row.pick.trim() === "12";
                    const discouragedReason = [
                      isBlacklisted ? "compétition blacklistée" : null,
                      isMarket12 ? "marché 12" : null,
                    ]
                      .filter(Boolean)
                      .join(" • ");
                    const baseCriteria =
                      row.hitRate >= HIT_MIN &&
                      row.coverage >= V3_COVERAGE_MIN &&
                      row.picks >= MIN_TOTAL_PICKS;
                    const oddsOk =
                      row.meetsOdds ?? (row.odd != null ? row.odd >= MIN_ODDS : true);
                    const criteriaOk = baseCriteria && oddsOk;
                    const Wrapper = targetHref ? Link : "div";
                    return (
                      <Wrapper
                        key={`${row.fixtureId}-${row.teamId}-${row.pick}`}
                        href={targetHref ?? undefined}
                        className={`rounded-lg border border-white/10 bg-white/5 px-3 py-2 flex flex-col gap-2 ${
                          targetHref
                            ? "hover:border-white/30 hover:bg-white/10 transition cursor-pointer"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs text-white/60">
                          <span>{formatTime(row.dateUtc)}</span>
                        </div>
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {row.homeLogo ? (
                              <img
                                src={row.homeLogo}
                                alt={row.homeName ?? "Home"}
                                className="w-6 h-6 object-contain"
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-white/10" />
                            )}
                            <span className="text-sm font-semibold truncate">
                              {row.homeName ?? "Home"}
                            </span>
                          </div>
                          <div className="text-xs text-blue-300 text-center">VS</div>
                          <div className="flex items-center justify-end gap-2 min-w-0 text-right">
                            <span className="text-sm font-semibold truncate">
                              {row.awayName ?? "Away"}
                            </span>
                            {row.awayLogo ? (
                              <img
                                src={row.awayLogo}
                                alt={row.awayName ?? "Away"}
                                className="w-6 h-6 object-contain"
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-white/10" />
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span
                            className={`px-2 py-0.5 rounded-md border ${
                              criteriaOk
                                ? "border-pink-400/40 bg-pink-500/20 text-pink-200"
                                : "border-amber-300/50 bg-amber-400/20 text-amber-200"
                            }`}
                          >
                            Pick {row.pick}
                          </span>
                          {row.isDiscouraged ? (
                            <span
                              className="flex items-center gap-1 rounded-md border border-red-400/60 bg-red-500/20 px-2 py-0.5 text-red-200"
                              title={`Déconseillé : ${discouragedReason || "raison inconnue"}`}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width={14}
                                height={14}
                                aria-hidden
                              >
                                <path
                                  d="M6 6l12 12M18 6L6 18"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </span>
                          ) : null}
                          <span className="text-pink-200">
                            @{row.odd != null ? row.odd.toFixed(2) : "-"}
                          </span>
                          <span className="text-xs text-white/60 text-right ml-auto">
                            Hit {hitPercent.toFixed(1)}% • {hits}/{row.picks}
                          </span>
                        </div>
                      </Wrapper>
                    );
                  })}
                </div>
              </details>
            ))}
        </div>
      ) : null}

      <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70 blur-[2px] transition hover:blur-none">
        Critères : Hit ≥ 80% • Coverage ≥ 30% • Minimum 25 picks (sur 2 saisons) • Cote ≥ 1.18 •
        Réglages par équipe + variantes.
      </div>
    </div>
  );
}
