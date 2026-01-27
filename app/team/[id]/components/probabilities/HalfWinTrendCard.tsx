"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Fixture = any;
type Location = "all" | "home" | "away";
const THEME_GREEN = "#2dd4bf";
const THEME_GREEN_DARK = "rgba(45, 212, 191, 0.18)";
const THEME_ORANGE = "#60a5fa";
const THEME_GRAY = "rgba(148, 163, 184, 0.9)";
const THEME_GRAY_LIGHT = "rgba(148, 163, 184, 0.2)";

const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 100;
const MAX_VALUE = 2;
const MIN_VALUE = -2;
const MAX_ABS = 2;
const ZERO_BAR_HEIGHT = VIEW_HEIGHT * 0.08;

type Point = {
  x: number;
  y: number;
  label: string;
  value: number;
  tooltip: {
    asOf?: string;
    date?: string;
    opponent?: string;
    halves?: string;
    winAny?: boolean;
    firstResult?: number;
    secondResult?: number;
    winCount?: number;
    lossCount?: number;
    drawCount?: number;
  };
};

type BarPoint = {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  isNegative: boolean;
  isZero?: boolean;
};

type MatchEntry = {
  date: number;
  firstResult: number;
  secondResult: number;
  winCount: number;
  lossCount: number;
  drawCount: number;
  winDisplay: number | null;
  lossDisplay: number | null;
  neutral: boolean;
  tooltip: Point["tooltip"];
  winAny: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function valueToY(value: number) {
  const clamped = clamp(value, MIN_VALUE, MAX_VALUE);
  const ratio = (MAX_VALUE - clamped) / (MAX_VALUE - MIN_VALUE);
  return ratio * VIEW_HEIGHT;
}

function resolveIsHome(fixture: Fixture, teamId?: number | null) {
  if (typeof fixture?.isHome === "boolean") return fixture.isHome;
  if (Number.isFinite(teamId)) {
    const homeId = fixture?.home_team_id;
    if (typeof homeId === "number") return homeId === teamId;
  }
  return null;
}

function matchesLocation(isHome: boolean | null, location: Location) {
  if (location === "all") return true;
  if (isHome == null) return false;
  return location === "home" ? isHome : !isHome;
}

function resolveHalfGoals(fixture: Fixture, isHome: boolean) {
  const htHome = fixture?.goals_home_ht;
  const htAway = fixture?.goals_away_ht;
  const ftHome = fixture?.goals_home;
  const ftAway = fixture?.goals_away;
  if (htHome == null || htAway == null || ftHome == null || ftAway == null) {
    return null;
  }
  if (ftHome < htHome || ftAway < htAway) return null;

  const firstTeam = isHome ? htHome : htAway;
  const firstOpp = isHome ? htAway : htHome;
  const secondTeam = isHome ? ftHome - htHome : ftAway - htAway;
  const secondOpp = isHome ? ftAway - htAway : ftHome - htHome;

  return {
    first: { team: firstTeam, opp: firstOpp },
    second: { team: Math.max(0, secondTeam), opp: Math.max(0, secondOpp) },
  };
}

function buildBarsFromMatches(matches: MatchEntry[]) {
  if (!matches.length) {
    return { bars: [] as BarPoint[] };
  }
  const slotWidth = VIEW_WIDTH / matches.length;
  const maxBarWidth = Math.min(16, slotWidth * 0.6);
  const minBarWidth = Math.min(0.6, maxBarWidth);
  const barWidth = clamp(slotWidth * 0.32, minBarWidth, maxBarWidth);
  const midY = valueToY(0);
  const halfHeight = VIEW_HEIGHT / 2;
  const bars: BarPoint[] = [];

  matches.forEach((match, idx) => {
    const centerX = idx * slotWidth + slotWidth / 2;
    const bothDraw = match.neutral;

    if (bothDraw) {
      const height = ZERO_BAR_HEIGHT;
      bars.push({
        x: centerX,
        y: midY - height / 2,
        width: barWidth,
        height,
        value: 0,
        isNegative: false,
        isZero: true,
      });
      return;
    }

    const pushBar = (value: number, x: number) => {
      const clamped = clamp(value, MIN_VALUE, MAX_VALUE);
      const isNegative = clamped < 0;
      const height = (Math.abs(clamped) / MAX_ABS) * halfHeight;
      const y = isNegative ? midY : midY - height;
      bars.push({
        x,
        y,
        width: barWidth,
        height,
        value: clamped,
        isNegative,
      });
    };

    const hasWin = match.winDisplay != null;
    const hasLoss = match.lossDisplay != null;
    const winX = centerX;
    const lossX = centerX;

    if (hasWin && match.winDisplay != null) {
      pushBar(match.winDisplay, winX);
    }
    if (hasLoss && match.lossDisplay != null) {
      pushBar(-match.lossDisplay, lossX);
    }
  });

  return { bars };
}

function formatScore(value: number) {
  if (!Number.isFinite(value)) return "--";
  const rounded = Math.round(value * 10) / 10;
  const label = rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(1);
  return rounded > 0 ? `+${label}` : label;
}

function buildSeries(
  fixtures: Fixture[] = [],
  location: Location,
  teamId?: number | null,
  limit?: number
) {
  const mapped: MatchEntry[] = fixtures
    .map((f) => {
      const asOf =
        typeof f?.date_utc === "string"
          ? f.date_utc
          : typeof f?.fixture?.date === "string"
            ? f.fixture.date
            : typeof f?.date === "string"
              ? f.date
              : undefined;
      const dateRaw =
        (f.fixture && f.fixture.date) ||
        f.date_utc ||
        f.date ||
        f.timestamp ||
        null;
      const dateObj = dateRaw ? new Date(dateRaw) : null;
      const date = dateObj ? dateObj.getTime() : null;
      if (date == null) return null;
      const isHome = resolveIsHome(f, teamId);
      if (!matchesLocation(isHome, location)) return null;
      if (isHome == null) return null;
      const halves = resolveHalfGoals(f, isHome);
      if (!halves) return null;

      const firstResult =
        halves.first.team > halves.first.opp
          ? 1
          : halves.first.team < halves.first.opp
            ? -1
            : 0;
      const secondResult =
        halves.second.team > halves.second.opp
          ? 1
          : halves.second.team < halves.second.opp
            ? -1
            : 0;
      const winCount = (firstResult === 1 ? 1 : 0) + (secondResult === 1 ? 1 : 0);
      const lossCount =
        (firstResult === -1 ? 1 : 0) + (secondResult === -1 ? 1 : 0);
      const drawCount =
        (firstResult === 0 ? 1 : 0) + (secondResult === 0 ? 1 : 0);
      const neutral = winCount === 0 && lossCount === 0;
      const winAny = winCount > 0;
      const winDisplay = winCount > 0 ? winCount : null;
      const lossDisplay = lossCount > 0 ? lossCount : null;

      const opponent =
        isHome === null
          ? f.away_team_name ??
            f.home_team_name ??
            f.opp?.name ??
            f.teams?.name
          : isHome
            ? f.away_team_name ?? f.opp?.name
            : f.home_team_name ?? f.teams?.name;

      const halvesLabel = `HT ${halves.first.team}-${halves.first.opp} | 2H ${halves.second.team}-${halves.second.opp}`;

      return {
        date,
        firstResult,
        secondResult,
        winCount,
        lossCount,
        drawCount,
        winDisplay,
        lossDisplay,
        neutral,
        winAny,
        tooltip: {
          asOf,
          date: dateObj ? dateObj.toLocaleDateString("fr-FR") : undefined,
          opponent: opponent ?? undefined,
          halves: halvesLabel,
          winAny,
          firstResult,
          secondResult,
          winCount,
          lossCount,
          drawCount,
        },
      };
    })
    .filter((entry) => entry !== null && entry.date !== null)
    .sort((a, b) => (a?.date ?? 0) - (b?.date ?? 0));

  const usable =
    limit && mapped.length > limit ? mapped.slice(mapped.length - limit) : mapped;

  const winAnyCount = usable.filter((entry) => entry?.winAny).length;
  const winAnyPercent = usable.length
    ? Math.round((winAnyCount / usable.length) * 100)
    : 0;

  return { matches: usable, total: usable.length, winAnyPercent };
}

function formatHalfResult(value?: number) {
  if (value == null) return "--";
  if (value === 1) return "Gagnée";
  if (value === -1) return "Perdue";
  return "Nulle";
}

export default function HalfWinTrendCard({
  fixtures,
  opponentFixtures = [],
  opponentName = "Adversaire",
  referenceCount = 0,
  teamId,
  location: controlledLocation,
  onLocationChange,
}: {
  fixtures: Fixture[];
  opponentFixtures?: Fixture[];
  opponentName?: string;
  referenceCount?: number;
  teamId?: number | null;
  location?: Location;
  onLocationChange?: (value: Location) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showOpponent, setShowOpponent] = useState(false);
  const [localLocation, setLocalLocation] = useState<Location>("all");
  const isLocationControlled = controlledLocation != null;
  const location = controlledLocation ?? localLocation;
  const handleLocationChange = (value: Location) => {
    if (onLocationChange) onLocationChange(value);
    if (!isLocationControlled) {
      setLocalLocation(value);
    }
  };
  const pushAsOf = (asOf?: string) => {
    if (!asOf) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("asOf", asOf);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const series = useMemo(
    () => buildSeries(fixtures ?? [], location, teamId),
    [fixtures, location, teamId]
  );
  const displayTotal =
    referenceCount && referenceCount > 0 ? referenceCount : series.total;
  const referenceLimit = series.matches.length || referenceCount;
  const opponentSeries = useMemo(
    () => buildSeries(opponentFixtures ?? [], location, undefined, referenceLimit),
    [opponentFixtures, location, referenceLimit]
  );

  const matchCount = series.matches.length;
  const slotWidth = matchCount ? VIEW_WIDTH / matchCount : 0;
  const hoveredSlot =
    hoverIdx !== null && slotWidth
      ? { x: hoverIdx * slotWidth, width: slotWidth }
      : null;
  const mainBars = useMemo(
    () => buildBarsFromMatches(series.matches).bars,
    [series.matches]
  );
  const opponentBars = useMemo(
    () => buildBarsFromMatches(opponentSeries.matches).bars,
    [opponentSeries.matches]
  );

  const hoveredMatch =
    hoverIdx !== null && series.matches[hoverIdx] ? series.matches[hoverIdx] : null;
  const hoveredOpponentMatch =
    hoverIdx !== null && opponentSeries.matches[hoverIdx]
      ? opponentSeries.matches[hoverIdx]
      : null;

  const buttonBaseClass =
    "px-2 py-0.5 text-[11px] rounded-md border border-white/60 whitespace-nowrap shrink-0 transition";
  const activeButtonClass =
    "bg-gradient-to-br from-green-500/30 via-emerald-500/30 to-lime-500/30 border-green-400 text-white";
  const inactiveButtonClass = "bg-white/10 text-white/70 blur-[0.6px]";
  const filterRowClass =
    "flex items-center gap-2 flex-nowrap pb-1 overflow-x-auto no-scrollbar";
  const winAnyLabel = series.total ? `${series.winAnyPercent}%` : "--";
  const midLineY = valueToY(0);
  const hoverCenterX =
    hoveredSlot != null ? hoveredSlot.x + hoveredSlot.width / 2 : 0;

  return (
    <div className="bg-white/5 rounded-xl p-6 shadow flex flex-col md:h-[20rem] relative">
      <div className="flex flex-col gap-2 mb-4">
        <div>
          <h3 className="font-semibold">Tendance mi-temps gagnée</h3>
          <p className="text-xs text-white/70">
            Série de {displayTotal} match(s)
          </p>
        </div>
        <div className={filterRowClass}>
          <div className="flex items-center gap-2 shrink-0">
            {([
              { key: "all", label: "General" },
              { key: "home", label: "Home" },
              { key: "away", label: "Away" },
            ] as { key: Location; label: string }[]).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => handleLocationChange(item.key)}
                className={`${buttonBaseClass} ${
                  location === item.key ? activeButtonClass : inactiveButtonClass
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="hidden md:inline-flex text-white/30">.</span>
          <div className="flex items-center gap-2 text-xs text-white/70 shrink-0 md:absolute md:top-6 md:right-6 md:z-10">
            <span className="whitespace-nowrap">Mi-temps gagnées</span>
            <span className="px-3 py-1 rounded-md text-xs font-semibold bg-white/10 text-white border border-white/10 backdrop-blur-sm">
              {winAnyLabel}
            </span>
          </div>
          <button
            onClick={() => setShowOpponent((v) => !v)}
            disabled={!opponentFixtures || opponentFixtures.length === 0}
            className={`${buttonBaseClass} ${
              showOpponent ? "bg-blue-500/30 border-blue-400 text-white" : inactiveButtonClass
            } ${
              !opponentFixtures || opponentFixtures.length === 0
                ? "opacity-40 cursor-not-allowed"
                : ""
            }`}
          >
            Adversaire
          </button>
        </div>
      </div>
      {matchCount === 0 ? (
        <p className="text-sm text-white/70">Aucune donnée disponible.</p>
      ) : (
        <div className="relative w-full h-56 md:h-full flex-1 min-h-0 select-none">
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            className="w-full h-full"
          >
            {[-2, -1, 0, 1, 2].map((value) => {
              const y = valueToY(value);
              return (
                <g key={`grid-${value}`}>
                  <line
                    x1={0}
                    y1={y}
                    x2={VIEW_WIDTH}
                    y2={y}
                    stroke="rgba(255,255,255,0.05)"
                    strokeWidth={0.4}
                  />
                  <text
                    x={-8}
                    y={y + 1.8}
                    fontSize={4}
                    fill="rgba(255,255,255,0.55)"
                  >
                    {formatScore(value)}
                  </text>
                </g>
              );
            })}

            <line
              x1={0}
              y1={midLineY}
              x2={VIEW_WIDTH}
              y2={midLineY}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={0.6}
            />

            <defs>
              <linearGradient id="halfWinBars" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={THEME_GREEN} stopOpacity="0.9" />
                <stop offset="100%" stopColor={THEME_GREEN} stopOpacity="0.15" />
              </linearGradient>
              <linearGradient id="opponentHalfWinBars" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={THEME_ORANGE} stopOpacity="0.7" />
                <stop offset="100%" stopColor={THEME_ORANGE} stopOpacity="0.12" />
              </linearGradient>
            </defs>

            {hoveredSlot && (
              <rect
                x={hoveredSlot.x}
                y={0}
                width={hoveredSlot.width}
                height={VIEW_HEIGHT}
                fill={THEME_GREEN_DARK}
                opacity={0.5}
              />
            )}

            {showOpponent &&
              opponentBars.map((bar, idx) =>
                bar ? (
                  <rect
                    key={`opp-bar-${idx}`}
                    x={bar.x - bar.width / 2}
                    y={bar.y}
                    width={bar.width}
                    height={bar.height}
                    fill={
                      bar.isZero
                        ? THEME_GRAY_LIGHT
                        : bar.isNegative
                          ? THEME_GRAY_LIGHT
                          : "url(#opponentHalfWinBars)"
                    }
                    opacity={0.5}
                    rx={Math.min(0.6, bar.width / 2)}
                  />
                ) : null
              )}

            {mainBars.map((bar, idx) =>
              bar ? (
                <rect
                  key={`main-bar-${idx}`}
                  x={bar.x - bar.width / 2}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  fill={
                    bar.isZero
                      ? THEME_GRAY
                      : bar.isNegative
                        ? THEME_GRAY
                        : "url(#halfWinBars)"
                  }
                  rx={Math.min(0.6, bar.width / 2)}
                />
              ) : null
            )}
          </svg>

          <div
            className="absolute inset-0 cursor-pointer"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * VIEW_WIDTH;
              if (!matchCount) return;
              const idx =
                matchCount <= 1
                  ? 0
                  : Math.round((x / VIEW_WIDTH) * (matchCount - 1));
              const bounded = Math.max(0, Math.min(matchCount - 1, idx));
              setHoverIdx(bounded);
            }}
            onMouseLeave={() => setHoverIdx(null)}
            onClick={(e) => {
              if (!matchCount) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * VIEW_WIDTH;
              const idx =
                matchCount <= 1
                  ? 0
                  : Math.round((x / VIEW_WIDTH) * (matchCount - 1));
              const bounded = Math.max(0, Math.min(matchCount - 1, idx));
              const target = series.matches[bounded];
              if (target?.tooltip?.asOf) {
                pushAsOf(target.tooltip.asOf);
              }
            }}
          />

          {hoveredMatch && (
            <div
              className="absolute px-3 py-2 bg-black/70 text-white text-xs rounded-lg border border-white/10"
              style={{
                left: `${(hoverCenterX / VIEW_WIDTH) * 100}%`,
                top: `${(midLineY / VIEW_HEIGHT) * 100}%`,
                transform: "translate(-50%, -110%)",
                pointerEvents: "none",
                whiteSpace: "nowrap",
              }}
            >
              <div className="font-semibold">
                Match {hoverIdx !== null ? hoverIdx + 1 : ""}
              </div>
              {hoveredMatch.tooltip.date && (
                <div className="opacity-80">{hoveredMatch.tooltip.date}</div>
              )}
              {hoveredMatch.tooltip.opponent && (
                <div className="opacity-80">vs {hoveredMatch.tooltip.opponent}</div>
              )}
              {hoveredMatch.tooltip.halves && (
                <div className="opacity-80">{hoveredMatch.tooltip.halves}</div>
              )}
              <div className="mt-1 text-green-300">
                1re mi-temps : {formatHalfResult(hoveredMatch.tooltip.firstResult)}
              </div>
              <div className="text-green-300">
                2e mi-temps : {formatHalfResult(hoveredMatch.tooltip.secondResult)}
              </div>
              <div className="mt-1 text-white/70">
                Gagnées : {hoveredMatch.winCount} | Perdues : {hoveredMatch.lossCount} | Nulles :{" "}
                {hoveredMatch.drawCount}
              </div>
              {showOpponent && hoveredOpponentMatch && (
                <div className="mt-1 text-blue-300">
                  {opponentName} HT :{" "}
                  {formatHalfResult(hoveredOpponentMatch.tooltip.firstResult)} | 2H :{" "}
                  {formatHalfResult(hoveredOpponentMatch.tooltip.secondResult)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showOpponent && opponentSeries.matches.length > 0 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-white/70">
          <span className="w-3 h-0.5 bg-blue-400 inline-block" />
          <span>{opponentName}</span>
        </div>
      )}
    </div>
  );
}
