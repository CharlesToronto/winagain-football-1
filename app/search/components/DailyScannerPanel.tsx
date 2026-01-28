"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getLeagueFixturesBySeason } from "@/lib/queries/fixtures";
import {
  AlgoSettings,
  type MarketLine,
  DEFAULT_ALGO_SETTINGS,
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
const VARIANT_COUNT = 30;
const HIT_MIN = 0.8;
const PICKS_MIN = 0.33;
const SETTINGS_STORAGE_PREFIX = "winagain:algo-settings:team:";
const SCAN_STORAGE_KEY = "winagain:daily-scanner:last";
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
  };
};

type ScanResult = {
  fixtureId: number;
  competitionId: number | null;
  competitionName: string | null;
  competitionCountry: string | null;
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
  settings: AlgoSettings
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
  const cacheRef = useRef<Map<string, TeamEval>>(new Map());

  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local",
    []
  );

  const todayLabel = useMemo(() => {
    const now = new Date();
    return now.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "short" });
  }, []);

  const tomorrowLabel = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "short" });
  }, []);

  const candidatePool = useMemo(() => buildCandidateSettings(VARIANT_COUNT), []);

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
    const evalResult: TeamEval = {
      settings: baseSettings,
      stats: {
        picks,
        hits,
        hitRate,
        coverage,
        evaluated: allPicks.length,
      },
    };
    cacheRef.current.set(cacheKey, evalResult);
    return evalResult;
  };

  const findBestSettings = (
    fixtures: BacktestFixture[],
    teamId: number,
    baseSettings: AlgoSettings
  ) => {
    const candidates = [
      baseSettings,
      ...candidatePool.filter((item) => item !== baseSettings),
    ];
    const unique = new Map<string, AlgoSettings>();
    candidates.forEach((settings) => {
      unique.set(JSON.stringify(settings), settings);
    });
    const list = Array.from(unique.values());

    const eligible: TeamEval[] = [];
    list.forEach((settings) => {
      const evalResult = computeTeamEval(fixtures, teamId, settings);
      if (!evalResult) return;
      if (evalResult.stats.hitRate >= HIT_MIN && evalResult.stats.coverage >= PICKS_MIN) {
        eligible.push(evalResult);
      }
    });
    if (!eligible.length) return null;
    return eligible.sort((a, b) => {
      if (b.stats.picks !== a.stats.picks) return b.stats.picks - a.stats.picks;
      if (b.stats.hitRate !== a.stats.hitRate) return b.stats.hitRate - a.stats.hitRate;
      return b.stats.coverage - a.stats.coverage;
    })[0];
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
        const season = Number(fixture.season ?? 0);
        if (!Number.isFinite(season)) return;
        const current = leagueSeasonMap.get(leagueId) ?? 0;
        if (season > current) leagueSeasonMap.set(leagueId, season);
      });

      const leagueFixturesMap = new Map<number, BacktestFixture[]>();
      await Promise.all(
        leagueIds.map(async (leagueId) => {
          const currentSeason = leagueSeasonMap.get(leagueId) ?? new Date().getFullYear();
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
      if (leagueIds.length) {
        try {
          const response = await fetch(
            `/api/competitions/countries?ids=${leagueIds.join(",")}`
          );
          if (response.ok) {
            const data = await response.json();
            const items = Array.isArray(data?.items) ? data.items : [];
            items.forEach((row: any) => {
              const id = Number(row?.id);
              if (!Number.isFinite(id)) return;
              const name = row?.name ? String(row.name) : `Competition ${id}`;
              competitionNameMap.set(id, name);
              if (row?.country) {
                competitionCountryMap.set(id, String(row.country));
              }
            });
          }
        } catch {
          // Ignore API errors and fallback to generic labels
        }
      }

      const totalEvaluations = fixtures.reduce((sum, fixture) => {
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

      const bestSettingsCache = new Map<string, TeamEval | null>();
      const autoSavedTeams = new Set<number>();
      const output: ScanResult[] = [];

      fixtures.forEach((fixture) => {
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
          const baseSettings = teamSettingsMap.get(teamId) ?? DEFAULT_ALGO_SETTINGS;

          const cacheKey = `${leagueId}:${teamId}`;
          let evalResult = bestSettingsCache.get(cacheKey) ?? null;
          if (!bestSettingsCache.has(cacheKey)) {
            evalResult = findBestSettings(leagueFixtures, teamId, baseSettings);
            bestSettingsCache.set(cacheKey, evalResult);
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

          output.push({
            fixtureId: fixture.id,
            competitionId: Number.isFinite(leagueId) ? leagueId : null,
            competitionName: competitionNameMap.get(leagueId) ?? null,
            competitionCountry: competitionCountryMap.get(leagueId) ?? null,
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

      setResults(filteredOutput);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            SCAN_STORAGE_KEY,
            JSON.stringify({
              results: filteredOutput,
              lastScanInfo: `${fixtures.length} match(s) analysé(s) • ${filteredOutput.length} match(s) retenu(s) • ${totalEvaluations} évaluations`,
            })
          );
        } catch {
          // Ignore storage errors
        }
      }
      setLastScanInfo(
        `${fixtures.length} match(s) analysé(s) • ${filteredOutput.length} match(s) retenu(s) • ${totalEvaluations} évaluations`
      );
      void logAlgoEvent({
        eventType: "scan_daily",
        payload: {
          matchCount: fixtures.length,
          retained: filteredOutput.length,
          totalEvaluations,
          timezone: timeZone,
          criteria: { hitMin: HIT_MIN, picksMin: PICKS_MIN },
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

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-white/70">Scanner automatique</p>
          <h2 className="text-2xl font-semibold">Daily Scanner</h2>
          <p className="text-xs text-white/50">
            {todayLabel} + {tomorrowLabel} • Heure locale {timeZone}
          </p>
        </div>
        <button
          type="button"
          onClick={runScan}
          className="px-3 py-1 rounded-lg text-sm bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white transition hover:from-green-400 hover:via-emerald-400 hover:to-lime-400"
          disabled={loading}
        >
          {loading ? "Scan en cours..." : "Lancer le scan"}
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
        Critères : Hit ≥ 80% • Picks ≥ 33% (sur 2 saisons) • Réglages par équipe + variantes.
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {lastScanInfo ? (
        <div className="text-xs text-white/60">{lastScanInfo}</div>
      ) : null}

      {results.length === 0 && !loading ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/60">
          Aucun match retenu pour le moment.
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="space-y-5">
          {Array.from(
            results
              .reduce((map, row) => {
                const key = row.competitionId ? String(row.competitionId) : "unknown";
                if (!map.has(key)) {
                  map.set(key, {
                    id: key,
                  name: row.competitionName ?? `Competition ${row.competitionId ?? "-"}`,
                  country: row.competitionCountry ?? null,
                  items: [] as ScanResult[],
                });
              }
              map.get(key)!.items.push(row);
              return map;
            }, new Map<string, { id: string; name: string; country: string | null; items: ScanResult[] }>())
              .values()
          )
            .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
            .map((group) => (
              <details
                key={group.id}
                className="rounded-xl border border-white/10 bg-white/5 p-4"
                open
              >
                <summary className="cursor-pointer select-none text-xs uppercase tracking-wide text-blue-300">
                  {(group.country ?? "Pays inconnu") + " - " + group.name} •{" "}
                  {group.items.length} match(s)
                </summary>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {group.items.map((row) => {
                    const targetHref = row.homeId ? `/team/${row.homeId}` : null;
                    const Wrapper = targetHref ? Link : "div";
                    return (
                      <Wrapper
                        key={`${row.fixtureId}-${row.teamId}-${row.pick}`}
                        href={targetHref ?? undefined}
                        className={`rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2 ${
                          targetHref
                            ? "hover:border-white/30 hover:bg-white/10 transition cursor-pointer"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs text-white/60">
                          <span>{formatTime(row.dateUtc)}</span>
                          <span>Team {row.side === "home" ? "Home" : "Away"}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {row.homeLogo ? (
                            <img
                              src={row.homeLogo}
                              alt={row.homeName ?? "Home"}
                              className="w-6 h-6 object-contain"
                            />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-white/10" />
                          )}
                          <div className="text-sm font-semibold">
                            {row.homeName ?? "Home"} vs {row.awayName ?? "Away"}
                          </div>
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
                        <div className="text-xs text-white/60">
                          Réglage équipe : {row.teamName ?? "Team"} • Seuil{" "}
                          {row.threshold.toFixed(2)}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="px-2 py-0.5 rounded-md border border-pink-400/40 bg-pink-500/20 text-pink-200">
                            Pick {row.pick}
                          </span>
                          <span className="text-pink-200">
                            {(row.probability * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="text-xs text-white/60">
                          Hit {(row.hitRate * 100).toFixed(1)}% • Coverage{" "}
                          {(row.coverage * 100).toFixed(1)}% • {row.picks}/{row.evaluated}
                        </div>
                      </Wrapper>
                    );
                  })}
                </div>
              </details>
            ))}
        </div>
      ) : null}
    </div>
  );
}
