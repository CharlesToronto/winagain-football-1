import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  AlgoSettings,
  DEFAULT_ALGO_SETTINGS,
  MarketLine,
  addRolling,
  createRolling,
  normalizeAlgoSettings,
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
import { fetchFixtureOddsFromApi } from "@/lib/odds/fixtureOdds";

export const dynamic = "force-dynamic";

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
const VARIANT_COUNT = 30;
const HIT_MIN = 0.8;
const PICKS_MIN = 0.33;
const MIN_TOTAL_PICKS = 25;
const MIN_ODDS = 1.18;
const V2_MIN_ODDS = 1.22;
const V3_MIN_ODDS = 1.22;
const V3_COVERAGE_MIN = 0.3;
const BOOKMAKER_IDS = [4, 16];
const CURRENT_SEASON = 2025;
const TIMEZONE = "America/Toronto";
const DAILY_ALGO_TABLE_V1 = "daily_algo_picks";
const DAILY_ALGO_TABLE_V2 = "daily_algo_picks_v2";
const DAILY_ALGO_TABLE_V3 = "daily_algo_picks_v3";
const V2_BLACKLISTED_LEAGUE_IDS = new Set([
  206, // Turkey - Türkiye Kupası
  111, // Wales - FAW Championship
  80, // Germany - 3. Liga
  286, // Serbia - Super Liga
  197, // Greece - Super League 1
  283, // Romania - Liga I
  144, // Belgium - Jupiler Pro League
  271, // Hungary - NB I
  172, // Bulgaria - First League
]);

const V2_EV_MARGINS = {
  over_under: 0.02,
  double_chance: 0.015,
  "1x2": 0.03,
  btts: 0.025,
  dnb: 0.02,
  team_total: 0.02,
  other: 0.02,
} as const;

const V3_EV_MARGINS = V2_EV_MARGINS;

type AlgoVersion = "v1" | "v2" | "v3";

function resolveAlgoVersion(value: string | null): AlgoVersion {
  if (value === "v2") return "v2";
  if (value === "v3") return "v3";
  return "v1";
}

type FixtureLite = {
  id: number;
  date_utc: string | null;
  season: number | null;
  status_short: string | null;
  competition_id: number | null;
  home?: { id?: number | null; name?: string | null; logo?: string | null } | null;
  away?: { id?: number | null; name?: string | null; logo?: string | null } | null;
};

type TeamEval = {
  settings: AlgoSettings;
  stats: {
    picks: number;
    hits: number;
    hitRate: number;
    coverage: number;
    evaluated: number;
  };
};

type TeamEvalV3 = {
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

type NextMatchInfo = {
  fixtureId: number | null;
  dateUtc: string | null;
  homeId: number | null;
  awayId: number | null;
};

function lineKey(line: MarketLine) {
  return typeof line === "number" ? line.toString() : line;
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

function normalizeBacktestFixture(fixture: any): BacktestFixture {
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
}

function formatDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const BASELINE_HOME = 1.35;
const BASELINE_AWAY = 1.15;
const MIN_ODDS_RETRY = 1.2;

function normalizePickMarket(pick: string) {
  const raw = String(pick ?? "").toLowerCase().trim();
  if (!raw) return "other" as const;
  if (raw.includes("over") || raw.includes("under")) {
    if (raw.includes("home") || raw.includes("away")) return "team_total" as const;
    return "over_under" as const;
  }
  if (raw.includes("btts") || raw.includes("both teams") || raw.includes("gg")) {
    return "btts" as const;
  }
  if (raw.includes("dnb") || raw.includes("draw no bet")) {
    return "dnb" as const;
  }
  if (raw.includes("1x") || raw.includes("x2") || raw.includes("12")) {
    return "double_chance" as const;
  }
  if (raw === "1" || raw === "x" || raw === "2" || raw.includes("home win") || raw.includes("away win") || raw.includes("draw")) {
    return "1x2" as const;
  }
  return "other" as const;
}

function resolveEvMargin(pick: string) {
  const market = normalizePickMarket(pick);
  return V2_EV_MARGINS[market] ?? V2_EV_MARGINS.other;
}

function computeUpcomingPick(
  fixtures: BacktestFixture[],
  nextMatch: NextMatchInfo,
  settings: AlgoSettings,
  excludeLine?: MarketLine | null
) {
  if (!nextMatch?.homeId || !nextMatch?.awayId) return { status: "no-data" as const };
  const targetTime = nextMatch.dateUtc ? new Date(nextMatch.dateUtc).getTime() : Infinity;
  const ordered = fixtures
    .filter((fixture) => fixture.date_utc)
    .map((fixture) => ({
      ...fixture,
      dateTime: fixture.date_utc ? new Date(fixture.date_utc).getTime() : 0,
    }))
    .filter((fixture) => Number.isFinite(fixture.dateTime) && fixture.dateTime < targetTime)
    .sort((a, b) => a.dateTime - b.dateTime);

  const teamHistory = new Map<
    number,
    { home: ReturnType<typeof createRolling>; away: ReturnType<typeof createRolling> }
  >();
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

function buildCandidateSettings(count: number) {
  const combos: AlgoSettings[] = [];
  const weightModes: Array<"soft" | "medium" | "hard"> = ["soft", "medium", "hard"];

  for (const windowSize of WINDOWS) {
    for (const bucketSize of BUCKETS) {
      for (const threshold of THRESHOLDS) {
        for (const minMatches of MIN_MATCHES) {
          for (const minLeagueMatches of MIN_LEAGUE_MATCHES) {
            for (const lines of LINE_SETS) {
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

  for (let i = combos.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [combos[i], combos[j]] = [combos[j], combos[i]];
  }
  return combos.slice(0, count);
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

function computeTeamEval(
  fixtures: BacktestFixture[],
  teamId: number,
  baseSettings: AlgoSettings
): TeamEval | null {
  const result = computeBacktest(fixtures, teamId, baseSettings);
  const allPicks = result.picks;
  const filtered = allPicks.filter((pick) => pick.probability >= baseSettings.threshold);
  const hits = filtered.filter((pick) => pick.hit).length;
  const picks = filtered.length;
  const hitRate = picks ? hits / picks : 0;
  const coverage = allPicks.length ? picks / allPicks.length : 0;
  return {
    settings: baseSettings,
    stats: {
      picks,
      hits,
      hitRate,
      coverage,
      evaluated: allPicks.length,
    },
  };
}

function computeTeamEvalV3(
  fixtures: BacktestFixture[],
  teamId: number,
  baseSettings: AlgoSettings
): TeamEvalV3 | null {
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
  return {
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
}

function findBestSettings(
  fixtures: BacktestFixture[],
  teamId: number,
  baseSettings: AlgoSettings,
  candidatePool: AlgoSettings[]
): { evalResult: TeamEval; meetsCriteria: boolean } | null {
  const candidates = [baseSettings, ...candidatePool.filter((item) => item !== baseSettings)];
  const unique = new Map<string, AlgoSettings>();
  candidates.forEach((settings) => {
    unique.set(JSON.stringify(settings), settings);
  });
  const list = Array.from(unique.values());

  const eligible: TeamEval[] = [];
  const evaluated: TeamEval[] = [];
  list.forEach((settings) => {
    const evalResult = computeTeamEval(fixtures, teamId, settings);
    if (!evalResult) return;
    evaluated.push(evalResult);
    if (
      evalResult.stats.hitRate >= HIT_MIN &&
      evalResult.stats.coverage >= PICKS_MIN &&
      evalResult.stats.picks >= MIN_TOTAL_PICKS
    ) {
      eligible.push(evalResult);
    }
  });

  const rank = (a: TeamEval, b: TeamEval) => {
    if (b.stats.picks !== a.stats.picks) return b.stats.picks - a.stats.picks;
    if (b.stats.hitRate !== a.stats.hitRate) return b.stats.hitRate - a.stats.hitRate;
    return b.stats.coverage - a.stats.coverage;
  };

  if (eligible.length) {
    return { evalResult: eligible.sort(rank)[0], meetsCriteria: true };
  }
  if (!evaluated.length) return null;
  return { evalResult: evaluated.sort(rank)[0], meetsCriteria: false };
}

function findBestSettingsV3(
  fixtures: BacktestFixture[],
  teamId: number
): { evalResult: TeamEvalV3; meetsCriteria: boolean } | null {
  const phase1WeightModes: Array<"soft" | "medium" | "hard"> = ["soft"];
  const phase2WeightModes: Array<"soft" | "medium" | "hard"> = ["soft", "medium", "hard"];

  const phase1Candidates = buildAllSettings(LINE_SETS, phase1WeightModes);
  const phase1Computed: TeamEvalV3[] = [];
  phase1Candidates.forEach((settings) => {
    const evalResult = computeTeamEvalV3(fixtures, teamId, settings);
    if (!evalResult) return;
    phase1Computed.push(evalResult);
  });
  const phase1Filtered = phase1Computed.filter(
    (row) =>
      row.stats.hitRate >= HIT_MIN &&
      row.stats.coverage >= V3_COVERAGE_MIN &&
      row.stats.picks >= MIN_TOTAL_PICKS
  );
  const rank = (a: TeamEvalV3, b: TeamEvalV3) => {
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
  const phase2Computed: TeamEvalV3[] = [];
  finalCandidates.forEach((settings) => {
    const evalResult = computeTeamEvalV3(fixtures, teamId, settings);
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
}

function parseOddValue(value?: string | null) {
  if (!value) return null;
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveOddForPick(pick: string, odds: any) {
  if (!odds || !pick) return null;
  const trimmed = pick.trim();
  if (trimmed === "1X" || trimmed === "X2" || trimmed === "12") {
    return parseOddValue(odds.doubleChance?.[trimmed]);
  }
  const match = trimmed.match(/^(Over|Under)\s+([0-9]+(?:[.,][0-9]+)?)$/i);
  if (!match) return null;
  const lineValue = Number(String(match[2]).replace(",", "."));
  if (!Number.isFinite(lineValue)) return null;
  const line = String(lineValue);
  if (match[1].toLowerCase() === "over") {
    return parseOddValue(odds.overUnder?.over?.[line]);
  }
  return parseOddValue(odds.overUnder?.under?.[line]);
}

function extractPickLine(pick: string): MarketLine | null {
  if (!pick) return null;
  const trimmed = pick.trim();
  if (trimmed === "1X" || trimmed === "X2" || trimmed === "12") {
    return trimmed as MarketLine;
  }
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

function getTzParts(date: Date, timeZone: string) {
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
}

function getTimezoneOffset(date: Date, timeZone: string) {
  const parts = getTzParts(date, timeZone);
  const asUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return (asUTC - date.getTime()) / 60000;
}

function getUtcRangeForToday(timeZone: string) {
  const now = new Date();
  const parts = getTzParts(now, timeZone);
  const midnightUTC = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
  const offset = getTimezoneOffset(new Date(midnightUTC), timeZone);
  const start = new Date(midnightUTC - offset * 60000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const dateKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day
  ).padStart(2, "0")}`;
  return { start, end, dateKey };
}

type FixtureScores = {
  goalsHome: number;
  goalsAway: number;
  goalsHomeHT?: number | null;
  goalsAwayHT?: number | null;
};

function evaluatePick(pick: string, scores: FixtureScores) {
  const trimmed = String(pick ?? "").trim();
  if (!trimmed) return null;

  const goalsHome = Number(scores.goalsHome);
  const goalsAway = Number(scores.goalsAway);
  if (!Number.isFinite(goalsHome) || !Number.isFinite(goalsAway)) return null;

  const lower = trimmed.toLowerCase();

  const normalizeLabel = (value: string) =>
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const normalized = normalizeLabel(lower)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const cleaned = normalized
    .replace(/\(.*?\)/g, " ")
    .replace(/\|.*$/g, " ")
    .replace(/[\u2000-\u206F\u2E00-\u2E7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const ascii = cleaned
    .replace(/[^a-z0-9., ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const hasHTScores =
    Number.isFinite(scores.goalsHomeHT) && Number.isFinite(scores.goalsAwayHT);

  const segment = (() => {
    if (/(1h|ht|mi-temps|first half)/i.test(lower)) return "HT";
    if (/(2h|second half|2nd half)/i.test(lower)) return "2H";
    return "FT";
  })();

  const resolveGoals = (side?: "home" | "away") => {
    let h = goalsHome;
    let a = goalsAway;
    if (segment === "HT") {
      if (!hasHTScores) return null;
      h = Number(scores.goalsHomeHT);
      a = Number(scores.goalsAwayHT);
    }
    if (segment === "2H") {
      if (!hasHTScores) return null;
      h = goalsHome - Number(scores.goalsHomeHT);
      a = goalsAway - Number(scores.goalsAwayHT);
    }
    if (side === "home") return h;
    if (side === "away") return a;
    return h + a;
  };

  // Double chance (FT only)
  const dc = ascii.toUpperCase().replace(/\s+/g, "");
  if (dc === "1X") return segment === "FT" ? goalsHome >= goalsAway : null;
  if (dc === "X2") return segment === "FT" ? goalsAway >= goalsHome : null;
  if (dc === "12") return segment === "FT" ? goalsHome !== goalsAway : null;

  // 1X2 / résultat (FT only)
  if (/^(1|home|home win|victoire|domicile)$/.test(ascii)) {
    return segment === "FT" ? goalsHome > goalsAway : null;
  }
  if (/^(x|draw|nul)$/.test(ascii)) {
    return segment === "FT" ? goalsHome === goalsAway : null;
  }
  if (/^(2|away|away win|defaite|exterieur)$/.test(ascii)) {
    return segment === "FT" ? goalsAway > goalsHome : null;
  }

  // Draw No Bet (FT only)
  if (
    ascii.includes("draw no bet") ||
    ascii.includes("draw-no-bet") ||
    ascii.startsWith("dnb")
  ) {
    if (segment !== "FT") return null;
    if (goalsHome === goalsAway) return null;
    if (/(home|domicile|\\b1\\b)/.test(ascii)) return goalsHome > goalsAway;
    if (/(away|exterieur|\\b2\\b)/.test(ascii)) return goalsAway > goalsHome;
    return null;
  }

  // BTTS
  if (
    ascii.includes("btts") ||
    ascii.includes("bts") ||
    ascii.includes("both teams")
  ) {
    const btts = goalsHome > 0 && goalsAway > 0;
    if (/(no|non)/.test(ascii) && !/(yes|oui)/.test(ascii)) return !btts;
    return btts;
  }

  // Clean sheet (home/away)
  if (
    ascii.includes("clean sheet") ||
    ascii.includes("clean-sheet") ||
    ascii.includes("cleansheet") ||
    /\\bcs\\b/.test(ascii)
  ) {
    const isHome = /home|domicile/.test(ascii);
    const isAway = /away|exterieur/.test(ascii);
    if (!isHome && !isAway) return null;
    const clean = isHome ? goalsAway === 0 : goalsHome === 0;
    if (/(no|non)/.test(ascii)) return !clean;
    return clean;
  }

  // Over/Under (total or team)
  const ouMatch = ascii.match(/\\b(over|under)\\s*([0-9]+(?:[.,][0-9]+)?)/i);
  if (ouMatch) {
    const line = Number(String(ouMatch[2]).replace(",", "."));
    if (!Number.isFinite(line)) return null;
    const side =
      /home|domicile/.test(ascii) ? "home" : /away|exterieur/.test(ascii) ? "away" : undefined;
    const goals = resolveGoals(side);
    if (goals == null) return null;
    if (ouMatch[1] === "over") return goals > line;
    return goals < line;
  }

  // Over/Under fallback (handles weird spacing/characters)
  if (lower.includes("over") || lower.includes("under")) {
    const numMatch = trimmed.match(/([0-9]+(?:[.,][0-9]+)?)/);
    if (numMatch) {
      const line = Number(String(numMatch[1]).replace(",", "."));
      if (!Number.isFinite(line)) return null;
      const side =
        /home|domicile/.test(ascii) ? "home" : /away|exterieur/.test(ascii) ? "away" : undefined;
      const goals = resolveGoals(side);
      if (goals == null) return null;
      if (lower.includes("over")) return goals > line;
      if (lower.includes("under")) return goals < line;
    }
  }

  return null;
}

export async function GET(request: Request) {
  const supabase = createClient();
  try {
    const url = new URL(request.url);
    const task = url.searchParams.get("task") ?? "all";
    const algoVersion = resolveAlgoVersion(url.searchParams.get("algo"));
    const isV2 = algoVersion === "v2";
    const isV3 = algoVersion === "v3";
    const tableName =
      algoVersion === "v2"
        ? DAILY_ALGO_TABLE_V2
        : algoVersion === "v3"
          ? DAILY_ALGO_TABLE_V3
          : DAILY_ALGO_TABLE_V1;
    const minOdds = isV2 ? V2_MIN_ODDS : isV3 ? V3_MIN_ODDS : MIN_ODDS;
    const minOddsRetry = isV2 ? V2_MIN_ODDS : isV3 ? V3_MIN_ODDS : MIN_ODDS_RETRY;

    const summary: Record<string, any> = {};
    summary.algo = algoVersion;

    if (task === "all" || task === "resolve") {
      const pending: any[] = [];
      const pendingBatchSize = 1000;
      let lastId: string | null = null;
      while (true) {
        let query = supabase
          .from(tableName)
          .select("id, fixture_id, pick")
          .or("status.eq.pending,status.is.null")
          .order("id", { ascending: true })
          .limit(pendingBatchSize);
        if (lastId) {
          query = query.gt("id", lastId);
        }
        const { data, error: pendingError } = await query;
        if (pendingError) {
          return NextResponse.json({ error: pendingError.message }, { status: 500 });
        }
        const rows = data ?? [];
        pending.push(...rows);
        if (!rows.length) break;
        const newLastId = rows[rows.length - 1]?.id;
        if (!newLastId || newLastId === lastId) break;
        lastId = String(newLastId);
      }

      const pendingCount = pending.length;
      let missingFixture = 0;
      let missingScores = 0;
      let unknownPick = 0;
      const unknownPickMap = new Map<string, number>();
      let updateErrors = 0;
      const updateErrorSamples: Array<{ id: string; fixtureId: number; error: string }> = [];
      const unsupportedUpdateColumns = new Set<string>();

      const extractMissingColumn = (value: any) => {
        const message = String(value?.message ?? "");
        const match = message.match(/Could not find the '([^']+)' column/i);
        if (match) return match[1];
        const match2 = message.match(/column ([a-zA-Z0-9_]+) does not exist/i);
        if (match2) return match2[1];
        const match3 = message.match(/column [a-zA-Z0-9_]+\\.([a-zA-Z0-9_]+) does not exist/i);
        if (match3) return match3[1];
        return null;
      };

      if (pendingCount) {
        const fixtureIds = Array.from(
          new Set(pending.map((row: any) => Number(row.fixture_id)).filter(Number.isFinite))
        );
        const fixtureMap = new Map<number, any>();
        const chunkSize = 1000;
        for (let i = 0; i < fixtureIds.length; i += chunkSize) {
          const chunk = fixtureIds.slice(i, i + chunkSize);
          const { data: fixtures, error: fixturesError } = await supabase
            .from("fixtures")
            .select("id, goals_home, goals_away, goals_home_ht, goals_away_ht, status_short")
            .in("id", chunk);
          if (fixturesError) {
            return NextResponse.json({ error: fixturesError.message }, { status: 500 });
          }
          (fixtures ?? []).forEach((row: any) => {
            fixtureMap.set(Number(row.id), row);
          });
        }

        let resolved = 0;
        for (const row of pending ?? []) {
          if (!row?.pick) continue;
          const fixture = fixtureMap.get(Number(row.fixture_id));
          if (!fixture) {
            missingFixture += 1;
            continue;
          }
          if (fixture.goals_home == null || fixture.goals_away == null) {
            missingScores += 1;
            continue;
          }
          const hit = evaluatePick(row.pick, {
            goalsHome: fixture.goals_home,
            goalsAway: fixture.goals_away,
            goalsHomeHT: fixture.goals_home_ht,
            goalsAwayHT: fixture.goals_away_ht,
          });
          if (hit == null) {
            unknownPick += 1;
            const key = String(row.pick ?? "UNKNOWN");
            unknownPickMap.set(key, (unknownPickMap.get(key) ?? 0) + 1);
            continue;
          }

          const baseUpdate: Record<string, any> = {
            status: hit ? "hit" : "miss",
            hit,
            goals_home: fixture.goals_home,
            goals_away: fixture.goals_away,
            resolved_at: new Date().toISOString(),
          };

          const buildUpdate = () => {
            const payload = { ...baseUpdate };
            unsupportedUpdateColumns.forEach((col) => {
              delete payload[col];
            });
            return payload;
          };

          let payload = buildUpdate();
          let updatedOk = false;
          let updateFailureMessage: string | null = null;
          for (let attempt = 0; attempt < 6; attempt += 1) {
            if (!Object.keys(payload).length) break;
            const { data: updated, error: updateError } = await supabase
              .from(tableName)
              .update(payload)
              .eq("id", row.id)
              .select("id");

            if (!updateError) {
              if (Array.isArray(updated) && updated.length > 0) {
                updatedOk = true;
                break;
              }
              updateFailureMessage = "Update returned 0 rows (possible RLS or missing row).";
              break;
            }

            const missing = extractMissingColumn(updateError);
            if (missing && !unsupportedUpdateColumns.has(missing)) {
              unsupportedUpdateColumns.add(missing);
              payload = buildUpdate();
              continue;
            }

            updateFailureMessage = String(updateError.message ?? updateError);
            break;
          }

          if (updatedOk) {
            resolved += 1;
          } else {
            updateErrors += 1;
            if (updateErrorSamples.length < 10) {
              updateErrorSamples.push({
                id: String(row.id ?? ""),
                fixtureId: Number(row.fixture_id ?? 0),
                error: updateFailureMessage || "Update failed (unknown reason).",
              });
            }
          }
        }
        summary.resolved = resolved;
        summary.pending = pendingCount;
        summary.missingFixture = missingFixture;
        summary.missingScores = missingScores;
        summary.unknownPick = unknownPick;
        summary.updateErrors = updateErrors;
        summary.updateErrorSamples = updateErrorSamples;
        summary.resolveUnsupportedColumns = Array.from(unsupportedUpdateColumns.values());
        summary.unknownPickSample = Array.from(unknownPickMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([pick, count]) => ({ pick, count }));

        const { count: pendingAfter, error: pendingAfterError } = await supabase
          .from(tableName)
          .select("id", { count: "exact", head: true })
          .or("status.eq.pending,status.is.null");
        if (!pendingAfterError) {
          summary.pendingAfter = pendingAfter ?? null;
        }
      } else {
        summary.resolved = 0;
        summary.pending = 0;
        summary.missingFixture = 0;
        summary.missingScores = 0;
        summary.unknownPick = 0;
        summary.updateErrors = 0;
        summary.updateErrorSamples = [];
        summary.resolveUnsupportedColumns = [];
        summary.unknownPickSample = [];
      }
    }

    if (task === "all" || task === "snapshot") {
      const { start, end, dateKey } = getUtcRangeForToday(TIMEZONE);
      const { data: fixtureRows, error: fixturesError } = await supabase
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
        return NextResponse.json({ error: fixturesError.message }, { status: 500 });
      }

      const fixtures = (fixtureRows ?? []) as FixtureLite[];
      if (!fixtures.length) {
        return NextResponse.json({
          ok: true,
          snapshotDate: dateKey,
          created: 0,
          resolved: summary.resolved ?? 0,
        });
      }

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
            seasons.map(async (season) => {
              const { data } = await supabase
                .from("fixtures")
                .select(
                  `
                  id,
                  date_utc,
                  season,
                  competition_id,
                  home_team_id,
                  away_team_id,
                  goals_home,
                  goals_away,
                  teams:home_team_id ( id, name, logo ),
                  opp:away_team_id ( id, name, logo )
                `
                )
                .eq("competition_id", leagueId)
                .eq("season", season)
                .eq("status_short", "FT");
              return data ?? [];
            })
          );
          const normalized = seasonFixtures
            .flat()
            .map(normalizeBacktestFixture)
            .filter((fixture) => Number.isFinite(fixture.id) && fixture.id > 0);
          leagueFixturesMap.set(leagueId, normalized);
        })
      );

      const competitionNameMap = new Map<number, string>();
      if (leagueIds.length) {
        const { data: competitions } = await supabase
          .from("competitions")
          .select("id,name")
          .in("id", leagueIds);
        (competitions ?? []).forEach((row: any) => {
          const id = Number(row?.id);
          if (!Number.isFinite(id)) return;
          const name = row?.name ? String(row.name) : `Competition ${id}`;
          competitionNameMap.set(id, name);
        });
      }

      const candidatePool = isV3 ? [] : buildCandidateSettings(VARIANT_COUNT);
      const bestSettingsCache = new Map<
        string,
        { evalResult: TeamEval | TeamEvalV3; meetsCriteria: boolean } | null
      >();
      const oddsCache = new Map<number, any | null>();

      const rows: any[] = [];
      const snapshotPickKeys = new Set<string>();
      for (const fixture of fixtures) {
        const leagueId = Number(fixture.competition_id ?? 0);
        if ((isV2 || isV3) && Number.isFinite(leagueId) && V2_BLACKLISTED_LEAGUE_IDS.has(leagueId)) {
          continue;
        }
        const leagueFixtures = leagueFixturesMap.get(leagueId) ?? [];
        if (!leagueFixtures.length) continue;

        const matchInfo: NextMatchInfo = {
          fixtureId: fixture.id,
          dateUtc: fixture.date_utc ?? null,
          homeId: fixture.home?.id ?? null,
          awayId: fixture.away?.id ?? null,
        };

        for (const entry of [
          { side: "home" as const, team: fixture.home },
          { side: "away" as const, team: fixture.away },
        ]) {
          const teamId = Number(entry.team?.id ?? 0);
          if (!Number.isFinite(teamId)) continue;
          const cacheKey = `${leagueId}:${teamId}`;
          let cached = bestSettingsCache.get(cacheKey) ?? null;
          if (!bestSettingsCache.has(cacheKey)) {
            const best = isV3
              ? findBestSettingsV3(leagueFixtures, teamId)
              : findBestSettings(
                  leagueFixtures,
                  teamId,
                  DEFAULT_ALGO_SETTINGS,
                  candidatePool
                );
            cached = best;
            bestSettingsCache.set(cacheKey, best);
          }
          if (!cached?.evalResult) continue;

          const pickResult = computeUpcomingPick(
            leagueFixtures,
            matchInfo,
            cached.evalResult.settings
          );
          if (pickResult.status !== "pick" || !pickResult.pick) continue;

          let odds = oddsCache.get(fixture.id) ?? null;
          if (!oddsCache.has(fixture.id)) {
            try {
              const season = resolveSeason(fixture);
              if (Number.isFinite(season)) {
                const apiOdds = await fetchFixtureOddsFromApi({
                  fixtureId: fixture.id,
                  leagueId: Number.isFinite(leagueId) ? leagueId : null,
                  season,
                  bookmakerIds: BOOKMAKER_IDS,
                });
                odds = apiOdds.odds;
              }
            } catch {
              odds = null;
            }
            oddsCache.set(fixture.id, odds);
          }

          let pick = pickResult.pick;
          let probability = pickResult.probability ?? 0;
          let oddValue = resolveOddForPick(pick, odds);

          if (
            cached.meetsCriteria &&
            (oddValue == null || oddValue < minOddsRetry)
          ) {
            const excludeLine = extractPickLine(pick);
            if (excludeLine) {
              const alt = computeUpcomingPick(
                leagueFixtures,
                {
                  fixtureId: fixture.id,
                  dateUtc: fixture.date_utc ?? null,
                  homeId: fixture.home?.id ?? null,
                  awayId: fixture.away?.id ?? null,
                },
                cached.evalResult.settings,
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

          const meetsOdds = oddValue != null && oddValue >= minOdds;
          const meetsAlgoCriteria = cached.meetsCriteria;
          let meetsEv = true;
          if (isV2 || isV3) {
            if (oddValue == null || !Number.isFinite(oddValue) || oddValue <= 1) {
              meetsEv = false;
            } else if (!Number.isFinite(probability) || probability <= 0) {
              meetsEv = false;
            } else {
              const implied = 1 / oddValue;
              const margin = isV3 ? V3_EV_MARGINS[normalizePickMarket(pick)] ?? V3_EV_MARGINS.other : resolveEvMargin(pick);
              meetsEv = probability > implied + margin;
            }
          }
          const meetsCriteria = meetsAlgoCriteria && meetsOdds && (isV2 ? meetsEv : true);

          const pickKey = `${fixture.id}|${pick}`;
          if (snapshotPickKeys.has(pickKey)) continue;
          snapshotPickKeys.add(pickKey);

          rows.push({
            snapshot_date: dateKey,
            fixture_id: fixture.id,
            fixture_date_utc: fixture.date_utc ?? null,
            league_id: Number.isFinite(leagueId) ? leagueId : null,
            season: fixture.season ?? null,
            competition_name: competitionNameMap.get(leagueId) ?? null,
            team_id: teamId,
            side: entry.side,
            pick,
            market: isV2
              ? normalizePickMarket(pick)
              : pick.startsWith("Over") || pick.startsWith("Under")
                ? "over_under"
                : "double_chance",
            probability,
            hit_rate: cached.evalResult.stats.hitRate,
            coverage: cached.evalResult.stats.coverage,
            picks_count: cached.evalResult.stats.picks,
            evaluated_count: cached.evalResult.stats.evaluated,
            odd: oddValue,
            odds_bookmaker_id: null,
            meets_algo_criteria: meetsAlgoCriteria,
            meets_odds: meetsOdds,
            meets_criteria: meetsCriteria,
            status: "pending",
            home_id: fixture.home?.id ?? null,
            away_id: fixture.away?.id ?? null,
            home_name: fixture.home?.name ?? null,
            away_name: fixture.away?.name ?? null,
          });
        }
      }

      let createdCount = 0;
      let updatedCount = 0;
      let rowsToUpsert = rows;
      if (rows.length) {
        const { data: existingRows, error: existingError } = await supabase
          .from(tableName)
          .select("fixture_id,team_id,pick")
          .eq("snapshot_date", dateKey);
        if (existingError) {
          return NextResponse.json({ error: existingError.message }, { status: 500 });
        }
        const existingKeys = new Set(
          (existingRows ?? []).map(
            (row: any) => `${row.fixture_id ?? ""}|${row.team_id ?? ""}|${row.pick ?? ""}`
          )
        );
        for (const row of rows) {
          const key = `${row.fixture_id ?? ""}|${row.team_id ?? ""}|${row.pick ?? ""}`;
          if (existingKeys.has(key)) {
            updatedCount += 1;
          } else {
            createdCount += 1;
          }
        }

        rowsToUpsert = rows.map((row) => {
          const key = `${row.fixture_id ?? ""}|${row.team_id ?? ""}|${row.pick ?? ""}`;
          if (!existingKeys.has(key)) return row;
          const next: any = { ...row };
          // Avoid overwriting resolved statuses when replaying a snapshot for the same date.
          delete next.status;
          return next;
        });
      }

      if (rowsToUpsert.length) {
        const { error: upsertError } = await supabase
          .from(tableName)
          .upsert(rowsToUpsert, { onConflict: "snapshot_date,fixture_id,team_id,pick" });
        if (upsertError) {
          return NextResponse.json({ error: upsertError.message }, { status: 500 });
        }
      }

      summary.created = createdCount;
      summary.updated = updatedCount;
      summary.snapshotDate = dateKey;
    }

    if (task === "replay") {
      if (!isV2 && !isV3) {
        return NextResponse.json(
          { error: "Replay is only available for algo=v2 or algo=v3." },
          { status: 400 }
        );
      }

      const fromParam = url.searchParams.get("from");
      const toParam = url.searchParams.get("to");
      const daysParam = Number(url.searchParams.get("days") ?? "7");
      const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 7;

      const fromDate = fromParam ? new Date(fromParam) : (() => {
        const d = new Date();
        d.setDate(d.getDate() - days);
        return d;
      })();
      const toDate = toParam ? new Date(toParam) : new Date();

      const fromKey = fromParam ?? formatDateKey(fromDate);
      const toKey = toParam ?? formatDateKey(toDate);

      const fixtureSnapshotMap = new Map<number, string>();
      const fixtureIds: number[] = [];
      const v1BatchSize = 1000;
      let v1Offset = 0;
      while (true) {
        const { data: v1Rows, error: v1Error } = await supabase
          .from(DAILY_ALGO_TABLE_V1)
          .select("fixture_id,snapshot_date")
          .gte("snapshot_date", fromKey)
          .lte("snapshot_date", toKey)
          .range(v1Offset, v1Offset + v1BatchSize - 1);
        if (v1Error) {
          return NextResponse.json({ error: v1Error.message }, { status: 500 });
        }
        const rows = v1Rows ?? [];
        rows.forEach((row: any) => {
          const fixtureId = Number(row?.fixture_id);
          if (!Number.isFinite(fixtureId)) return;
          if (!fixtureSnapshotMap.has(fixtureId)) {
            fixtureSnapshotMap.set(fixtureId, String(row.snapshot_date));
            fixtureIds.push(fixtureId);
          }
        });
        if (rows.length < v1BatchSize) break;
        v1Offset += v1BatchSize;
      }

      if (!fixtureIds.length) {
        return NextResponse.json({
          ok: true,
          algo: "v2",
          replayed: 0,
          from: fromKey,
          to: toKey,
        });
      }

      const fixtures: FixtureLite[] = [];
      const fixtureChunkSize = 500;
      for (let i = 0; i < fixtureIds.length; i += fixtureChunkSize) {
        const chunk = fixtureIds.slice(i, i + fixtureChunkSize);
        const { data: fixtureRows, error: fixturesError } = await supabase
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
          .in("id", chunk);
        if (fixturesError) {
          return NextResponse.json({ error: fixturesError.message }, { status: 500 });
        }
        fixtures.push(...((fixtureRows ?? []) as FixtureLite[]));
      }

      if (!fixtures.length) {
        return NextResponse.json({
          ok: true,
          algo: "v2",
          replayed: 0,
          from: fromKey,
          to: toKey,
        });
      }

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
            seasons.map(async (season) => {
              const { data } = await supabase
                .from("fixtures")
                .select(
                  `
                  id,
                  date_utc,
                  season,
                  competition_id,
                  home_team_id,
                  away_team_id,
                  goals_home,
                  goals_away,
                  teams:home_team_id ( id, name, logo ),
                  opp:away_team_id ( id, name, logo )
                `
                )
                .eq("competition_id", leagueId)
                .eq("season", season)
                .eq("status_short", "FT");
              return data ?? [];
            })
          );
          const normalized = seasonFixtures
            .flat()
            .map(normalizeBacktestFixture)
            .filter((fixture) => Number.isFinite(fixture.id) && fixture.id > 0);
          leagueFixturesMap.set(leagueId, normalized);
        })
      );

      const competitionNameMap = new Map<number, string>();
      if (leagueIds.length) {
        const { data: competitions } = await supabase
          .from("competitions")
          .select("id,name")
          .in("id", leagueIds);
        (competitions ?? []).forEach((row: any) => {
          const id = Number(row?.id);
          if (!Number.isFinite(id)) return;
          const name = row?.name ? String(row.name) : `Competition ${id}`;
          competitionNameMap.set(id, name);
        });
      }

      const candidatePool = isV3 ? [] : buildCandidateSettings(VARIANT_COUNT);
      const bestSettingsCache = new Map<
        string,
        { evalResult: TeamEval | TeamEvalV3; meetsCriteria: boolean } | null
      >();
      const oddsCache = new Map<number, any | null>();

      const rows: any[] = [];
      const replayPickKeys = new Set<string>();
      for (const fixture of fixtures) {
        const leagueId = Number(fixture.competition_id ?? 0);
        if ((isV2 || isV3) && Number.isFinite(leagueId) && V2_BLACKLISTED_LEAGUE_IDS.has(leagueId)) {
          continue;
        }
        const leagueFixtures = leagueFixturesMap.get(leagueId) ?? [];
        if (!leagueFixtures.length) continue;

        const snapshotDate = fixtureSnapshotMap.get(Number(fixture.id));
        if (!snapshotDate) continue;

        const matchInfo: NextMatchInfo = {
          fixtureId: fixture.id,
          dateUtc: fixture.date_utc ?? null,
          homeId: fixture.home?.id ?? null,
          awayId: fixture.away?.id ?? null,
        };

        for (const entry of [
          { side: "home" as const, team: fixture.home },
          { side: "away" as const, team: fixture.away },
        ]) {
          const teamId = Number(entry.team?.id ?? 0);
          if (!Number.isFinite(teamId)) continue;
          const cacheKey = `${leagueId}:${teamId}`;
          let cached = bestSettingsCache.get(cacheKey) ?? null;
          if (!bestSettingsCache.has(cacheKey)) {
            const best = isV3
              ? findBestSettingsV3(leagueFixtures, teamId)
              : findBestSettings(
                  leagueFixtures,
                  teamId,
                  DEFAULT_ALGO_SETTINGS,
                  candidatePool
                );
            cached = best;
            bestSettingsCache.set(cacheKey, best);
          }
          if (!cached?.evalResult) continue;

          const pickResult = computeUpcomingPick(
            leagueFixtures,
            matchInfo,
            cached.evalResult.settings
          );
          if (pickResult.status !== "pick" || !pickResult.pick) continue;

          let odds = oddsCache.get(fixture.id) ?? null;
          if (!oddsCache.has(fixture.id)) {
            try {
              const season = resolveSeason(fixture);
              if (Number.isFinite(season)) {
                const apiOdds = await fetchFixtureOddsFromApi({
                  fixtureId: fixture.id,
                  leagueId: Number.isFinite(leagueId) ? leagueId : null,
                  season,
                  bookmakerIds: BOOKMAKER_IDS,
                });
                odds = apiOdds.odds;
              }
            } catch {
              odds = null;
            }
            oddsCache.set(fixture.id, odds);
          }

          let pick = pickResult.pick;
          let probability = pickResult.probability ?? 0;
          let oddValue = resolveOddForPick(pick, odds);

          if (cached.meetsCriteria && (oddValue == null || oddValue < minOddsRetry)) {
            const excludeLine = extractPickLine(pick);
            if (excludeLine) {
              const alt = computeUpcomingPick(
                leagueFixtures,
                {
                  fixtureId: fixture.id,
                  dateUtc: fixture.date_utc ?? null,
                  homeId: fixture.home?.id ?? null,
                  awayId: fixture.away?.id ?? null,
                },
                cached.evalResult.settings,
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

          const meetsOdds = oddValue != null && oddValue >= minOdds;
          const meetsAlgoCriteria = cached.meetsCriteria;
          let meetsEv = true;
          if (oddValue == null || !Number.isFinite(oddValue) || oddValue <= 1) {
            meetsEv = false;
          } else if (!Number.isFinite(probability) || probability <= 0) {
            meetsEv = false;
          } else {
            const implied = 1 / oddValue;
            const margin = isV3 ? V3_EV_MARGINS[normalizePickMarket(pick)] ?? V3_EV_MARGINS.other : resolveEvMargin(pick);
            meetsEv = probability > implied + margin;
          }
          const meetsCriteria = meetsAlgoCriteria && meetsOdds && meetsEv;

          const pickKey = `${fixture.id}|${pick}`;
          if (replayPickKeys.has(pickKey)) continue;
          replayPickKeys.add(pickKey);

          rows.push({
            snapshot_date: snapshotDate,
            fixture_id: fixture.id,
            fixture_date_utc: fixture.date_utc ?? null,
            league_id: Number.isFinite(leagueId) ? leagueId : null,
            season: fixture.season ?? null,
            competition_name: competitionNameMap.get(leagueId) ?? null,
            team_id: teamId,
            side: entry.side,
            pick,
            market: normalizePickMarket(pick),
            probability,
            hit_rate: cached.evalResult.stats.hitRate,
            coverage: cached.evalResult.stats.coverage,
            picks_count: cached.evalResult.stats.picks,
            evaluated_count: cached.evalResult.stats.evaluated,
            odd: oddValue,
            odds_bookmaker_id: null,
            meets_algo_criteria: meetsAlgoCriteria,
            meets_odds: meetsOdds,
            meets_criteria: meetsCriteria,
            status: "pending",
            home_id: fixture.home?.id ?? null,
            away_id: fixture.away?.id ?? null,
            home_name: fixture.home?.name ?? null,
            away_name: fixture.away?.name ?? null,
          });
        }
      }

      let createdCount = 0;
      let updatedCount = 0;
      if (rows.length) {
        const existingKeys = new Set<string>();
        const v2BatchSize = 1000;
        let v2Offset = 0;
        while (true) {
          const { data: existingRows, error: existingError } = await supabase
            .from(tableName)
            .select("snapshot_date,fixture_id,team_id,pick")
            .gte("snapshot_date", fromKey)
            .lte("snapshot_date", toKey)
            .range(v2Offset, v2Offset + v2BatchSize - 1);
          if (existingError) {
            return NextResponse.json({ error: existingError.message }, { status: 500 });
          }
          const rowsBatch = existingRows ?? [];
          rowsBatch.forEach((row: any) => {
            const key = `${row.snapshot_date}|${row.fixture_id ?? ""}|${row.team_id ?? ""}|${row.pick ?? ""}`;
            existingKeys.add(key);
          });
          if (rowsBatch.length < v2BatchSize) break;
          v2Offset += v2BatchSize;
        }

        for (const row of rows) {
          const key = `${row.snapshot_date}|${row.fixture_id ?? ""}|${row.team_id ?? ""}|${row.pick ?? ""}`;
          if (existingKeys.has(key)) {
            updatedCount += 1;
          } else {
            createdCount += 1;
          }
        }
      }

      if (rows.length) {
        const { error: upsertError } = await supabase
          .from(tableName)
          .upsert(rows, { onConflict: "snapshot_date,fixture_id,team_id,pick" });
        if (upsertError) {
          return NextResponse.json({ error: upsertError.message }, { status: 500 });
        }
      }

      summary.replayed = rows.length;
      summary.created = createdCount;
      summary.updated = updatedCount;
      summary.from = fromKey;
      summary.to = toKey;
    }

    const res = NextResponse.json({ ok: true, ...summary });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  } catch (err: any) {
    return NextResponse.json(
      { error: true, details: err?.message ?? "Daily algo job error" },
      { status: 500 }
    );
  }
}
