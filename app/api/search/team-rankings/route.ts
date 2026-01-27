import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeAlgoSettings,
  createRolling,
  addRolling,
  weightedRollingAvg,
  parseLineList,
  parseNumberList,
} from "@/lib/analysisEngine/overUnderModel";
import {
  computePoissonOutcomes,
  computeEmpiricalOutcomes,
  mixOutcomes,
  getDoubleChanceProbability,
} from "@/lib/analysisEngine/overUnderBacktest";

const BASELINE_HOME = 1.35;
const BASELINE_AWAY = 1.15;
const DEFAULT_MIN_PICKS = 20;
const DEFAULT_LIMIT = 20;
const PAGE_SIZE = 1000;

type FixtureRow = {
  id: number;
  competition_id: number | null;
  season: number | null;
  date_utc: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  goals_home: number | null;
  goals_away: number | null;
};

type TeamRow = {
  id: number;
  name?: string | null;
  logo?: string | null;
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

function isDoubleChanceHit(line: "1X" | "X2" | "12", goalsHome: number, goalsAway: number) {
  if (goalsHome === goalsAway) return line !== "12";
  if (goalsHome > goalsAway) return line !== "X2";
  return line !== "1X";
}

async function fetchFixtures(
  supabase: ReturnType<typeof createClient>,
  leagueId: number,
  season: number
) {
  const rows: FixtureRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("fixtures")
      .select(
        "id,competition_id,season,date_utc,home_team_id,away_team_id,goals_home,goals_away"
      )
      .eq("competition_id", leagueId)
      .eq("season", season)
      .not("goals_home", "is", null)
      .not("goals_away", "is", null)
      .not("date_utc", "is", null)
      .order("date_utc", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return { data: null, error };
    }

    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { data: rows, error: null };
}

async function fetchTeams(supabase: ReturnType<typeof createClient>, leagueId: number) {
  const { data, error } = await supabase
    .from("teams")
    .select("id,name,logo")
    .eq("competition_id", leagueId);

  if (error) {
    return { data: null, error };
  }

  return { data: (data ?? []) as TeamRow[], error: null };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const leagueId = Number(searchParams.get("leagueId"));
    const season = Number(searchParams.get("season"));
    const settings = normalizeAlgoSettings({
      windowSize: Number(searchParams.get("windowSize")),
      bucketSize: Number(searchParams.get("bucketSize")),
      weights: parseNumberList(searchParams.get("weights")),
      minMatches: Number(searchParams.get("minMatches")),
      minLeagueMatches: Number(searchParams.get("minLeagueMatches")),
      threshold: Number(searchParams.get("threshold")),
      lines: parseLineList(searchParams.get("lines")),
    });
    const minPicks = Number(searchParams.get("minPicks") || DEFAULT_MIN_PICKS);
    const limit = Number(searchParams.get("limit") || DEFAULT_LIMIT);

    if (!Number.isFinite(leagueId)) {
      return NextResponse.json({ ok: false, error: "Missing leagueId" }, { status: 400 });
    }
    if (!Number.isFinite(season)) {
      return NextResponse.json({ ok: false, error: "Missing season" }, { status: 400 });
    }

    const supabase = createClient();

    const { data: fixtures, error: fixturesError } = await fetchFixtures(
      supabase,
      leagueId,
      season
    );
    if (fixturesError) {
      return NextResponse.json(
        { ok: false, error: "Failed to load fixtures" },
        { status: 500 }
      );
    }

    const { data: teams, error: teamsError } = await fetchTeams(supabase, leagueId);
    if (teamsError) {
      return NextResponse.json(
        { ok: false, error: "Failed to load teams" },
        { status: 500 }
      );
    }

    if (!fixtures || fixtures.length === 0) {
      return NextResponse.json({ ok: true, results: [] });
    }

    const teamStats = new Map<
      number,
      { id: number; name: string; logo?: string | null; picks: number; hits: number }
    >();

    (teams ?? []).forEach((team) => {
      if (typeof team.id !== "number") return;
      teamStats.set(team.id, {
        id: team.id,
        name: team.name ?? `Team ${team.id}`,
        logo: team.logo ?? null,
        picks: 0,
        hits: 0,
      });
    });

    const teamHistory = new Map<number, { home: ReturnType<typeof createRolling>; away: ReturnType<typeof createRolling> }>();
    const leagueHistory = { homeGoals: 0, awayGoals: 0, matches: 0 };

    for (const fixture of fixtures) {
      const homeId = Number(fixture.home_team_id ?? 0);
      const awayId = Number(fixture.away_team_id ?? 0);
      const goalsHome = Number(fixture.goals_home ?? 0);
      const goalsAway = Number(fixture.goals_away ?? 0);

      if (!teamHistory.has(homeId)) {
        teamHistory.set(homeId, { home: createRolling(), away: createRolling() });
      }
      if (!teamHistory.has(awayId)) {
        teamHistory.set(awayId, { home: createRolling(), away: createRolling() });
      }

      const leagueHomeAvg =
        leagueHistory.matches >= settings.minLeagueMatches
          ? leagueHistory.homeGoals / leagueHistory.matches
          : BASELINE_HOME;
      const leagueAwayAvg =
        leagueHistory.matches >= settings.minLeagueMatches
          ? leagueHistory.awayGoals / leagueHistory.matches
          : BASELINE_AWAY;

      const homeStats = teamHistory.get(homeId)!.home;
      const awayStats = teamHistory.get(awayId)!.away;

      const homeAvg = weightedRollingAvg(
        homeStats,
        settings.bucketSize,
        settings.weights
      );
      const awayAvg = weightedRollingAvg(
        awayStats,
        settings.bucketSize,
        settings.weights
      );

      if (homeAvg.n >= settings.minMatches && awayAvg.n >= settings.minMatches) {
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

        if (bestPick && bestPick.probability >= settings.threshold) {
          const totalGoals = goalsHome + goalsAway;
          const hit =
            bestPick.type === "dc"
              ? isDoubleChanceHit(bestPick.line, goalsHome, goalsAway)
              : bestPick.type === "over"
                ? totalGoals > bestPick.line
                : totalGoals <= bestPick.line;

          for (const teamId of [homeId, awayId]) {
            if (!teamStats.has(teamId)) {
              teamStats.set(teamId, {
                id: teamId,
                name: `Team ${teamId}`,
                logo: null,
                picks: 0,
                hits: 0,
              });
            }
            const record = teamStats.get(teamId)!;
            record.picks += 1;
            if (hit) record.hits += 1;
          }
        }
      }

      addRolling(teamHistory.get(homeId)!.home, goalsHome, goalsAway, settings.windowSize);
      addRolling(teamHistory.get(awayId)!.away, goalsAway, goalsHome, settings.windowSize);
      leagueHistory.homeGoals += goalsHome;
      leagueHistory.awayGoals += goalsAway;
      leagueHistory.matches += 1;
    }

    const ranked = Array.from(teamStats.values())
      .filter((row) => row.picks >= minPicks)
      .map((row) => ({
        ...row,
        hitRate: row.picks ? row.hits / row.picks : 0,
      }))
      .sort((a, b) => b.hitRate - a.hitRate)
      .slice(0, Math.max(1, limit));

    return NextResponse.json({
      ok: true,
      leagueId,
      season,
      settings,
      minPicks,
      results: ranked,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Failed to compute ranking" },
      { status: 500 }
    );
  }
}
