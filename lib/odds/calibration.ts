import { supabase } from "@/lib/supabase/client";

export const OVER_UNDER_LINES = ["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"] as const;

type FixtureRow = {
  id: number;
  date_utc: string | null;
  home_team_id: number;
  away_team_id: number;
  goals_home: number | null;
  goals_away: number | null;
};

type HistoryFixture = FixtureRow & { isHome: boolean };

type OddsRow = {
  fixture_id: number;
  market_name: string;
  label: string;
  value: number;
  update_time: string | null;
};

type OverUnderLineOdds = {
  over?: number;
  under?: number;
};

export type CalibrationMultipliers = {
  overUnder: {
    over: Record<string, number>;
    under: Record<string, number>;
  };
  doubleChance: Record<"1X" | "X2" | "12", number>;
  overUnderOverround: Record<string, number>;
};

const OVER_UNDER_MARKET = "Goals Over/Under";
const GOAL_LINE_MARKET = "Goal Line";
const DOUBLE_CHANCE_MARKET = "Double Chance";
const PAGE_SIZE = 1000;

function parseOverUnderLabel(label: string) {
  const match = label.match(/(Over|Under)\s+(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const side = match[1].toLowerCase() === "over" ? "over" : "under";
  return { side, line: match[2] };
}

function parseDoubleChanceLabel(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("home") && normalized.includes("draw")) return "1X" as const;
  if (normalized.includes("draw") && normalized.includes("away")) return "X2" as const;
  if (normalized.includes("home") && normalized.includes("away")) return "12" as const;
  return null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function combinePercent(a?: number | null, b?: number | null) {
  const values = [a, b].filter((val): val is number => typeof val === "number");
  if (!values.length) return 0;
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
  return Math.max(0, Math.min(100, avg));
}

function computeHistoryStats(fixtures: HistoryFixture[]) {
  if (!fixtures.length) {
    return {
      over: Object.fromEntries(OVER_UNDER_LINES.map((line) => [line, 0])),
      under: Object.fromEntries(OVER_UNDER_LINES.map((line) => [line, 0])),
      dc_1x: 0,
      dc_x2: 0,
      dc_12: 0,
    };
  }

  const overs: Record<string, number> = Object.fromEntries(
    OVER_UNDER_LINES.map((line) => [line, 0])
  );
  const unders: Record<string, number> = Object.fromEntries(
    OVER_UNDER_LINES.map((line) => [line, 0])
  );
  let win = 0;
  let draw = 0;
  let lose = 0;

  for (const fixture of fixtures) {
    const gf = fixture.isHome ? fixture.goals_home : fixture.goals_away;
    const ga = fixture.isHome ? fixture.goals_away : fixture.goals_home;
    if (gf == null || ga == null) continue;
    if (gf > ga) win++;
    else if (gf < ga) lose++;
    else draw++;
    const totalGoals = gf + ga;
    for (const line of OVER_UNDER_LINES) {
      const limit = Number(line);
      if (totalGoals > limit) overs[line]++;
      else unders[line]++;
    }
  }

  const total = fixtures.length || 1;
  const pct = (n: number) => Math.round((n / total) * 100);

  return {
    over: Object.fromEntries(OVER_UNDER_LINES.map((line) => [line, pct(overs[line])])) as Record<
      string,
      number
    >,
    under: Object.fromEntries(
      OVER_UNDER_LINES.map((line) => [line, pct(unders[line])])
    ) as Record<string, number>,
    dc_1x: pct(win + draw),
    dc_x2: pct(draw + lose),
    dc_12: pct(win + lose),
  };
}

async function fetchAllFixtures(leagueId: number, season: number) {
  const rows: FixtureRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("fixtures")
      .select("id,date_utc,home_team_id,away_team_id,goals_home,goals_away")
      .eq("competition_id", leagueId)
      .eq("season", season)
      .order("date_utc", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      return [];
    }
    if (data?.length) rows.push(...(data as FixtureRow[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function fetchAllOdds(leagueId: number, season: number, bookmakerName: string) {
  const rows: OddsRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("fixture_odds")
      .select("fixture_id,market_name,label,value,update_time")
      .eq("league_id", leagueId)
      .eq("season", season)
      .eq("bookmaker_name", bookmakerName)
      .in("market_name", [OVER_UNDER_MARKET, GOAL_LINE_MARKET, DOUBLE_CHANCE_MARKET])
      .order("fixture_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      return [];
    }
    if (data?.length) rows.push(...(data as OddsRow[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

export async function getLeagueSeasonCalibration({
  leagueId,
  season,
  bookmakerName = "Bet365",
}: {
  leagueId?: number | null;
  season?: number | null;
  bookmakerName?: string;
}) {
  if (!leagueId || !season) return null;

  const fixtures = await fetchAllFixtures(leagueId, season);
  if (!fixtures.length) return null;

  const oddsRows = await fetchAllOdds(leagueId, season, bookmakerName);
  if (!oddsRows.length) return null;

  const fixtureDates = new Map<number, number>();
  fixtures.forEach((fixture) => {
    const time = fixture.date_utc ? new Date(fixture.date_utc).getTime() : NaN;
    if (Number.isFinite(time)) fixtureDates.set(fixture.id, time);
  });

  const latestOdds = new Map<string, OddsRow>();
  for (const row of oddsRows) {
    const fixtureTime = fixtureDates.get(row.fixture_id);
    if (!fixtureTime || !row.update_time) continue;
    const updateTime = new Date(row.update_time).getTime();
    if (!Number.isFinite(updateTime) || updateTime > fixtureTime) continue;
    const key = `${row.fixture_id}|${row.market_name}|${row.label}`;
    const existing = latestOdds.get(key);
    if (!existing) {
      latestOdds.set(key, row);
      continue;
    }
    const existingTime = existing.update_time
      ? new Date(existing.update_time).getTime()
      : NaN;
    if (!Number.isFinite(existingTime) || updateTime > existingTime) {
      latestOdds.set(key, row);
    }
  }

  const overUnderByFixture = new Map<number, Record<string, OverUnderLineOdds>>();
  const doubleChanceByFixture = new Map<number, Record<"1X" | "X2" | "12", number>>();

  for (const row of Array.from(latestOdds.values())) {
    if (row.market_name === OVER_UNDER_MARKET || row.market_name === GOAL_LINE_MARKET) {
      const parsed = parseOverUnderLabel(row.label);
      if (
        !parsed ||
        !OVER_UNDER_LINES.includes(parsed.line as (typeof OVER_UNDER_LINES)[number])
      )
        continue;
      const byLine = overUnderByFixture.get(row.fixture_id) ?? {};
      const current = byLine[parsed.line] ?? {};
      current[parsed.side] = row.value;
      byLine[parsed.line] = current;
      overUnderByFixture.set(row.fixture_id, byLine);
      continue;
    }
    if (row.market_name === DOUBLE_CHANCE_MARKET) {
      const outcome = parseDoubleChanceLabel(row.label);
      if (!outcome) continue;
      const byOutcome =
        doubleChanceByFixture.get(row.fixture_id) ?? ({} as Record<"1X" | "X2" | "12", number>);
      byOutcome[outcome] = row.value;
      doubleChanceByFixture.set(row.fixture_id, byOutcome);
    }
  }

  const fixturesWithOdds = new Set<number>([
    ...Array.from(overUnderByFixture.keys()),
    ...Array.from(doubleChanceByFixture.keys()),
  ]);

  const ratiosOver: Record<string, number[]> = Object.fromEntries(
    OVER_UNDER_LINES.map((line) => [line, []])
  );
  const ratiosUnder: Record<string, number[]> = Object.fromEntries(
    OVER_UNDER_LINES.map((line) => [line, []])
  );
  const overroundOverUnder: Record<string, number[]> = Object.fromEntries(
    OVER_UNDER_LINES.map((line) => [line, []])
  );
  const ratiosDc: Record<"1X" | "X2" | "12", number[]> = {
    "1X": [],
    X2: [],
    "12": [],
  };

  const historyByTeam = new Map<number, HistoryFixture[]>();

  for (const fixture of fixtures) {
    if (fixturesWithOdds.has(fixture.id)) {
      const homeHistory = historyByTeam.get(fixture.home_team_id) ?? [];
      const awayHistory = historyByTeam.get(fixture.away_team_id) ?? [];
      const homeStats = computeHistoryStats(homeHistory);
      const awayStats = computeHistoryStats(awayHistory);

      const overUnder = overUnderByFixture.get(fixture.id);
      if (overUnder) {
        for (const [line, odds] of Object.entries(overUnder)) {
          const overOdd = odds.over;
          const underOdd = odds.under;
          if (!overOdd || !underOdd) continue;
          const impliedOver = 1 / overOdd;
          const impliedUnder = 1 / underOdd;
          const impliedSum = impliedOver + impliedUnder;
          if (!Number.isFinite(impliedSum) || impliedSum <= 0) continue;
          overroundOverUnder[line].push(impliedSum);
          const marketOver = impliedOver / impliedSum;
          const marketUnder = impliedUnder / impliedSum;
          const modelOverPct = combinePercent(
            homeStats.over[line],
            awayStats.over[line]
          );
          const modelUnderPct = combinePercent(
            homeStats.under[line],
            awayStats.under[line]
          );
          const modelOver = modelOverPct / 100;
          const modelUnder = modelUnderPct / 100;
          if (modelOver > 0) ratiosOver[line].push(marketOver / modelOver);
          if (modelUnder > 0) ratiosUnder[line].push(marketUnder / modelUnder);
        }
      }

      const doubleChance = doubleChanceByFixture.get(fixture.id);
      if (doubleChance) {
        const model = {
          "1X":
            combinePercent(homeStats.dc_1x, awayStats.dc_x2) / 100,
          X2:
            combinePercent(homeStats.dc_x2, awayStats.dc_1x) / 100,
          "12":
            combinePercent(homeStats.dc_12, awayStats.dc_12) / 100,
        };
        (["1X", "X2", "12"] as const).forEach((key) => {
          const odd = doubleChance[key];
          const modelProb = model[key];
          if (!odd || modelProb <= 0) return;
          const marketProb = 1 / odd;
          if (!Number.isFinite(marketProb) || marketProb <= 0) return;
          ratiosDc[key].push(marketProb / modelProb);
        });
      }
    }

    if (fixture.goals_home != null && fixture.goals_away != null) {
      const homeHistory = historyByTeam.get(fixture.home_team_id) ?? [];
      homeHistory.push({
        ...fixture,
        isHome: true,
      } as HistoryFixture);
      historyByTeam.set(fixture.home_team_id, homeHistory);

      const awayHistory = historyByTeam.get(fixture.away_team_id) ?? [];
      awayHistory.push({
        ...fixture,
        isHome: false,
      } as HistoryFixture);
      historyByTeam.set(fixture.away_team_id, awayHistory);
    }
  }

  const allOverRatios = Object.values(ratiosOver).flat();
  const allUnderRatios = Object.values(ratiosUnder).flat();
  const allOverrounds = Object.values(overroundOverUnder).flat();
  const allDcRatios = [...ratiosDc["1X"], ...ratiosDc.X2, ...ratiosDc["12"]];
  const defaultOver = median(allOverRatios) ?? 1;
  const defaultUnder = median(allUnderRatios) ?? 1;
  const defaultDc = median(allDcRatios) ?? 1;
  const defaultOverround = median(allOverrounds) ?? 1;

  const overMultipliers: Record<string, number> = {};
  const underMultipliers: Record<string, number> = {};
  const overroundMultipliers: Record<string, number> = {};

  for (const line of OVER_UNDER_LINES) {
    overMultipliers[line] = median(ratiosOver[line]) ?? defaultOver;
    underMultipliers[line] = median(ratiosUnder[line]) ?? defaultUnder;
    overroundMultipliers[line] = median(overroundOverUnder[line]) ?? defaultOverround;
  }

  const doubleChanceMultipliers: Record<"1X" | "X2" | "12", number> = {
    "1X": median(ratiosDc["1X"]) ?? defaultDc,
    X2: median(ratiosDc.X2) ?? defaultDc,
    "12": median(ratiosDc["12"]) ?? defaultDc,
  };
  return {
    overUnder: {
      over: overMultipliers,
      under: underMultipliers,
    },
    doubleChance: doubleChanceMultipliers,
    overUnderOverround: overroundMultipliers,
  } satisfies CalibrationMultipliers;
}
