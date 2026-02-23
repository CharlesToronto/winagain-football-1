"use client";

import { useMemo } from "react";
import { getGoalsForMode, resolveIsHome, type Mode } from "./GoalsScoredTrendCard";

type Fixture = any;
type Focus = "total" | "against";

type RangeDef = {
  key: string;
  label: string;
  min: number;
  max: number | null;
};

type RangeStat = {
  key: string;
  label: string;
  count: number;
  percent: number;
};

type RangeStats = {
  total: number;
  values: RangeStat[];
};

const GOAL_RANGES: RangeDef[] = [
  { key: "0-1", label: "0 - 1", min: 0, max: 1 },
  { key: "2-3", label: "2 - 3", min: 2, max: 3 },
  { key: "4-6", label: "4 - 6", min: 4, max: 6 },
  { key: "7+", label: "7+", min: 7, max: null },
];

const MODE_LABELS: Record<Mode, string> = {
  FT: "Full game",
  HT: "1st half",
  "2H": "2nd half",
};

function inRange(value: number, range: RangeDef) {
  if (range.max == null) return value >= range.min;
  return value >= range.min && value <= range.max;
}

function computeGoalRangeStats(
  fixtures: Fixture[] = [],
  mode: Mode,
  focus: Focus
): RangeStats {
  const totals = (fixtures ?? [])
    .map((fixture) => {
      const goals = getGoalsForMode(fixture, mode);
      if (!goals) return null;
      if (focus === "total") {
        const home = Number(goals.home ?? NaN);
        const away = Number(goals.away ?? NaN);
        if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
        return home + away;
      }
      const isHome = resolveIsHome(fixture);
      if (isHome == null) return null;
      const conceded = isHome ? Number(goals.away ?? NaN) : Number(goals.home ?? NaN);
      return Number.isFinite(conceded) ? conceded : null;
    })
    .filter((value): value is number => value != null);

  const total = totals.length;
  const percent = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0);

  const values = GOAL_RANGES.map((range) => {
    const count = totals.filter((totalGoals) => inRange(totalGoals, range)).length;
    return {
      key: range.key,
      label: range.label,
      count,
      percent: percent(count),
    };
  });

  return { total, values };
}

export default function CardGoalsRange({
  fixtures = [],
  opponentFixtures = [],
  showOpponentComparison,
  mode = "FT",
  showOdds,
  odds,
  focus = "total",
}: {
  fixtures?: Fixture[];
  opponentFixtures?: Fixture[];
  showOpponentComparison?: boolean;
  mode?: Mode;
  showOdds?: boolean;
  odds?: Record<"0-1" | "2-3" | "4-6" | "7+", string> | null;
  focus?: Focus;
}) {
  const teamStats = useMemo(
    () => computeGoalRangeStats(fixtures ?? [], mode, focus),
    [fixtures, mode, focus]
  );
  const opponentStats = useMemo(
    () => computeGoalRangeStats(opponentFixtures ?? [], mode, focus),
    [opponentFixtures, mode, focus]
  );
  const showOpponent = Boolean(showOpponentComparison && opponentStats.total > 0);
  const hasData = teamStats.total > 0;
  const canShowOdds = Boolean(showOdds && mode === "FT" && focus === "total");
  const title = focus === "total" ? "Goal range" : "Goal range encaissés (général)";

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold leading-tight">{title}</h3>
        <span className="text-[11px] text-white/60">{MODE_LABELS[mode]}</span>
      </div>
      {!hasData ? (
        <p className="mt-3 text-xs text-white/70">Aucune donnée de buts disponible sur la série sélectionnée.</p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
            {teamStats.values.map((item, index) => {
              const opponentItem = opponentStats.values[index];
              return (
                <div key={item.key} className="rounded-lg border border-white/5 bg-white/5 px-3 py-2">
                  <div className="text-xs text-white/70">{item.label}</div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xl font-semibold leading-none text-emerald-300 lg:text-[22px]">
                        {item.percent}%
                      </div>
                      <div className="text-[11px] leading-tight text-white/70">
                        ({item.count}/{teamStats.total})
                      </div>
                      {canShowOdds &&
                      odds?.[item.key as "0-1" | "2-3" | "4-6" | "7+"] &&
                      odds[item.key as "0-1" | "2-3" | "4-6" | "7+"] !== "-" ? (
                        <div className="mt-0.5 text-[11px] leading-tight text-pink-300">
                          Odd {odds[item.key as "0-1" | "2-3" | "4-6" | "7+"]}
                        </div>
                      ) : null}
                    </div>
                    {showOpponent && opponentItem ? (
                      <div className="text-right">
                        <div className="text-xl font-semibold leading-none text-blue-300 lg:text-[22px]">
                          {opponentItem.percent}%
                        </div>
                        <div className="text-[11px] leading-tight text-white/60">
                          ({opponentItem.count}/{opponentStats.total})
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
