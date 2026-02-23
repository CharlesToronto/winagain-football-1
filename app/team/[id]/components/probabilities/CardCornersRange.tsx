"use client";

import { useMemo } from "react";
import { resolveIsHome } from "./GoalsScoredTrendCard";

type Fixture = any;

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

const CORNER_RANGES: RangeDef[] = [
  { key: "0-3", label: "0 - 3", min: 0, max: 3 },
  { key: "4-6", label: "4 - 6", min: 4, max: 6 },
  { key: "7-9", label: "7 - 9", min: 7, max: 9 },
  { key: "10+", label: "10+", min: 10, max: null },
];

function readNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveCornerPair(fixture: Fixture): { home: number; away: number } | null {
  const candidates: Array<{ home: unknown; away: unknown }> = [
    { home: fixture?.corners_home, away: fixture?.corners_away },
    { home: fixture?.home_corners, away: fixture?.away_corners },
    { home: fixture?.cornersHome, away: fixture?.cornersAway },
    { home: fixture?.corners?.home, away: fixture?.corners?.away },
    { home: fixture?.statistics?.corners?.home, away: fixture?.statistics?.corners?.away },
    { home: fixture?.stats?.corners?.home, away: fixture?.stats?.corners?.away },
  ];

  for (const candidate of candidates) {
    const home = readNumber(candidate.home);
    const away = readNumber(candidate.away);
    if (home == null || away == null) continue;
    return { home, away };
  }

  return null;
}

function resolveTeamCorners(fixture: Fixture): number | null {
  const directCandidates = [
    fixture?.team_corners,
    fixture?.corners_for,
    fixture?.cornersTeam,
    fixture?.corners?.for,
  ];
  for (const candidate of directCandidates) {
    const value = readNumber(candidate);
    if (value != null) return value;
  }

  const isHome = resolveIsHome(fixture);
  if (isHome == null) return null;
  const corners = resolveCornerPair(fixture);
  if (!corners) return null;
  return isHome ? corners.home : corners.away;
}

function inRange(value: number, range: RangeDef) {
  if (range.max == null) return value >= range.min;
  return value >= range.min && value <= range.max;
}

function computeCornerRangeStats(fixtures: Fixture[] = []): RangeStats {
  const corners = (fixtures ?? [])
    .map((fixture) => resolveTeamCorners(fixture))
    .filter((value): value is number => value != null);

  const total = corners.length;
  const percent = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0);

  const values = CORNER_RANGES.map((range) => {
    const count = corners.filter((cornerCount) => inRange(cornerCount, range)).length;
    return {
      key: range.key,
      label: range.label,
      count,
      percent: percent(count),
    };
  });

  return { total, values };
}

export default function CardCornersRange({
  fixtures = [],
  opponentFixtures = [],
  showOpponentComparison,
}: {
  fixtures?: Fixture[];
  opponentFixtures?: Fixture[];
  showOpponentComparison?: boolean;
}) {
  const teamStats = useMemo(() => computeCornerRangeStats(fixtures ?? []), [fixtures]);
  const opponentStats = useMemo(
    () => computeCornerRangeStats(opponentFixtures ?? []),
    [opponentFixtures]
  );
  const showOpponent = Boolean(showOpponentComparison && opponentStats.total > 0);
  const hasAnyData = teamStats.total > 0 || showOpponent;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold leading-tight">Fourchette corners</h3>
        <span className="text-[11px] text-white/60">Full game</span>
      </div>
      {!hasAnyData ? (
        <p className="mt-3 text-xs text-white/70">
          Données corners non disponibles dans les fixtures chargées (champs corners_home / corners_away absents).
        </p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {teamStats.values.map((item, index) => {
              const opponentItem = opponentStats.values[index];
              return (
                <div key={item.key} className="rounded-lg border border-white/5 bg-white/5 px-3 py-2">
                  <div className="text-xs text-white/70">{item.label}</div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xl font-semibold leading-none text-emerald-300 lg:text-[22px]">
                        {teamStats.total > 0 ? `${item.percent}%` : "--"}
                      </div>
                      <div className="text-[11px] leading-tight text-white/70">
                        ({item.count}/{teamStats.total})
                      </div>
                    </div>
                    {showOpponent && opponentItem ? (
                      <div className="text-right">
                        <div className="text-xl font-semibold leading-none text-blue-300 lg:text-[22px]">
                          {`${opponentItem.percent}%`}
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
          <p className="mt-2 text-xs text-white/60">
            Basé sur {teamStats.total} match(s) pour l'équipe
            {showOpponent ? ` et ${opponentStats.total} pour l'adversaire.` : "."}
          </p>
        </>
      )}
    </div>
  );
}
