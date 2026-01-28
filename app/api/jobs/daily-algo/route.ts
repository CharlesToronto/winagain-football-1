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
const BOOKMAKER_ID = 1;
const TIMEZONE = "America/Toronto";

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

const BASELINE_HOME = 1.35;
const BASELINE_AWAY = 1.15;

function computeUpcomingPick(
  fixtures: BacktestFixture[],
  nextMatch: NextMatchInfo,
  settings: AlgoSettings
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

function parseOddValue(value?: string | null) {
  if (!value) return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveOddForPick(pick: string, odds: any) {
  if (!odds || !pick) return null;
  const trimmed = pick.trim();
  if (trimmed === "1X" || trimmed === "X2" || trimmed === "12") {
    return parseOddValue(odds.doubleChance?.[trimmed]);
  }
  const match = trimmed.match(/^(Over|Under)\s+([0-9.]+)$/i);
  if (!match) return null;
  const line = match[2];
  if (match[1].toLowerCase() === "over") {
    return parseOddValue(odds.overUnder?.over?.[line]);
  }
  return parseOddValue(odds.overUnder?.under?.[line]);
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

function evaluatePick(pick: string, goalsHome: number, goalsAway: number) {
  const total = goalsHome + goalsAway;
  const trimmed = pick.trim();
  if (trimmed === "1X") return goalsHome >= goalsAway;
  if (trimmed === "X2") return goalsAway >= goalsHome;
  if (trimmed === "12") return goalsHome !== goalsAway;
  const match = trimmed.match(/^(Over|Under)\s+([0-9.]+)$/i);
  if (!match) return null;
  const line = Number(match[2]);
  if (!Number.isFinite(line)) return null;
  if (match[1].toLowerCase() === "over") return total > line;
  return total < line;
}

export async function GET(request: Request) {
  const supabase = createClient();
  try {
    const url = new URL(request.url);
    const task = url.searchParams.get("task") ?? "all";

    const summary: Record<string, any> = {};

    if (task === "all" || task === "resolve") {
      const { data: pending } = await supabase
        .from("daily_algo_picks")
        .select("id, fixture_id, pick")
        .or("status.eq.pending,status.is.null");

      if (pending?.length) {
        const fixtureIds = Array.from(
          new Set(pending.map((row: any) => Number(row.fixture_id)).filter(Number.isFinite))
        );
        const { data: fixtures } = await supabase
          .from("fixtures")
          .select("id, goals_home, goals_away, status_short")
          .in("id", fixtureIds);

        const fixtureMap = new Map<number, any>();
        (fixtures ?? []).forEach((row: any) => {
          fixtureMap.set(Number(row.id), row);
        });

        let resolved = 0;
        for (const row of pending ?? []) {
          if (!row?.pick) continue;
          const fixture = fixtureMap.get(Number(row.fixture_id));
          if (!fixture) continue;
          if (fixture.goals_home == null || fixture.goals_away == null) continue;
          const hit = evaluatePick(row.pick, fixture.goals_home, fixture.goals_away);
          if (hit == null) continue;
          await supabase
            .from("daily_algo_picks")
            .update({
              status: hit ? "hit" : "miss",
              hit,
              goals_home: fixture.goals_home,
              goals_away: fixture.goals_away,
              resolved_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          resolved += 1;
        }
        summary.resolved = resolved;
      } else {
        summary.resolved = 0;
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

      const candidatePool = buildCandidateSettings(VARIANT_COUNT);
      const bestSettingsCache = new Map<
        string,
        { evalResult: TeamEval; meetsCriteria: boolean } | null
      >();
      const oddsCache = new Map<number, any | null>();

      const rows: any[] = [];
      for (const fixture of fixtures) {
        const leagueId = Number(fixture.competition_id ?? 0);
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
            const best = findBestSettings(
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
              const season = Number(fixture.season ?? 0);
              if (Number.isFinite(season) && Number.isFinite(leagueId)) {
                const apiOdds = await fetchFixtureOddsFromApi({
                  fixtureId: fixture.id,
                  leagueId,
                  season,
                  bookmakerId: BOOKMAKER_ID,
                });
                odds = apiOdds.odds;
              }
            } catch {
              odds = null;
            }
            oddsCache.set(fixture.id, odds);
          }

          const oddValue = resolveOddForPick(pickResult.pick, odds);
          const meetsOdds = oddValue != null && oddValue >= MIN_ODDS;
          const meetsCriteria =
            cached.meetsCriteria &&
            meetsOdds;

          rows.push({
            snapshot_date: dateKey,
            fixture_id: fixture.id,
            fixture_date_utc: fixture.date_utc ?? null,
            league_id: Number.isFinite(leagueId) ? leagueId : null,
            season: fixture.season ?? null,
            competition_name: competitionNameMap.get(leagueId) ?? null,
            team_id: teamId,
            side: entry.side,
            pick: pickResult.pick,
            market: pickResult.pick.startsWith("Over") || pickResult.pick.startsWith("Under")
              ? "over_under"
              : "double_chance",
            probability: pickResult.probability ?? 0,
            hit_rate: cached.evalResult.stats.hitRate,
            coverage: cached.evalResult.stats.coverage,
            picks_count: cached.evalResult.stats.picks,
            evaluated_count: cached.evalResult.stats.evaluated,
            odd: oddValue,
            odds_bookmaker_id: BOOKMAKER_ID,
            meets_algo_criteria: cached.meetsCriteria,
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

      if (rows.length) {
        await supabase
          .from("daily_algo_picks")
          .upsert(rows, { onConflict: "snapshot_date,fixture_id,team_id,pick" });
      }

      summary.created = rows.length;
      summary.snapshotDate = dateKey;
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err: any) {
    return NextResponse.json(
      { error: true, details: err?.message ?? "Daily algo job error" },
      { status: 500 }
    );
  }
}
