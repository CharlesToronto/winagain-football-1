"use client";

import { useEffect, useMemo, useState } from "react";
import { getProbabilityEngines } from "@/lib/adapters/probabilities";
import { getTeamFixturesAllSeasons } from "@/lib/queries/fixtures";
import {
  getLeagueSeasonCalibration,
  OVER_UNDER_LINES,
  type CalibrationMultipliers,
} from "@/lib/odds/calibration";

type Fixture = any;
type FilterKey = "FT" | "HT" | "2H";
type RangeOption = number | "season";

const CURRENT_SEASON = 2025;

type OverUnderProbabilities = {
  over: Record<string, number>;
  under: Record<string, number>;
};

type GoalSplit = {
  goalsFor: number;
  goalsAgainst: number;
  count: number;
};

type GoalAverages = {
  home: GoalSplit;
  away: GoalSplit;
  overall: GoalSplit;
};

const POISSON_WEIGHT = 0.6;

function formatOdd(value: string | number | null | undefined) {
  if (value == null) return "-";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return parsed.toFixed(2);
}

function clampProbability(value: number, min = 0.001, max = 0.999) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

function normalizeTwo(a: number, b: number) {
  const sum = a + b;
  if (!Number.isFinite(sum) || sum <= 0) return [0, 0] as const;
  return [a / sum, b / sum] as const;
}

function blendProbability(base: number, smooth?: number | null) {
  if (smooth == null || !Number.isFinite(smooth)) return base;
  return base * (1 - POISSON_WEIGHT) + smooth * POISSON_WEIGHT;
}

function poissonCdf(k: number, lambda: number) {
  let sum = 0;
  let term = Math.exp(-lambda);
  sum += term;
  for (let i = 1; i <= k; i += 1) {
    term *= lambda / i;
    sum += term;
  }
  return sum;
}

function poissonOverProbability(line: string, lambda: number) {
  const limit = Math.floor(Number(line));
  if (!Number.isFinite(limit) || lambda <= 0) return 0;
  return 1 - poissonCdf(limit, lambda);
}

function fitPoissonLambda(targetOver: Record<string, number>) {
  const validLines = OVER_UNDER_LINES.filter((line) => {
    const prob = targetOver[line];
    return Number.isFinite(prob) && prob > 0 && prob < 1;
  });
  if (validLines.length < 2) return null;
  let bestLambda = 0;
  let bestError = Number.POSITIVE_INFINITY;
  for (let lambda = 0.3; lambda <= 5.5; lambda += 0.05) {
    let error = 0;
    for (const line of validLines) {
      const target = targetOver[line];
      const estimate = poissonOverProbability(line, lambda);
      error += (estimate - target) ** 2;
    }
    if (error < bestError) {
      bestError = error;
      bestLambda = lambda;
    }
  }
  return bestLambda > 0 ? Number(bestLambda.toFixed(2)) : null;
}

function averageValues(a: number, b: number) {
  if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  return (a + b) / 2;
}

function computeGoalAverages(fixtures: Fixture[]): GoalAverages {
  const totals = {
    home: { goalsFor: 0, goalsAgainst: 0, count: 0 },
    away: { goalsFor: 0, goalsAgainst: 0, count: 0 },
  };
  for (const fixture of fixtures) {
    if (fixture?.goals_home == null || fixture?.goals_away == null) continue;
    const isHome = Boolean(fixture?.isHome);
    const goalsFor = isHome ? fixture.goals_home : fixture.goals_away;
    const goalsAgainst = isHome ? fixture.goals_away : fixture.goals_home;
    const bucket = isHome ? totals.home : totals.away;
    bucket.goalsFor += Number(goalsFor) || 0;
    bucket.goalsAgainst += Number(goalsAgainst) || 0;
    bucket.count += 1;
  }
  const totalCount = totals.home.count + totals.away.count;
  const overallFor = totals.home.goalsFor + totals.away.goalsFor;
  const overallAgainst = totals.home.goalsAgainst + totals.away.goalsAgainst;
  return {
    home: {
      goalsFor: totals.home.count ? totals.home.goalsFor / totals.home.count : 0,
      goalsAgainst: totals.home.count ? totals.home.goalsAgainst / totals.home.count : 0,
      count: totals.home.count,
    },
    away: {
      goalsFor: totals.away.count ? totals.away.goalsFor / totals.away.count : 0,
      goalsAgainst: totals.away.count ? totals.away.goalsAgainst / totals.away.count : 0,
      count: totals.away.count,
    },
    overall: {
      goalsFor: totalCount ? overallFor / totalCount : 0,
      goalsAgainst: totalCount ? overallAgainst / totalCount : 0,
      count: totalCount,
    },
  };
}

function getFixtureTimestamp(fixture: Fixture) {
  const raw =
    fixture?.date_utc ?? fixture?.date ?? fixture?.fixture?.date ?? fixture?.timestamp ?? null;
  if (raw == null) return 0;
  if (typeof raw === "number") {
    return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  }
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function selectFixturesForRange(
  fixtures: Fixture[] = [],
  range?: RangeOption,
  cutoffDate?: Date | null
) {
  let played = fixtures.filter(
    (fixture) => fixture.goals_home !== null && fixture.goals_away !== null
  );

  if (range === "season") {
    played = played.filter((fixture) => fixture.season === CURRENT_SEASON);
  }

  if (cutoffDate) {
    const cutoffTime = cutoffDate.getTime();
    played = played.filter((fixture) => {
      const time = getFixtureTimestamp(fixture);
      return time > 0 && time <= cutoffTime;
    });
  }

  played.sort((a, b) => getFixtureTimestamp(b) - getFixtureTimestamp(a));

  const selectedCount = range === "season" || range == null ? played.length : range;
  return played.slice(0, selectedCount);
}

function combinePercent(a?: number | null, b?: number | null) {
  const values = [a, b].filter((val): val is number => typeof val === "number");
  if (!values.length) return 0;
  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
  return Math.max(0, Math.min(100, avg));
}

function buildOverUnderMultipliers(reference: CalibrationMultipliers | null) {
  if (!reference) return null;
  return reference.overUnder;
}

function OddsOverUnderCard({
  odds,
  apiOdds,
  bookmakerLabel,
}: {
  odds: { over: Record<string, string>; under: Record<string, string> };
  apiOdds?: { over: Record<string, string>; under: Record<string, string> } | null;
  bookmakerLabel?: string;
}) {
  return (
    <div className="bg-white/5 rounded-xl p-6 shadow h-[20rem]">
      <h3 className="font-semibold mb-3">Over / Under</h3>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-[11px] text-white/50 mb-2 px-2">
        <span />
        <span>Stats</span>
        <span>{bookmakerLabel ?? "10Bet"}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          {OVER_UNDER_LINES.map((line) => (
            <div
              key={`over-${line}`}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm py-1 px-2 -mx-2 rounded-md"
            >
              <span className="text-white/80">{`+${line}`}</span>
              <span className="font-semibold text-white/80">{odds.over[line] ?? "-"}</span>
              <span className="font-semibold text-pink-300">
                {apiOdds?.over?.[line] ?? "-"}
              </span>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {OVER_UNDER_LINES.map((line) => (
            <div
              key={`under-${line}`}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm py-1 px-2 -mx-2 rounded-md"
            >
              <span className="text-white/80">{`-${line}`}</span>
              <span className="font-semibold text-white/80">{odds.under[line] ?? "-"}</span>
              <span className="font-semibold text-pink-300">
                {apiOdds?.under?.[line] ?? "-"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OddsDoubleChanceCard({
  odds,
  apiOdds,
  bookmakerLabel,
}: {
  odds: Record<"1X" | "X2" | "12", string>;
  apiOdds?: Record<"1X" | "X2" | "12", string> | null;
  bookmakerLabel?: string;
}) {
  return (
    <div className="bg-white/5 rounded-xl p-6 shadow">
      <h3 className="font-semibold mb-3">Double chance</h3>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-[11px] text-white/50 mb-2 px-2">
        <span />
        <span>Stats</span>
        <span>{bookmakerLabel ?? "10Bet"}</span>
      </div>
      <div className="space-y-1">
        {(["1X", "X2", "12"] as const).map((label) => (
          <div
            key={label}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm py-1 px-2 -mx-2 rounded-md"
          >
            <span className="text-white/80">{label}</span>
            <span className="font-semibold text-white/80">{odds[label] ?? "-"}</span>
            <span className="font-semibold text-pink-300">
              {apiOdds?.[label] ?? "-"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OddsView({
  teamId,
  nextOpponentId,
  fixtureId,
  leagueId,
  season,
  isTeamHome,
  range,
  cutoffDate,
  filter,
}: {
  teamId?: number | null;
  nextOpponentId?: number | null;
  fixtureId?: number | null;
  leagueId?: number | null;
  season?: number | null;
  isTeamHome?: boolean | null;
  range?: RangeOption;
  cutoffDate?: Date | null;
  filter: FilterKey;
}) {
  const [teamFixtures, setTeamFixtures] = useState<Fixture[]>([]);
  const [opponentFixtures, setOpponentFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiOdds, setApiOdds] = useState<{
    overUnder: { over: Record<string, string>; under: Record<string, string> };
    doubleChance: Record<"1X" | "X2" | "12", string>;
    bookmaker?: { id?: number | null; name?: string | null } | null;
  } | null>(null);
  const [apiOddsLoading, setApiOddsLoading] = useState(false);
  const [apiOddsError, setApiOddsError] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<CalibrationMultipliers | null>(null);
  const [calibrationLoading, setCalibrationLoading] = useState(false);
  const { engines } = getProbabilityEngines();
  const computeEngine = engines[filter];
  const calibrationMultipliers = useMemo(
    () => buildOverUnderMultipliers(calibration),
    [calibration]
  );

  useEffect(() => {
    let active = true;
    if (!fixtureId || !leagueId || !season) {
      setApiOdds(null);
      setApiOddsError("Aucune cote disponible.");
      setApiOddsLoading(false);
      return () => {
        active = false;
      };
    }
    setApiOddsLoading(true);
    setApiOddsError(null);
    fetch(
      `/api/odds/fixture?fixture=${fixtureId}&league=${leagueId}&season=${season}&bookmaker=1`
    )
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Odds API error: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        if (!data?.odds) {
          setApiOdds(null);
          return;
        }
        setApiOdds({
          ...data.odds,
          bookmaker: data.bookmaker ?? null,
        });
      })
      .catch(() => {
        if (!active) return;
        setApiOdds(null);
        setApiOddsError("Impossible de charger les cotes 10Bet.");
      })
      .finally(() => {
        if (!active) return;
        setApiOddsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fixtureId, leagueId, season]);

  useEffect(() => {
    let active = true;
    if (!leagueId || !season || filter !== "FT") {
      setCalibration(null);
      setCalibrationLoading(false);
      return () => {
        active = false;
      };
    }
    setCalibrationLoading(true);
    getLeagueSeasonCalibration({
      leagueId,
      season,
      bookmakerName: "Bet365",
    })
      .then((result) => {
        if (!active) return;
        setCalibration(result);
      })
      .catch(() => {
        if (!active) return;
        setCalibration(null);
      })
      .finally(() => {
        if (!active) return;
        setCalibrationLoading(false);
      });
    return () => {
      active = false;
    };
  }, [leagueId, season, filter]);

  useEffect(() => {
    let active = true;
    if (!teamId || !nextOpponentId) {
      setTeamFixtures([]);
      setOpponentFixtures([]);
      setError("Aucun adversaire disponible pour calculer les cotes.");
      return () => {
        active = false;
      };
    }
    setLoading(true);
    setError(null);
    Promise.all([
      getTeamFixturesAllSeasons(teamId),
      getTeamFixturesAllSeasons(nextOpponentId),
    ])
      .then(([teamRaw, opponentRaw]) => {
        if (!active) return;
        const teamFiltered = selectFixturesForRange(teamRaw, range, cutoffDate);
        const opponentFiltered = selectFixturesForRange(opponentRaw, range, cutoffDate);
        const mappedTeam = teamFiltered.map((fixture) => ({
          ...fixture,
          isHome: fixture.home_team_id === Number(teamId),
        }));
        const mappedOpponent = opponentFiltered.map((fixture) => ({
          ...fixture,
          isHome: fixture.home_team_id === Number(nextOpponentId),
        }));
        setTeamFixtures(mappedTeam);
        setOpponentFixtures(mappedOpponent);
      })
      .catch(() => {
        if (!active) return;
        setError("Impossible de charger les cotes.");
        setTeamFixtures([]);
        setOpponentFixtures([]);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [teamId, nextOpponentId, range, cutoffDate]);

  const teamStats = useMemo(
    () => (teamFixtures.length ? computeEngine(teamFixtures) : null),
    [teamFixtures, computeEngine]
  );
  const opponentStats = useMemo(
    () => (opponentFixtures.length ? computeEngine(opponentFixtures) : null),
    [opponentFixtures, computeEngine]
  );

  const teamGoalAverages = useMemo(
    () => computeGoalAverages(teamFixtures),
    [teamFixtures]
  );
  const opponentGoalAverages = useMemo(
    () => computeGoalAverages(opponentFixtures),
    [opponentFixtures]
  );

  const overUnderProbabilities = useMemo(() => {
    const over: Record<string, number> = {};
    const under: Record<string, number> = {};
    OVER_UNDER_LINES.forEach((line) => {
      const teamOver = teamStats?.over?.[line]?.percent;
      const oppOver = opponentStats?.over?.[line]?.percent;
      const teamUnder = teamStats?.under?.[line]?.percent;
      const oppUnder = opponentStats?.under?.[line]?.percent;
      const overPct = combinePercent(teamOver, oppOver);
      const underPct = combinePercent(teamUnder, oppUnder);
      over[line] = overPct ? overPct / 100 : 0;
      under[line] = underPct ? underPct / 100 : 0;
    });
    return { over, under };
  }, [teamStats, opponentStats]);

  const expectedTotalGoals = useMemo(() => {
    if (filter !== "FT" || isTeamHome == null) return null;
    const teamSplit = isTeamHome ? teamGoalAverages.home : teamGoalAverages.away;
    const oppSplit = isTeamHome ? opponentGoalAverages.away : opponentGoalAverages.home;
    const teamFor = teamSplit.count ? teamSplit.goalsFor : teamGoalAverages.overall.goalsFor;
    const teamAgainst = teamSplit.count
      ? teamSplit.goalsAgainst
      : teamGoalAverages.overall.goalsAgainst;
    const oppFor = oppSplit.count ? oppSplit.goalsFor : opponentGoalAverages.overall.goalsFor;
    const oppAgainst = oppSplit.count
      ? oppSplit.goalsAgainst
      : opponentGoalAverages.overall.goalsAgainst;
    const expectedTeamGoals = averageValues(teamFor, oppAgainst);
    const expectedOppGoals = averageValues(oppFor, teamAgainst);
    const total = expectedTeamGoals + expectedOppGoals;
    return Number.isFinite(total) && total > 0 ? Number(total.toFixed(2)) : null;
  }, [filter, isTeamHome, teamGoalAverages, opponentGoalAverages]);

  const poissonLambda = useMemo(() => {
    if (filter !== "FT") return null;
    if (expectedTotalGoals) return expectedTotalGoals;
    return fitPoissonLambda(overUnderProbabilities.over);
  }, [filter, expectedTotalGoals, overUnderProbabilities]);

  const poissonProbabilities = useMemo(() => {
    if (!poissonLambda) return null;
    const over: Record<string, number> = {};
    const under: Record<string, number> = {};
    OVER_UNDER_LINES.forEach((line) => {
      const overProb = poissonOverProbability(line, poissonLambda);
      over[line] = overProb;
      under[line] = 1 - overProb;
    });
    return { over, under };
  }, [poissonLambda]);

  const overUnderMultipliers = useMemo(
    () => calibrationMultipliers,
    [calibrationMultipliers]
  );

  const overUnderOdds = useMemo(() => {
    const over: Record<string, string> = {};
    const under: Record<string, string> = {};
    OVER_UNDER_LINES.forEach((line) => {
      const baseOver = blendProbability(
        overUnderProbabilities.over[line],
        poissonProbabilities?.over[line]
      );
      const baseUnder = blendProbability(
        overUnderProbabilities.under[line],
        poissonProbabilities?.under[line]
      );
      const overMultiplier = overUnderMultipliers?.over?.[line] ?? 1;
      const underMultiplier = overUnderMultipliers?.under?.[line] ?? 1;
      const overAdjusted = baseOver ? baseOver * overMultiplier : 0;
      const underAdjusted = baseUnder ? baseUnder * underMultiplier : 0;
      const [overProb, underProb] = normalizeTwo(overAdjusted, underAdjusted);
      const overround = calibration?.overUnderOverround?.[line] ?? 1;
      const overWithMargin = overProb * overround;
      const underWithMargin = underProb * overround;
      const overClamped = overWithMargin ? clampProbability(overWithMargin) : 0;
      const underClamped = underWithMargin ? clampProbability(underWithMargin) : 0;
      over[line] = formatOdd(overClamped ? 1 / overClamped : null);
      under[line] = formatOdd(underClamped ? 1 / underClamped : null);
    });
    return { over, under };
  }, [overUnderProbabilities, poissonProbabilities, overUnderMultipliers, calibration]);

  const doubleChanceProbabilities = useMemo(() => {
    const p1x = combinePercent(
      teamStats?.dc_1x?.percent,
      opponentStats?.dc_x2?.percent
    );
    const px2 = combinePercent(
      teamStats?.dc_x2?.percent,
      opponentStats?.dc_1x?.percent
    );
    const p12 = combinePercent(
      teamStats?.dc_12?.percent,
      opponentStats?.dc_12?.percent
    );
    return {
      "1X": p1x ? p1x / 100 : 0,
      X2: px2 ? px2 / 100 : 0,
      "12": p12 ? p12 / 100 : 0,
    };
  }, [teamStats, opponentStats]);

  const doubleChanceOdds = useMemo(() => {
    const values: Record<"1X" | "X2" | "12", string> = {
      "1X": "-",
      X2: "-",
      "12": "-",
    };
    const multipliers = calibration?.doubleChance ?? {
      "1X": 1,
      X2: 1,
      "12": 1,
    };
    const p1x = doubleChanceProbabilities["1X"] * multipliers["1X"];
    const px2 = doubleChanceProbabilities.X2 * multipliers.X2;
    const p12 = doubleChanceProbabilities["12"] * multipliers["12"];
    const c1x = p1x ? clampProbability(p1x) : 0;
    const cx2 = px2 ? clampProbability(px2) : 0;
    const c12 = p12 ? clampProbability(p12) : 0;
    values["1X"] = formatOdd(c1x ? 1 / c1x : null);
    values["X2"] = formatOdd(cx2 ? 1 / cx2 : null);
    values["12"] = formatOdd(c12 ? 1 / c12 : null);
    return values;
  }, [doubleChanceProbabilities, calibration]);

  if (!teamId || !nextOpponentId) {
    return (
      <div className="p-6 bg-white/10 backdrop-blur-sm border border-white/10 rounded-xl text-white">
        Aucun adversaire disponible pour calculer les cotes.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-white/70">
          {loading
            ? "Chargement des stats..."
            : error
              ? error
              : calibrationLoading
                ? "Calibrage Bet365..."
                : "Stats + cotes du match"}
        </div>
        <div className="text-xs text-white/50">
          {apiOddsLoading
            ? "Cotes 10Bet..."
            : apiOddsError
              ? apiOddsError
              : apiOdds?.bookmaker?.name
                ? `Bookmaker : ${apiOdds.bookmaker.name}`
                : "Bookmaker : 10Bet"}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <OddsOverUnderCard
          odds={overUnderOdds}
          apiOdds={apiOdds?.overUnder ?? null}
          bookmakerLabel={apiOdds?.bookmaker?.name ?? "10Bet"}
        />
        <OddsDoubleChanceCard
          odds={doubleChanceOdds}
          apiOdds={apiOdds?.doubleChance ?? null}
          bookmakerLabel={apiOdds?.bookmaker?.name ?? "10Bet"}
        />
      </div>
    </div>
  );
}
