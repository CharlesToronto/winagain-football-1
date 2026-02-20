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
import {
  clearSearchBgScanCancel,
  readSearchBgScanState,
  isSearchBgScanCancelRequested,
  requestSearchBgScanCancel,
  SEARCH_BG_SCAN_EVENT,
  writeSearchBgScanState,
  type SearchBgScanState,
} from "@/lib/searchAlgoScanBackground";

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
const SCAN_TIMEZONE = "America/Toronto";
const SEARCH_CACHE_TABLE = "search_algo_picks_cache";
const SEARCH_RUNS_TABLE = "search_algo_scan_runs";
const DAY_MS = 24 * 60 * 60 * 1000;
const SCAN_RESET_MINUTES = 1;
const STALE_RUN_MINUTES = 20;
const BG_SCAN_HEARTBEAT_MS = 15_000;
const BG_SCAN_STALE_HEARTBEAT_MS = 120_000;
const NON_CRITICAL_QUERY_TIMEOUT_MS = 10_000;
const TEAM_SETTINGS_CHUNK_SIZE = 120;
const SEARCH_SESSION_CACHE_PREFIX = "winagain:search-algo:cache:";
const SETTINGS_RECALIBRATION_INTERVAL_MS = 7 * DAY_MS;
const SETTINGS_RECALIBRATION_RETRY_MS = DAY_MS;
const SETTINGS_PROMOTION_MIN_HIT_DELTA = 0.02;
const SETTINGS_PROMOTION_MIN_ROI_DELTA = 0.015;
const FAVORITE_COMPETITIONS_STORAGE_KEY = "winagain:fav_competition_ids";
const ANON_USER_ID = "00000000-0000-0000-0000-000000000000";
const SCAN_LOG_PREFIX = "[SearchAlgoScan]";

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
  updated_at: string | null;
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

type ScanRunRow = {
  scan_date: string;
  status: "running" | "done" | "error";
  started_at: string;
  finished_at: string | null;
  error: string | null;
  rows_count: number | null;
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

function resolveTeamLogoUrl(rawLogo: string | null | undefined, teamId?: number | null) {
  const normalized = String(rawLogo ?? "").trim();
  if (
    normalized &&
    normalized.toLowerCase() !== "null" &&
    normalized.toLowerCase() !== "undefined"
  ) {
    return normalized;
  }
  if (Number.isFinite(teamId) && (teamId ?? 0) > 0) {
    return `https://media.api-sports.io/football/teams/${teamId}.png`;
  }
  return null;
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
const withTimeout = <T,>(promise: PromiseLike<T>, timeoutMs: number) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
    Promise.resolve(promise)
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timer));
  });

async function fetchFixtureOdds(
  fixtureId: number,
  leagueId: number | null,
  season: number | null,
  signal?: AbortSignal
): Promise<FixtureOdds | null> {
  if (!Number.isFinite(fixtureId)) return null;
  if (signal?.aborted) {
    const err = new Error("Aborted");
    (err as any).name = "AbortError";
    throw err;
  }
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
        if (signal?.aborted) {
          const err = new Error("Aborted");
          (err as any).name = "AbortError";
          throw err;
        }
        const res = await fetch(`/api/odds/fixture?${params.toString()}`, { signal });
        if (res.ok) {
          const data = await res.json();
          return data?.odds ?? null;
        }
        if (res.status === 429 && attempt === 0) {
          if (signal?.aborted) {
            const err = new Error("Aborted");
            (err as any).name = "AbortError";
            throw err;
          }
          await sleep(600);
          continue;
        }
        return null;
      } catch (err: any) {
        if (err?.name === "AbortError" || signal?.aborted) {
          throw err;
        }
        if (attempt === 0) {
          if (signal?.aborted) {
            const abortErr = new Error("Aborted");
            (abortErr as any).name = "AbortError";
            throw abortErr;
          }
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

function isEvalMeetsCriteria(evalResult: TeamEval) {
  return (
    evalResult.stats.hitRate >= HIT_MIN &&
    evalResult.stats.coverage >= V3_COVERAGE_MIN &&
    evalResult.stats.picks >= MIN_TOTAL_PICKS
  );
}

function shouldPromoteSettings(current: TeamEval, candidate: TeamEval) {
  const currentMeets = isEvalMeetsCriteria(current);
  const candidateMeets = isEvalMeetsCriteria(candidate);
  if (!candidateMeets) return false;
  if (!currentMeets) return true;

  const hitDelta = candidate.stats.hitRate - current.stats.hitRate;
  const roiDelta = candidate.stats.roiScore - current.stats.roiScore;
  const picksDelta = candidate.stats.picks - current.stats.picks;
  if (hitDelta >= SETTINGS_PROMOTION_MIN_HIT_DELTA) return true;
  if (roiDelta >= SETTINGS_PROMOTION_MIN_ROI_DELTA) return true;
  if (hitDelta >= 0.01 && roiDelta >= 0 && picksDelta >= 5) return true;
  return false;
}

function parseIsoToMs(value: string | null | undefined) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function isSettingsRecalibrationDue(lastCheckedAt: string | null | undefined, meetsCriteria: boolean | null) {
  if (meetsCriteria == null) return true;
  const lastCheckedMs = parseIsoToMs(lastCheckedAt);
  if (lastCheckedMs == null) return true;
  const delayMs = meetsCriteria ? SETTINGS_RECALIBRATION_INTERVAL_MS : SETTINGS_RECALIBRATION_RETRY_MS;
  return Date.now() - lastCheckedMs >= delayMs;
}

function toErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.length) return msg;
  }
  return String(error);
}

export default function DailyScannerPanel() {
  const [results, setResults] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanInfoByDate, setScanInfoByDate] = useState<Record<string, string | null>>({});
  const [scanRunsByDate, setScanRunsByDate] = useState<Record<string, ScanRunRow | null>>({});
  const [dayTab, setDayTab] = useState<"today" | "tomorrow">("today");
  const [runningTarget, setRunningTarget] = useState<"today" | "tomorrow" | null>(null);
  const [hideDiscouraged, setHideDiscouraged] = useState(true);
  const [bgScanState, setBgScanState] = useState<SearchBgScanState | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [favoriteCompetitionIds, setFavoriteCompetitionIds] = useState<Set<number>>(
    () => new Set()
  );
  const [leagueHistoryStats, setLeagueHistoryStats] = useState<
    Record<number, { total: number; hits: number; hitRate: number }>
  >({});
  const cacheRef = useRef<Map<string, TeamEval>>(new Map());
  const cancelRequestedRef = useRef(false);
  const activeScanIdRef = useRef<string | null>(null);
  const oddsAbortControllerRef = useRef<AbortController | null>(null);
  const cacheUnsupportedColumnsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  useEffect(() => {
    const refresh = () => setBgScanState(readSearchBgScanState());
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (event.key.includes("winagain:search-algo:bg-scan")) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(SEARCH_BG_SCAN_EVENT, refresh);
    const t = setInterval(() => setClockMs(Date.now()), 10_000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SEARCH_BG_SCAN_EVENT, refresh);
      clearInterval(t);
    };
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
        "Bulgaria|||First League",
        "Belgium|||Jupiler Pro League",
        "Greece|||Super League 1",
        "Hungary|||NB I",
        "Scotland|||Football League - Highland League",
        "Scotland|||League One",
        "Belgium|||Challenger Pro League",
        "Hungary|||NB II",
        "Italy|||Serie C - Girone A",
        "Romania|||Liga I",
        "Serbia|||Super Liga",
      ]),
    []
  );

  const timeZone = SCAN_TIMEZONE;

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

  const getTzParts = (date: Date) => {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
    };
  };

  const getTimezoneOffset = (date: Date) => {
    const parts = getTzParts(date);
    const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return (asUTC - date.getTime()) / 60000;
  };

  const getUtcRangeForDayOffset = (offsetDays: number, baseMs = Date.now()) => {
    const base = new Date(baseMs + offsetDays * DAY_MS);
    const parts = getTzParts(base);
    const midnightUTC = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
    const offset = getTimezoneOffset(new Date(midnightUTC));
    const start = new Date(midnightUTC - offset * 60000);
    const end = new Date(start.getTime() + DAY_MS);
    const dateKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    return { start, end, dateKey };
  };

  const dayAnchor = toDateKey(new Date());
  const todayRange = useMemo(() => getUtcRangeForDayOffset(0), [dayAnchor]);
  const tomorrowRange = useMemo(() => getUtcRangeForDayOffset(1), [dayAnchor]);

  const todayLabel = useMemo(() => {
    return new Date(todayRange.start).toLocaleDateString("fr-FR", {
      timeZone,
      weekday: "long",
      day: "2-digit",
      month: "short",
    });
  }, [todayRange.start, timeZone]);

  const tomorrowLabel = useMemo(() => {
    return new Date(tomorrowRange.start).toLocaleDateString("fr-FR", {
      timeZone,
      weekday: "long",
      day: "2-digit",
      month: "short",
    });
  }, [tomorrowRange.start, timeZone]);

  const todayKey = todayRange.dateKey;
  const tomorrowKey = tomorrowRange.dateKey;

  const activeDateKey = dayTab === "today" ? todayKey : tomorrowKey;
  const lastScanInfo = scanInfoByDate[activeDateKey] ?? null;
  const todayRun = scanRunsByDate[todayKey] ?? null;
  const tomorrowRun = scanRunsByDate[tomorrowKey] ?? null;
  const hasFreshBgHeartbeatForDate = (
    dateKey: string,
    state: SearchBgScanState | null = bgScanState,
    nowMsOverride: number = clockMs
  ) => {
    if (!state || state.status !== "running" || state.scanDate !== dateKey) return false;
    const updatedAtMs = new Date(state.updatedAt).getTime();
    if (!Number.isFinite(updatedAtMs)) return false;
    return nowMsOverride - updatedAtMs <= BG_SCAN_STALE_HEARTBEAT_MS;
  };
  const cacheCountByDate = useMemo(() => {
    const counts: Record<string, number> = {};
    results.forEach((row) => {
      if (!row.dateUtc) return;
      const date = new Date(row.dateUtc);
      if (!Number.isFinite(date.getTime())) return;
      const key = toDateKey(date);
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }, [results]);
  const isRunStale = (run: ScanRunRow | null) => {
    if (!run?.started_at) return true;
    const date = new Date(run.started_at);
    if (!Number.isFinite(date.getTime())) return true;
    return Date.now() - date.getTime() > STALE_RUN_MINUTES * 60_000;
  };
  const todayCachedCount = cacheCountByDate[todayKey] ?? 0;
  const tomorrowCachedCount = cacheCountByDate[tomorrowKey] ?? 0;
  const todayHasCache = todayCachedCount > 0;
  const tomorrowHasCache = tomorrowCachedCount > 0;
  const todayIsRunning = Boolean(
    todayRun?.status === "running" &&
      !isRunStale(todayRun) &&
      (hasFreshBgHeartbeatForDate(todayKey) || runningTarget === "today")
  );
  const tomorrowIsRunning = Boolean(
    tomorrowRun?.status === "running" &&
      !isRunStale(tomorrowRun) &&
      (hasFreshBgHeartbeatForDate(tomorrowKey) || runningTarget === "tomorrow")
  );
  const todayDoneWithCache = todayRun?.status === "done" && todayHasCache;
  const tomorrowDoneWithCache = tomorrowRun?.status === "done" && tomorrowHasCache;
  const activeRawResults = useMemo(() => {
    return results.filter((row) => {
      if (!row.dateUtc) return false;
      const date = new Date(row.dateUtc);
      if (!Number.isFinite(date.getTime())) return false;
      return toDateKey(date) === activeDateKey;
    });
  }, [results, activeDateKey]);

  const isInResetWindow = (() => {
    const parts = getTzParts(new Date());
    if (!Number.isFinite(parts.hour) || !Number.isFinite(parts.minute)) return false;
    return parts.hour === 0 && parts.minute < SCAN_RESET_MINUTES;
  })();

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

  const withoutDateKey = (list: ScanResult[], dateKey: string) => {
    return list.filter((row) => {
      if (!row.dateUtc) return true;
      const date = new Date(row.dateUtc);
      if (!Number.isFinite(date.getTime())) return true;
      return toDateKey(date) !== dateKey;
    });
  };

  const normalizeCacheRow = (row: any): ScanResult => ({
    fixtureId: Number(row?.fixture_id ?? 0),
    competitionId: row?.league_id != null ? Number(row.league_id) : null,
    competitionName: row?.competition_name ?? null,
    competitionCountry: row?.competition_country ?? null,
    competitionLogo: row?.competition_logo ?? null,
    season: row?.season != null ? Number(row.season) : null,
    dateUtc: row?.fixture_date_utc ?? null,
    homeId: row?.home_id != null ? Number(row.home_id) : null,
    awayId: row?.away_id != null ? Number(row.away_id) : null,
    homeName: row?.home_name ?? null,
    awayName: row?.away_name ?? null,
    homeLogo: row?.home_logo ?? null,
    awayLogo: row?.away_logo ?? null,
    teamId: row?.team_id != null ? Number(row.team_id) : 0,
    teamName: row?.team_name ?? null,
    side: row?.side === "away" ? "away" : "home",
    pick: String(row?.pick ?? ""),
    probability: Number(row?.probability ?? 0),
    hitRate: Number(row?.hit_rate ?? 0),
    coverage: Number(row?.coverage ?? 0),
    picks: Number(row?.picks_count ?? 0),
    evaluated: Number(row?.evaluated_count ?? 0),
    threshold: Number(row?.threshold ?? 0),
    odd: row?.odd != null ? Number(row.odd) : null,
    meetsOdds: row?.meets_odds ?? (row?.odd != null ? Number(row.odd) >= MIN_ODDS : true),
    meetsCriteria: Boolean(row?.meets_criteria),
    isDiscouraged: Boolean(row?.is_discouraged),
  });

  const cancelScan = () => {
    cancelRequestedRef.current = true;
    const scanId = activeScanIdRef.current;
    if (scanId) requestSearchBgScanCancel(scanId);
    oddsAbortControllerRef.current?.abort();
  };

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
    const restoreFromSession = (dateKey: string) => {
      try {
        const raw = window.sessionStorage.getItem(`${SEARCH_SESSION_CACHE_PREFIX}${dateKey}`);
        if (!raw) return;
        const parsed = JSON.parse(raw) as {
          results?: ScanResult[];
          lastScanInfo?: string | null;
        };
        if (Array.isArray(parsed.results) && parsed.results.length) {
          setResults((prev) => [...withoutDateKey(prev, dateKey), ...parsed.results!]);
        }
        if (parsed.lastScanInfo) {
          setScanInfoByDate((prev) => ({ ...prev, [dateKey]: parsed.lastScanInfo ?? null }));
        }
      } catch {
        // Ignore restore errors
      }
    };

    restoreFromSession(todayKey);
    restoreFromSession(tomorrowKey);
  }, [todayKey, tomorrowKey]);

  useEffect(() => {
    let active = true;

    const loadRunsAndCache = async () => {
      const [todayRunRes, tomorrowRunRes] = await Promise.all([
        supabaseBrowser
          .from(SEARCH_RUNS_TABLE)
          .select("scan_date,status,started_at,finished_at,error,rows_count")
          .eq("scan_date", todayKey)
          .maybeSingle(),
        supabaseBrowser
          .from(SEARCH_RUNS_TABLE)
          .select("scan_date,status,started_at,finished_at,error,rows_count")
          .eq("scan_date", tomorrowKey)
          .maybeSingle(),
      ]);

      if (!active) return;

      const todayRun = (todayRunRes.data as ScanRunRow) ?? null;
      const tomorrowRun = (tomorrowRunRes.data as ScanRunRow) ?? null;

      setScanRunsByDate((prev) => ({
        ...prev,
        [todayKey]: todayRun,
        [tomorrowKey]: tomorrowRun,
      }));

      setScanInfoByDate((prev) => ({
        ...prev,
        ...(todayRun?.status === "error" && todayRun.error
          ? { [todayKey]: `Erreur: ${todayRun.error}` }
          : {}),
        ...(tomorrowRun?.status === "error" && tomorrowRun.error
          ? { [tomorrowKey]: `Erreur: ${tomorrowRun.error}` }
          : {}),
      }));

      const [todayCacheRes, tomorrowCacheRes] = await Promise.all([
        supabaseBrowser.from(SEARCH_CACHE_TABLE).select("*").eq("scan_date", todayKey),
        supabaseBrowser.from(SEARCH_CACHE_TABLE).select("*").eq("scan_date", tomorrowKey),
      ]);

      if (!active) return;

      const todayCached = (todayCacheRes.data ?? []).map(normalizeCacheRow).filter((row) => row.fixtureId);
      const tomorrowCached = (tomorrowCacheRes.data ?? [])
        .map(normalizeCacheRow)
        .filter((row) => row.fixtureId);

      setResults((prev) => {
        let next = prev;
        if (todayCached.length) {
          next = withoutDateKey(next, todayKey);
          next = [...next, ...todayCached];
        }
        if (tomorrowCached.length) {
          next = withoutDateKey(next, tomorrowKey);
          next = [...next, ...tomorrowCached];
        }
        return next;
      });

      setScanInfoByDate((prev) => ({
        ...prev,
        ...(todayCached.length ? { [todayKey]: `${todayCached.length} match(s) en cache` } : {}),
        ...(tomorrowCached.length ? { [tomorrowKey]: `${tomorrowCached.length} match(s) en cache` } : {}),
      }));
    };

    loadRunsAndCache();

    return () => {
      active = false;
    };
  }, [todayKey, tomorrowKey]);

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

  const refreshRunForDateKey = async (dateKey: string) => {
    const { data, error } = await supabaseBrowser
      .from(SEARCH_RUNS_TABLE)
      .select("scan_date,status,started_at,finished_at,error,rows_count")
      .eq("scan_date", dateKey)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    const run = (data as ScanRunRow) ?? null;
    setScanRunsByDate((prev) => ({ ...prev, [dateKey]: run }));
    return run;
  };

  const refreshCacheForDateKey = async (dateKey: string) => {
    const { data, error } = await supabaseBrowser
      .from(SEARCH_CACHE_TABLE)
      .select("*")
      .eq("scan_date", dateKey);

    if (error) {
      throw new Error(error.message);
    }

    const cached = (data ?? []).map(normalizeCacheRow).filter((row) => row.fixtureId);
    setResults((prev) => [...withoutDateKey(prev, dateKey), ...cached]);
    setScanInfoByDate((prev) => ({
      ...prev,
      [dateKey]: `${cached.length} match(s) en cache`,
    }));
    return cached;
  };

  const writeCacheForDateKey = async (dateKey: string, rows: ScanResult[]) => {
    const unsupported = cacheUnsupportedColumnsRef.current;
    const extractMissingColumn = (value: any) => {
      const message = String(value?.message ?? "");
      const match = message.match(/Could not find the '([^']+)' column/i);
      if (match) return match[1];
      const match2 = message.match(/column ([a-zA-Z0-9_]+) does not exist/i);
      if (match2) return match2[1];
      return null;
    };

	    const buildRow = (row: ScanResult) => {
	      const base: Record<string, any> = {
	        scan_date: dateKey,
	        fixture_id: row.fixtureId,
	        league_id: row.competitionId,
	        competition_name: row.competitionName,
	        competition_country: row.competitionCountry,
	        competition_logo: row.competitionLogo,
	        season: row.season,
	        fixture_date_utc: row.dateUtc,
	        home_id: row.homeId,
	        away_id: row.awayId,
	        home_name: row.homeName,
	        away_name: row.awayName,
	        team_id: row.teamId,
	        side: row.side,
	        pick: row.pick,
	        probability: row.probability,
	        hit_rate: row.hitRate,
	        coverage: row.coverage,
        picks_count: row.picks,
        evaluated_count: row.evaluated,
        threshold: row.threshold,
        odd: row.odd,
        meets_odds: row.meetsOdds,
        meets_criteria: row.meetsCriteria,
        is_discouraged: row.isDiscouraged,
      };
      unsupported.forEach((col) => {
        delete base[col];
      });
      return base;
    };

    const buildPayload = () => rows.map(buildRow);
    let payload = buildPayload();
    const chunkSize = 500;
    const insertAll = async (list: any[]) => {
      for (let i = 0; i < list.length; i += chunkSize) {
        const chunk = list.slice(i, i + chunkSize);
        const { error: insertError } = await supabaseBrowser
          .from(SEARCH_CACHE_TABLE)
          .insert(chunk);
        if (insertError) {
          throw insertError;
        }
      }
    };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { error: deleteError } = await supabaseBrowser
        .from(SEARCH_CACHE_TABLE)
        .delete()
        .eq("scan_date", dateKey);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      if (!payload.length) return;

      try {
        await insertAll(payload);
        return;
      } catch (err: any) {
        const missing = extractMissingColumn(err);
        if (!missing || unsupported.has(missing)) {
          throw new Error(err?.message ?? "Erreur lors de l'insertion du cache.");
        }
        unsupported.add(missing);
        payload = buildPayload();
      }
    }

    throw new Error("Schéma Supabase incompatible pour search_algo_picks_cache.");
  };

  const runScanForDay = async (target: "today" | "tomorrow") => {
    const range = getUtcRangeForDayOffset(target === "today" ? 0 : 1);
    const dateKey = range.dateKey;
    const start = range.start;
    const end = range.end;
    const logContext = `${SCAN_LOG_PREFIX}[${target}:${dateKey}]`;
    const logInfo = (message: string, details?: Record<string, unknown>) => {
      if (details) {
        console.info(`${logContext} ${message}`, details);
      } else {
        console.info(`${logContext} ${message}`);
      }
    };
    const logWarn = (message: string, details?: Record<string, unknown>) => {
      if (details) {
        console.warn(`${logContext} ${message}`, details);
      } else {
        console.warn(`${logContext} ${message}`);
      }
    };
    const logError = (message: string, details?: Record<string, unknown>) => {
      if (details) {
        console.error(`${logContext} ${message}`, details);
      } else {
        console.error(`${logContext} ${message}`);
      }
    };
    const runStartMs = Date.now();

    const safe = (fn: () => void) => {
      if (!mountedRef.current) return;
      fn();
    };

    safe(() => setDayTab(target));
    safe(() => setError(null));
    logInfo("Scan requested", {
      dateKey,
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
    });

    if (isInResetWindow) {
      safe(() =>
        setScanInfoByDate((prev) => ({
          ...prev,
          [dateKey]: "Indisponible entre 00:00 et 00:01 (Toronto).",
        }))
      );
      logWarn("Blocked by reset window");
      return;
    }

    const startedAt = new Date().toISOString();
    const isStaleRun = (run: ScanRunRow) => {
      const date = new Date(run.started_at);
      if (!Number.isFinite(date.getTime())) return true;
      return Date.now() - date.getTime() > STALE_RUN_MINUTES * 60_000;
    };

    const baseRun: ScanRunRow = {
      scan_date: dateKey,
      status: "running",
      started_at: startedAt,
      finished_at: null,
      error: null,
      rows_count: null,
    };

    safe(() => setRunningTarget(target));
    safe(() => setLoading(true));
    cacheRef.current.clear();
    cancelRequestedRef.current = false;
    oddsAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    oddsAbortControllerRef.current = abortController;

    let scanId: string | null = null;
    let bgState: SearchBgScanState | null = null;
    let cancelWatcher: ReturnType<typeof setInterval> | null = null;
    let heartbeatWatcher: ReturnType<typeof setInterval> | null = null;

    const updateBgState = (patch: Partial<SearchBgScanState>) => {
      if (!bgState) return;
      bgState = {
        ...bgState,
        ...patch,
        updatedAt: new Date().toISOString(),
        progress:
          patch.progress == null
            ? bgState.progress
            : clamp(Number(patch.progress), 0, 100),
      };
      writeSearchBgScanState(bgState);
    };

    const throwIfCancelled = () => {
      if (!scanId) return;
      if (cancelRequestedRef.current) {
        const err = new Error("Recherche annulée.");
        (err as any).name = "AbortError";
        throw err;
      }
      if (abortController.signal.aborted) {
        const err = new Error("Recherche annulée.");
        (err as any).name = "AbortError";
        throw err;
      }
      if (isSearchBgScanCancelRequested(scanId)) {
        cancelRequestedRef.current = true;
        abortController.abort();
        const err = new Error("Recherche annulée.");
        (err as any).name = "AbortError";
        throw err;
      }
    };
    try {
      logInfo("Acquiring scan lock row");
      const { error: insertError } = await supabaseBrowser.from(SEARCH_RUNS_TABLE).insert({
        scan_date: dateKey,
        status: "running",
        started_at: startedAt,
      });

      if (insertError) {
        logWarn("Insert lock failed", {
          code: insertError.code ?? null,
          message: insertError.message ?? null,
        });
        if (insertError.code !== "23505") {
          throw new Error(insertError.message);
        }

        const existing = await refreshRunForDateKey(dateKey);
        logInfo("Existing scan row found", {
          status: existing?.status ?? null,
          startedAt: existing?.started_at ?? null,
          finishedAt: existing?.finished_at ?? null,
        });
        if (existing?.status === "done") {
          const cached = await refreshCacheForDateKey(dateKey);
          logInfo("Loaded existing done cache", { rows: cached.length });
          logInfo("Manual relaunch requested; continuing with a fresh run");
        }
        const existingHasFreshBgHeartbeat =
          existing?.status === "running"
            ? hasFreshBgHeartbeatForDate(dateKey, readSearchBgScanState(), Date.now())
            : false;
        if (existing?.status === "running" && !isStaleRun(existing) && existingHasFreshBgHeartbeat) {
          logInfo("Abort new run because another run is active");
          safe(() =>
            setScanInfoByDate((prev) => ({
              ...prev,
              [dateKey]: `Scan déjà en cours (démarré à ${formatTime(existing.started_at)}).`,
            }))
          );
          return;
        }

        const { error: updateError } = await supabaseBrowser
          .from(SEARCH_RUNS_TABLE)
          .update({
            status: "running",
            started_at: startedAt,
            finished_at: null,
            error: null,
            rows_count: null,
          })
          .eq("scan_date", dateKey);

        if (updateError) {
          throw new Error(updateError.message);
        }
        logInfo("Reclaimed stale scan row");
      }

      scanId = `${dateKey}:${startedAt}:${Math.random().toString(16).slice(2)}`;
      logInfo("Scan lock acquired", { scanId });
      activeScanIdRef.current = scanId;
      bgState = {
        scanId,
        scanDate: dateKey,
        target,
        status: "running",
        startedAt,
        updatedAt: startedAt,
        progress: 5,
        message: "Scan en cours...",
        rowsCount: null,
        analysisProcessed: null,
        analysisTotal: null,
      };
      writeSearchBgScanState(bgState);
      heartbeatWatcher = setInterval(() => {
        updateBgState({});
      }, BG_SCAN_HEARTBEAT_MS);
      cancelWatcher = setInterval(() => {
        if (!scanId) return;
        if (isSearchBgScanCancelRequested(scanId)) {
          cancelRequestedRef.current = true;
          abortController.abort();
        }
      }, 500);

      safe(() => setScanRunsByDate((prev) => ({ ...prev, [dateKey]: baseRun })));
      safe(() => setScanInfoByDate((prev) => ({ ...prev, [dateKey]: "Scan en cours..." })));

      updateBgState({ progress: 10, message: "Chargement des rencontres..." });
      throwIfCancelled();

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
      logInfo("Fixtures loaded", { fixtures: fixtures.length });
      if (!fixtures.length) {
        const finishedAt = new Date().toISOString();
        updateBgState({
          status: "done",
          progress: 100,
          message: "Aucune rencontre sur cette période.",
          rowsCount: 0,
          analysisProcessed: 0,
          analysisTotal: 0,
        });
        safe(() =>
          setScanInfoByDate((prev) => ({
            ...prev,
            [dateKey]: "Aucune rencontre sur cette période.",
          }))
        );
        safe(() =>
          setScanRunsByDate((prev) => ({
            ...prev,
            [dateKey]: {
              ...baseRun,
              status: "done",
              finished_at: finishedAt,
              rows_count: 0,
            },
          }))
        );

        await writeCacheForDateKey(dateKey, []);
        await supabaseBrowser
          .from(SEARCH_RUNS_TABLE)
          .update({
            status: "done",
            finished_at: finishedAt,
            error: null,
            rows_count: 0,
          })
          .eq("scan_date", dateKey);
        if (scanId) clearSearchBgScanCancel(scanId);
        logInfo("No fixture for selected day, finished");
        return;
      }

      updateBgState({
        progress: 15,
        message: `${fixtures.length} rencontre(s) chargée(s).`,
      });
      throwIfCancelled();

      const {
        data: { user },
      } = await supabaseBrowser.auth.getUser();
      const userId = user?.id ?? ANON_USER_ID;
      logInfo("Resolved user context", {
        userId,
        isAnonymous: !user?.id,
      });

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
      updateBgState({
        progress: 25,
        message: "Chargement de l'historique des ligues...",
      });
      throwIfCancelled();
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
      logInfo("League history loaded", {
        leagues: leagueIds.length,
      });
      updateBgState({ progress: 35, message: "Historique chargé. Préparation..." });
      throwIfCancelled();

      const competitionNameMap = new Map<number, string>();
      const competitionCountryMap = new Map<number, string>();
      const competitionLogoMap = new Map<number, string>();
      if (leagueIds.length) {
        updateBgState({ progress: 36, message: "Chargement des compétitions..." });
        try {
          const { data: competitions } = await withTimeout<any>(
            supabaseBrowser
              .from("competitions")
              .select("id,name,country,logo")
              .in("id", leagueIds),
            NON_CRITICAL_QUERY_TIMEOUT_MS
          );
          (competitions ?? []).forEach((row: any) => {
            const id = Number(row?.id);
            if (!Number.isFinite(id)) return;
            const name = row?.name ? String(row.name) : `Competition ${id}`;
            competitionNameMap.set(id, name);
            if (row?.country) competitionCountryMap.set(id, String(row.country));
            if (row?.logo) competitionLogoMap.set(id, String(row.logo));
          });
          logInfo("Competition metadata loaded", {
            requested: leagueIds.length,
            loaded: competitionNameMap.size,
          });
        } catch {
          // Ignore non-critical API errors/timeouts and fallback to generic labels
          logWarn("Competition metadata fetch failed, fallback labels will be used");
        }
      }

      const visibleFixtures = fixtures.filter((fixture) =>
        Number.isFinite(fixture.competition_id)
      );
      const teamIds = Array.from(
        new Set(
          visibleFixtures
            .flatMap((fixture) => [fixture.home?.id, fixture.away?.id])
            .filter((id): id is number => Number.isFinite(id))
            .map((id) => Number(id))
        )
      );

      const totalEvaluations = visibleFixtures.reduce((sum, fixture) => {
        const homeValid = Number.isFinite(fixture.home?.id) ? 1 : 0;
        const awayValid = Number.isFinite(fixture.away?.id) ? 1 : 0;
        return sum + homeValid + awayValid;
      }, 0);
      logInfo("Prepared scan entities", {
        visibleFixtures: visibleFixtures.length,
        teams: teamIds.length,
        evaluations: totalEvaluations,
      });

      let remoteSettings: TeamSettingsRow[] = [];
      if (teamIds.length) {
        updateBgState({ progress: 37, message: "Chargement des réglages équipes..." });
        const totalChunks = Math.ceil(teamIds.length / TEAM_SETTINGS_CHUNK_SIZE);
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
          throwIfCancelled();
          const ids = teamIds.slice(
            chunkIndex * TEAM_SETTINGS_CHUNK_SIZE,
            (chunkIndex + 1) * TEAM_SETTINGS_CHUNK_SIZE
          );
          if (!ids.length) continue;
          try {
            const { data: settingsRows } = await withTimeout<any>(
              supabaseBrowser
                .from("team_algo_settings")
                .select("team_id, settings, updated_at")
                .eq("user_id", userId)
                .in("team_id", ids),
              NON_CRITICAL_QUERY_TIMEOUT_MS
            );
            (settingsRows ?? []).forEach((row: any) => {
              remoteSettings.push({
                team_id: Number(row.team_id),
                settings: normalizeAlgoSettings(row.settings),
                updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
              });
            });
          } catch {
            // Ignore non-critical API errors/timeouts and continue with auto settings
            logWarn("Team settings chunk fetch failed", {
              chunk: chunkIndex + 1,
              totalChunks,
              chunkSize: ids.length,
            });
          }
          if (totalChunks > 1) {
            const pct = 37 + ((chunkIndex + 1) / totalChunks) * 2;
            updateBgState({
              progress: pct,
              message: `Réglages équipes ${chunkIndex + 1}/${totalChunks}...`,
            });
          }
        }
      }
      logInfo("Team settings loaded from Supabase", {
        rows: remoteSettings.length,
      });

      const teamSettingsMap = new Map<number, AlgoSettings>();
      const teamSettingsUpdatedAtMap = new Map<number, string | null>();
      remoteSettings.forEach((row) => {
        if (Number.isFinite(row.team_id)) {
          teamSettingsMap.set(row.team_id, row.settings);
          teamSettingsUpdatedAtMap.set(row.team_id, row.updated_at ?? null);
        }
      });

      const bestSettingsCache = new Map<
        string,
        { evalResult: TeamEval; meetsCriteria: boolean } | null
      >();
      const settingsByRow = new Map<string, AlgoSettings>();
      const autoSavedTeams = new Set<number>();
      const output: ScanResult[] = [];
      const settingsDecisionStats = {
        usedSaved: 0,
        heavyChecks: 0,
        bootstrapped: 0,
        promoted: 0,
        kept: 0,
        fallbackNone: 0,
        persisted: 0,
        persistFailed: 0,
      };
      const persistTeamSettings = (teamId: number, settings: AlgoSettings, reason: string) => {
        teamSettingsMap.set(teamId, settings);
        const updatedAt = new Date().toISOString();
        teamSettingsUpdatedAtMap.set(teamId, updatedAt);
        if (autoSavedTeams.has(teamId)) return;
        autoSavedTeams.add(teamId);
        settingsDecisionStats.persisted += 1;
        void (async () => {
          try {
            await supabaseBrowser
              .from("team_algo_settings")
              .upsert(
                {
                  user_id: userId,
                  team_id: teamId,
                  settings,
                  updated_at: updatedAt,
                },
                { onConflict: "user_id,team_id" }
              );
            logInfo("Team settings upserted", { teamId, reason });
          } catch {
            // Ignore persist errors for background auto-saves
            settingsDecisionStats.persistFailed += 1;
            logWarn("Team settings upsert failed", { teamId, reason });
          }
        })();
      };

      const analysisProgressStart = 40;
      const analysisProgressEnd = 60;
      const analysisTotalMatches = visibleFixtures.length;
      const analysisTotalSafe = Math.max(1, analysisTotalMatches);
      let analysisProcessedMatches = 0;
      let lastAnalysisUiUpdateMs = 0;
      const maybeUpdateAnalysisUi = async (force = false) => {
        const nowMs = Date.now();
        if (!force && nowMs - lastAnalysisUiUpdateMs < 3_000) return;
        lastAnalysisUiUpdateMs = nowMs;
        const pct =
          analysisProgressStart +
          (analysisProcessedMatches / analysisTotalSafe) *
            (analysisProgressEnd - analysisProgressStart);
        updateBgState({
          progress: pct,
          message: `${analysisProcessedMatches}/${analysisTotalMatches} match(s) analysé(s)...`,
          analysisProcessed: analysisProcessedMatches,
          analysisTotal: analysisTotalMatches,
        });
        await sleep(0);
      };

      updateBgState({
        progress: analysisProgressStart,
        message: `0/${analysisTotalMatches} match(s) analysé(s)...`,
        analysisProcessed: 0,
        analysisTotal: analysisTotalMatches,
      });
      logInfo("Analysis started", {
        matches: analysisTotalMatches,
        evaluations: totalEvaluations,
      });
      throwIfCancelled();

      for (const fixture of visibleFixtures) {
        throwIfCancelled();
        analysisProcessedMatches += 1;
        if (
          analysisProcessedMatches === analysisTotalMatches ||
          analysisProcessedMatches % 25 === 0
        ) {
          logInfo("Analysis progress", {
            processed: analysisProcessedMatches,
            total: analysisTotalMatches,
          });
        }

        const leagueId = Number(fixture.competition_id ?? 0);
        const leagueFixtures = leagueFixturesMap.get(leagueId) ?? [];
        if (!leagueFixtures.length) {
          await maybeUpdateAnalysisUi();
          continue;
        }

        const matchInfo: NextMatchInfo = {
          fixtureId: fixture.id,
          dateUtc: fixture.date_utc ?? null,
          homeId: fixture.home?.id ?? null,
          awayId: fixture.away?.id ?? null,
        };

        const entries = [
          { side: "home" as const, team: fixture.home },
          { side: "away" as const, team: fixture.away },
        ] as const;

        for (const entry of entries) {
          const teamId = Number(entry.team?.id ?? 0);
          if (!Number.isFinite(teamId)) continue;

          const cacheKey = `${leagueId}:${teamId}`;
          let cached = bestSettingsCache.get(cacheKey) ?? null;
          let evalResult = cached?.evalResult ?? null;
          let meetsCriteria = cached?.meetsCriteria ?? true;
          if (!bestSettingsCache.has(cacheKey)) {
            const existingSettings = teamSettingsMap.get(teamId) ?? null;
            const existingEval = existingSettings
              ? computeTeamEval(leagueFixtures, teamId, existingSettings)
              : null;
            let selected =
              existingEval == null
                ? null
                : {
                    evalResult: existingEval,
                    meetsCriteria: isEvalMeetsCriteria(existingEval),
                  };
            if (selected) settingsDecisionStats.usedSaved += 1;
            const existingUpdatedAt = teamSettingsUpdatedAtMap.get(teamId) ?? null;
            const dueRecalibration =
              leagueId > 0
                ? isSettingsRecalibrationDue(existingUpdatedAt, selected?.meetsCriteria ?? null)
                : selected == null;
            const shouldRunHeavyCheck = selected == null || dueRecalibration;

            if (shouldRunHeavyCheck) {
              settingsDecisionStats.heavyChecks += 1;
              const best = findBestSettingsV3(leagueFixtures, teamId);
              if (best?.evalResult) {
                if (!selected) {
                  selected = {
                    evalResult: best.evalResult,
                    meetsCriteria: best.meetsCriteria,
                  };
                  settingsDecisionStats.bootstrapped += 1;
                  persistTeamSettings(teamId, best.evalResult.settings, "bootstrap");
                } else if (shouldPromoteSettings(selected.evalResult, best.evalResult)) {
                  selected = {
                    evalResult: best.evalResult,
                    meetsCriteria: best.meetsCriteria,
                  };
                  settingsDecisionStats.promoted += 1;
                  persistTeamSettings(teamId, best.evalResult.settings, "promoted");
                } else if (selected) {
                  settingsDecisionStats.kept += 1;
                  persistTeamSettings(teamId, selected.evalResult.settings, "rechecked-kept");
                }
              } else if (selected) {
                settingsDecisionStats.kept += 1;
                persistTeamSettings(teamId, selected.evalResult.settings, "rechecked-no-candidate");
              } else {
                settingsDecisionStats.fallbackNone += 1;
              }
            }

            if (selected) {
              evalResult = selected.evalResult;
              meetsCriteria = selected.meetsCriteria;
            } else {
              evalResult = null;
              meetsCriteria = false;
            }
            bestSettingsCache.set(cacheKey, selected);
          }
          if (!evalResult) continue;

          const pickResult = computeUpcomingPick(leagueFixtures, matchInfo, evalResult.settings);
          if (pickResult.status !== "pick" || !pickResult.pick) continue;

          settingsByRow.set(`${fixture.id}:${teamId}`, evalResult.settings);
          output.push({
            fixtureId: fixture.id,
            competitionId: Number.isFinite(leagueId) ? leagueId : null,
            competitionName:
              competitionNameMap.get(leagueId) ??
              (Number.isFinite(leagueId) ? `Competition ${leagueId}` : null),
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
        }

        await maybeUpdateAnalysisUi();
      }

      await maybeUpdateAnalysisUi(true);
      logInfo("Analysis finished", {
        processed: analysisProcessedMatches,
        retainedBeforeOdds: output.length,
        settings: settingsDecisionStats,
      });
      updateBgState({
        progress: 60,
        message: "Analyse terminée. Chargement des cotes...",
        analysisProcessed: analysisProcessedMatches,
        analysisTotal: analysisTotalMatches,
      });
      throwIfCancelled();

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
      const enrichedOutput: ScanResult[] = [];
      const oddsProgressStart = 60;
      const oddsProgressEnd = 90;
      const oddsTotalSafe = Math.max(1, filteredOutput.length);

      for (let idx = 0; idx < filteredOutput.length; idx += 1) {
        throwIfCancelled();
        const row = filteredOutput[idx];

        let odds = oddsCache.get(row.fixtureId) ?? null;
        if (!oddsCache.has(row.fixtureId)) {
          odds = await fetchFixtureOdds(
            row.fixtureId,
            row.competitionId,
            row.season,
            abortController.signal
          );
          oddsCache.set(row.fixtureId, odds ?? null);
        }
        let pick = row.pick;
        let probability = row.probability;
        let oddValue = resolveOddForPick(pick, odds);

        const baseCriteria =
          row.hitRate >= HIT_MIN &&
          row.coverage >= V3_COVERAGE_MIN &&
          row.picks >= MIN_TOTAL_PICKS;

        if (baseCriteria && (oddValue == null || oddValue < MIN_ODDS_RETRY)) {
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

        enrichedOutput.push({
          ...row,
          pick,
          probability,
          odd: oddValue,
          meetsOdds,
          meetsCriteria: row.meetsCriteria,
          isDiscouraged,
        });

        const processed = idx + 1;
        if (processed === filteredOutput.length || processed % 10 === 0) {
          const pct =
            oddsProgressStart +
            (processed / oddsTotalSafe) * (oddsProgressEnd - oddsProgressStart);
          updateBgState({
            progress: pct,
            message: `Cotes ${processed}/${filteredOutput.length}...`,
          });
          if (processed === filteredOutput.length || processed % 50 === 0) {
            logInfo("Odds progress", {
              processed,
              total: filteredOutput.length,
            });
          }
        }
      }

      logInfo("Odds enrichment finished", {
        rowsWithOddsStage: filteredOutput.length,
      });
      updateBgState({ progress: 90, message: "Cotes chargées." });
      throwIfCancelled();

      const uniqueOutput = (() => {
        const rank = (value: ScanResult) => [
          value.meetsCriteria ? 1 : 0,
          value.hitRate ?? 0,
          value.coverage ?? 0,
          value.probability ?? 0,
          value.odd ?? 0,
        ];
        const isBetter = (candidate: ScanResult, current: ScanResult) => {
          const a = rank(candidate);
          const b = rank(current);
          for (let i = 0; i < a.length; i += 1) {
            if (a[i] !== b[i]) return a[i] > b[i];
          }
          return false;
        };

        const map = new Map<string, ScanResult>();
        enrichedOutput.forEach((row) => {
          const pick = row.pick.trim();
          const normalized = pick === row.pick ? row : { ...row, pick };
          const key = `${normalized.fixtureId}:${normalized.pick}`;
          const current = map.get(key);
          if (!current) {
            map.set(key, normalized);
            return;
          }
          if (isBetter(normalized, current)) {
            map.set(key, normalized);
          }
        });
        return Array.from(map.values());
      })();

      const summary = `${visibleFixtures.length} match(s) analysé(s) • ${uniqueOutput.length} match(s) retenu(s) • ${totalEvaluations} évaluations`;
      logInfo("Scan summary computed", {
        visibleFixtures: visibleFixtures.length,
        retained: uniqueOutput.length,
        evaluations: totalEvaluations,
      });
      safe(() => setResults((prev) => [...withoutDateKey(prev, dateKey), ...uniqueOutput]));
      safe(() => setScanInfoByDate((prev) => ({ ...prev, [dateKey]: summary })));

      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(
            `${SEARCH_SESSION_CACHE_PREFIX}${dateKey}`,
            JSON.stringify({
              results: uniqueOutput,
              lastScanInfo: summary,
            })
          );
        } catch {
          // Ignore storage errors
        }
      }

      throwIfCancelled();

      updateBgState({ progress: 94, message: "Sauvegarde du cache..." });
      await writeCacheForDateKey(dateKey, uniqueOutput);
      updateBgState({ progress: 96, message: "Cache sauvegardé. Finalisation..." });

      const finishedAt = new Date().toISOString();
      await supabaseBrowser
        .from(SEARCH_RUNS_TABLE)
        .update({
          status: "done",
          finished_at: finishedAt,
          error: null,
          rows_count: uniqueOutput.length,
        })
        .eq("scan_date", dateKey);
      updateBgState({
        status: "done",
        progress: 100,
        message: summary,
        rowsCount: uniqueOutput.length,
      });
      logInfo("Scan completed", {
        durationMs: Date.now() - runStartMs,
        rowsCount: uniqueOutput.length,
        teamsPersisted: autoSavedTeams.size,
      });
      if (scanId) clearSearchBgScanCancel(scanId);
      safe(() =>
        setScanRunsByDate((prev) => ({
          ...prev,
          [dateKey]: {
            ...baseRun,
            status: "done",
            finished_at: finishedAt,
            rows_count: uniqueOutput.length,
          },
        }))
      );
      void logAlgoEvent({
        eventType: "scan_daily",
        payload: {
          matchCount: visibleFixtures.length,
          retained: uniqueOutput.length,
          totalEvaluations,
          scanDate: dateKey,
          scanTarget: target,
          timezone: timeZone,
          criteria: { hitMin: HIT_MIN, picksMin: V3_COVERAGE_MIN },
          autoSavedTeams: autoSavedTeams.size,
          results: uniqueOutput.map((row) => ({
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
      const isAbort = err?.name === "AbortError";
      const message = isAbort ? "Recherche annulée." : err?.message ?? "Erreur lors du scan.";
      if (isAbort) {
        logWarn("Scan cancelled", { durationMs: Date.now() - runStartMs, message });
      } else {
        logError("Scan failed", {
          durationMs: Date.now() - runStartMs,
          message,
          error: toErrorMessage(err),
        });
      }
      updateBgState({ status: "error", progress: 100, message, rowsCount: null });
      if (scanId) clearSearchBgScanCancel(scanId);
      safe(() => setError(isAbort ? null : message));
      safe(() => setScanInfoByDate((prev) => ({ ...prev, [dateKey]: message })));
      const finishedAt = new Date().toISOString();
      safe(() =>
        setScanRunsByDate((prev) => ({
          ...prev,
          [dateKey]: {
            ...baseRun,
            status: "error",
            finished_at: finishedAt,
            error: message,
          },
        }))
      );
      try {
        await supabaseBrowser
          .from(SEARCH_RUNS_TABLE)
          .update({
            status: "error",
            finished_at: finishedAt,
            error: message,
          })
          .eq("scan_date", dateKey);
      } catch {
        // Ignore persist errors on failures
      }
    } finally {
      if (cancelWatcher) clearInterval(cancelWatcher);
      if (heartbeatWatcher) clearInterval(heartbeatWatcher);
      if (scanId && activeScanIdRef.current === scanId) {
        activeScanIdRef.current = null;
      }
      safe(() => setRunningTarget(null));
      safe(() => setLoading(false));
      if (oddsAbortControllerRef.current === abortController) {
        oddsAbortControllerRef.current = null;
      }
    }
  };

  const formatTime = (value?: string | null) => {
    if (!value) return "--:--";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "--:--";
    return date.toLocaleTimeString("fr-FR", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDateLabel = (label: string) =>
    label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : label;

  return (
    <div className="w-full space-y-6">
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
	        <div className="flex items-center gap-2 self-center md:self-auto">
	          <button
	            type="button"
	            onClick={() => runScanForDay("today")}
	            className="px-3 py-1 rounded-lg text-sm bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white transition hover:from-green-400 hover:via-emerald-400 hover:to-lime-400 disabled:opacity-40 disabled:cursor-not-allowed"
	            disabled={
	              loading ||
	              isInResetWindow ||
	              todayIsRunning
	            }
	            title={
	              isInResetWindow
	                ? "Disponible à 00:01 (Toronto)."
	                : todayDoneWithCache
	                  ? "Cache déjà présent. Clique pour recalculer."
	                  : todayIsRunning
	                    ? `Scan déjà en cours (démarré à ${formatTime(todayRun.started_at)}).`
	                    : "Calcule et met en cache les picks d'aujourd'hui."
	            }
	          >
	            {todayIsRunning
	              ? "Aujourd'hui (en cours)"
	              : todayDoneWithCache
	                ? "Relancer aujourd'hui (cache)"
	                : todayRun?.status === "running" || todayRun?.status === "done"
	                  ? "Relancer aujourd'hui"
	                  : "Lancer aujourd'hui"}
	          </button>
	          <button
	            type="button"
	            onClick={() => runScanForDay("tomorrow")}
	            className="px-3 py-1 rounded-lg text-sm bg-white/10 text-white/80 transition hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
	            disabled={
	              loading ||
	              isInResetWindow ||
	              tomorrowIsRunning
	            }
	            title={
	              isInResetWindow
	                ? "Disponible à 00:01 (Toronto)."
	                : tomorrowDoneWithCache
	                  ? "Cache déjà présent. Clique pour recalculer."
	                  : tomorrowIsRunning
	                    ? `Scan déjà en cours (démarré à ${formatTime(tomorrowRun.started_at)}).`
	                    : "Calcule et met en cache les picks de demain."
	            }
	          >
	            {tomorrowIsRunning
	              ? "Demain (en cours)"
	              : tomorrowDoneWithCache
	                ? "Relancer demain (cache)"
	                : tomorrowRun?.status === "running" || tomorrowRun?.status === "done"
	                  ? "Relancer demain"
	                  : "Lancer demain"}
	          </button>
            {loading ? (
              <button
                type="button"
                onClick={cancelScan}
                className="px-3 py-1 rounded-lg text-sm border border-red-400/40 bg-red-500/15 text-red-100 transition hover:bg-red-500/25"
              >
                Annuler
              </button>
            ) : null}
	        </div>
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
          Lancez un scan pour aujourd&apos;hui ou demain afin de charger les picks (cache global).
        </div>
      ) : null}

      {results.length > 0 && filteredResults.length === 0 && !loading ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/60">
          {hideDiscouraged &&
          activeRawResults.length > 0 &&
          activeRawResults.every((row) => row.isDiscouraged)
            ? "Tous les matchs trouvés sont marqués comme déconseillés. Décochez \"Masquer les choix déconseillés\" pour les afficher."
            : `Aucun match pour ${dayTab === "today" ? formatDateLabel(todayLabel) : formatDateLabel(tomorrowLabel)}.`}
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
                    const targetTeamId =
                      Number.isFinite(row.teamId) && row.teamId > 0
                        ? row.teamId
                        : Number.isFinite(row.homeId) && (row.homeId ?? 0) > 0
                          ? Number(row.homeId)
                          : null;
                    const homeLogoUrl = resolveTeamLogoUrl(row.homeLogo, row.homeId);
                    const awayLogoUrl = resolveTeamLogoUrl(row.awayLogo, row.awayId);
                    const targetHref = (() => {
                      if (!targetTeamId) return null;
                      const params = new URLSearchParams({ tab: "backtest", from: "search" });
                      if (row.dateUtc) params.set("asOf", row.dateUtc);
                      return `/team/${targetTeamId}?${params.toString()}`;
                    })();
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
                            {homeLogoUrl ? (
                              <img
                                src={homeLogoUrl}
                                alt={row.homeName ?? "Home"}
                                className="w-7 h-7 rounded-full bg-white/10 object-contain p-0.5 ring-1 ring-white/10 shrink-0"
                              />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-white/10 ring-1 ring-white/10 shrink-0" />
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
                            {awayLogoUrl ? (
                              <img
                                src={awayLogoUrl}
                                alt={row.awayName ?? "Away"}
                                className="w-7 h-7 rounded-full bg-white/10 object-contain p-0.5 ring-1 ring-white/10 shrink-0"
                              />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-white/10 ring-1 ring-white/10 shrink-0" />
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
