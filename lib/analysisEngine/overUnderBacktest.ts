import {
  AlgoSettings,
  Rolling,
  DoubleChanceLine,
  MarketLine,
  createRolling,
  addRolling,
  weightedRollingAvg,
} from "./overUnderModel";

const BASELINE_HOME = 1.35;
const BASELINE_AWAY = 1.15;
const DEFAULT_MAX_GOALS = 10;

export type OutcomeProbs = {
  homeWin: number;
  draw: number;
  awayWin: number;
};

export type BacktestFixture = {
  id: number;
  date_utc: string | null;
  competition_id?: number | null;
  home_team_id?: number | null;
  away_team_id?: number | null;
  goals_home?: number | null;
  goals_away?: number | null;
  teams?: { id?: number; name?: string | null; logo?: string | null } | null;
  opp?: { id?: number; name?: string | null; logo?: string | null } | null;
};

export type BacktestPick = {
  fixtureId: number;
  dateUtc: string | null;
  dateTime: number;
  label: string;
  opponent: string;
  pick: string;
  probability: number;
  hit: boolean;
  totalGoals: number;
  score: string;
};

export type BacktestResult = {
  picks: BacktestPick[];
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

function poissonSeries(lambda: number, maxGoals: number) {
  const probs: number[] = [];
  if (!Number.isFinite(lambda) || lambda <= 0) {
    probs[0] = 1;
    return probs;
  }
  let p = Math.exp(-lambda);
  probs[0] = p;
  for (let k = 1; k <= maxGoals; k += 1) {
    p = (p * lambda) / k;
    probs[k] = p;
  }
  return probs;
}

function normalizeOutcomes(outcomes: OutcomeProbs): OutcomeProbs {
  const total = outcomes.homeWin + outcomes.draw + outcomes.awayWin;
  if (!total) return { homeWin: 0, draw: 0, awayWin: 0 };
  return {
    homeWin: outcomes.homeWin / total,
    draw: outcomes.draw / total,
    awayWin: outcomes.awayWin / total,
  };
}

export function computePoissonOutcomes(
  xGHome: number,
  xGAway: number,
  maxGoals = DEFAULT_MAX_GOALS
): OutcomeProbs {
  const home = poissonSeries(xGHome, maxGoals);
  const away = poissonSeries(xGAway, maxGoals);
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let i = 0; i < home.length; i += 1) {
    for (let j = 0; j < away.length; j += 1) {
      const p = home[i] * away[j];
      if (i > j) homeWin += p;
      else if (i < j) awayWin += p;
      else draw += p;
    }
  }

  return normalizeOutcomes({ homeWin, draw, awayWin });
}

function weightedOutcomeRates(rolling: Rolling, bucketSize: number, weights: number[]) {
  const n = rolling.items.length;
  if (!n) return { win: 0, draw: 0, loss: 0, n: 0 };

  const buckets = Math.max(1, Math.ceil(n / bucketSize));
  let win = 0;
  let draw = 0;
  let loss = 0;
  let weightSum = 0;

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const end = n - bucket * bucketSize;
    const start = Math.max(0, end - bucketSize);
    const slice = rolling.items.slice(start, end);
    if (!slice.length) continue;
    const weight = weights[bucket] ?? weights[weights.length - 1] ?? 1;
    let winCount = 0;
    let drawCount = 0;
    let lossCount = 0;
    slice.forEach((match) => {
      if (match.gf > match.ga) winCount += 1;
      else if (match.gf < match.ga) lossCount += 1;
      else drawCount += 1;
    });
    win += winCount * weight;
    draw += drawCount * weight;
    loss += lossCount * weight;
    weightSum += slice.length * weight;
  }

  if (!weightSum) return { win: 0, draw: 0, loss: 0, n };
  return {
    win: win / weightSum,
    draw: draw / weightSum,
    loss: loss / weightSum,
    n,
  };
}

export function computeEmpiricalOutcomes(
  homeRolling: Rolling,
  awayRolling: Rolling,
  bucketSize: number,
  weights: number[]
): OutcomeProbs | null {
  const homeRates = weightedOutcomeRates(homeRolling, bucketSize, weights);
  const awayRates = weightedOutcomeRates(awayRolling, bucketSize, weights);
  if (!homeRates.n || !awayRates.n) return null;

  const homeWin = (homeRates.win + awayRates.loss) / 2;
  const draw = (homeRates.draw + awayRates.draw) / 2;
  const awayWin = (homeRates.loss + awayRates.win) / 2;

  return normalizeOutcomes({ homeWin, draw, awayWin });
}

export function mixOutcomes(
  poisson: OutcomeProbs,
  empirical: OutcomeProbs | null,
  empiricalWeight = 0.5
): OutcomeProbs {
  if (!empirical) return poisson;
  const weight = Math.max(0, Math.min(1, empiricalWeight));
  const homeWin = poisson.homeWin * (1 - weight) + empirical.homeWin * weight;
  const draw = poisson.draw * (1 - weight) + empirical.draw * weight;
  const awayWin = poisson.awayWin * (1 - weight) + empirical.awayWin * weight;
  return normalizeOutcomes({ homeWin, draw, awayWin });
}

export function getDoubleChanceProbability(outcomes: OutcomeProbs, line: DoubleChanceLine) {
  switch (line) {
    case "1X":
      return outcomes.homeWin + outcomes.draw;
    case "X2":
      return outcomes.awayWin + outcomes.draw;
    case "12":
      return outcomes.homeWin + outcomes.awayWin;
    default:
      return 0;
  }
}

function isDoubleChanceHit(line: DoubleChanceLine, goalsHome: number, goalsAway: number) {
  if (goalsHome === goalsAway) return line !== "12";
  if (goalsHome > goalsAway) return line !== "X2";
  return line !== "1X";
}

function shrink(avg: number, n: number, priorAvg: number, priorN: number) {
  if (!n) return priorAvg;
  return (avg * n + priorAvg * priorN) / (n + priorN);
}

export function computeBacktest(
  fixtures: BacktestFixture[],
  teamId: number | null,
  settings: AlgoSettings
): BacktestResult {
  if (!teamId) return { picks: [] };

  const picks: BacktestPick[] = [];
  const teamHistory = new Map<number, { home: Rolling; away: Rolling }>();
  const leagueHistory = new Map<number, { homeGoals: number; awayGoals: number; matches: number }>();

  const ordered = [...fixtures]
    .filter((fixture) => fixture.date_utc)
    .sort((a, b) => {
      const timeA = a.date_utc ? new Date(a.date_utc).getTime() : 0;
      const timeB = b.date_utc ? new Date(b.date_utc).getTime() : 0;
      return timeA - timeB;
    });

  for (const fixture of ordered) {
    const homeId = Number(fixture.home_team_id);
    const awayId = Number(fixture.away_team_id);
    const goalsHome = Number(fixture.goals_home);
    const goalsAway = Number(fixture.goals_away);
    const leagueId = Number(fixture.competition_id ?? 0);

    if (!Number.isFinite(homeId) || !Number.isFinite(awayId)) continue;
    if (!Number.isFinite(goalsHome) || !Number.isFinite(goalsAway)) continue;

    if (!teamHistory.has(homeId)) {
      teamHistory.set(homeId, { home: createRolling(), away: createRolling() });
    }
    if (!teamHistory.has(awayId)) {
      teamHistory.set(awayId, { home: createRolling(), away: createRolling() });
    }

    if (!leagueHistory.has(leagueId)) {
      leagueHistory.set(leagueId, { homeGoals: 0, awayGoals: 0, matches: 0 });
    }

    const leagueAgg = leagueHistory.get(leagueId)!;
    const leagueHomeAvg =
      leagueAgg.matches >= settings.minLeagueMatches
        ? leagueAgg.homeGoals / leagueAgg.matches
        : BASELINE_HOME;
    const leagueAwayAvg =
      leagueAgg.matches >= settings.minLeagueMatches
        ? leagueAgg.awayGoals / leagueAgg.matches
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
        | { type: "dc"; line: DoubleChanceLine; probability: number }
        | null = null;
      for (const line of settings.lines as MarketLine[]) {
        if (typeof line === "number") {
          const threshold = Math.floor(line);
          const pUnder = poissonCdf(lambda, threshold);
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

      if (bestPick && (homeId === teamId || awayId === teamId)) {
        const totalGoals = goalsHome + goalsAway;
        const hit =
          bestPick.type === "dc"
            ? isDoubleChanceHit(bestPick.line, goalsHome, goalsAway)
            : bestPick.type === "over"
              ? totalGoals > bestPick.line
              : totalGoals <= bestPick.line;
        const isTeamHome = homeId === teamId;
        const homeName = fixture.teams?.name ?? "Home";
        const awayName = fixture.opp?.name ?? "Away";
        const label = `${homeName} vs ${awayName}`;
        const opponent = isTeamHome ? awayName : homeName;
        const score = `${goalsHome}-${goalsAway}`;

        picks.push({
          fixtureId: fixture.id,
          dateUtc: fixture.date_utc,
          dateTime: fixture.date_utc ? new Date(fixture.date_utc).getTime() : 0,
          label,
          opponent,
          pick:
            bestPick.type === "dc"
              ? bestPick.line
              : `${bestPick.type === "over" ? "Over" : "Under"} ${bestPick.line}`,
          probability: bestPick.probability,
          hit,
          totalGoals,
          score,
        });
      }
    }

    addRolling(teamHistory.get(homeId)!.home, goalsHome, goalsAway, settings.windowSize);
    addRolling(teamHistory.get(awayId)!.away, goalsAway, goalsHome, settings.windowSize);
    leagueAgg.homeGoals += goalsHome;
    leagueAgg.awayGoals += goalsAway;
    leagueAgg.matches += 1;
  }

  return { picks };
}
