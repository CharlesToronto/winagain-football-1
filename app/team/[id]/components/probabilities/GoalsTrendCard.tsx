"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Fixture = any;
export type Mode = "FT" | "HT" | "2H";
export type Location = "all" | "home" | "away";

const THEME_GREEN = "#2dd4bf"; // turquoise doux
const THEME_GREEN_DARK = "rgba(45, 212, 191, 0.18)";
const THEME_BLUE = "rgba(255,255,255,0.35)"; // neutre clair pour la moyenne
const THEME_ORANGE = "#60a5fa";
const THEME_ORANGE_LIGHT = "rgba(96, 165, 250, 0.6)";
const THEME_PINK = "#ff4fd8";
const THRESHOLD_OPTIONS = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(n: number) {
  if (Number.isNaN(n)) return "–";
  const rounded = Math.round(n * 100) / 100;
  return rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(2);
}

type Point = {
  x: number;
  y: number;
  label: string;
  value: number;
  tooltip: {
    asOf?: string;
    date?: string;
    opponent?: string;
    score?: string;
  };
};

type ChartStyle = "line" | "bar";

type BarPoint = {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
};

function toPath(points: Point[]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;

  const p = points;
  const d = [];
  d.push(`M ${p[0].x},${p[0].y}`);
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i === 0 ? i : i - 1];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2 < p.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`);
  }
  return d.join(" ");
}

function padValues(values: number[], totalSlots: number) {
  if (totalSlots <= 0) return [];
  if (values.length >= totalSlots) {
    return values.slice(values.length - totalSlots);
  }
  const padding = Array.from({ length: totalSlots - values.length }, () => null);
  return [...padding, ...values];
}

function buildBars(values: Array<number | null>, totalSlots: number) {
  const viewWidth = 100;
  const viewHeight = 100;
  if (!totalSlots) {
    return { bars: [] as (BarPoint | null)[] };
  }
  const slotWidth = viewWidth / totalSlots;
  const barWidth = Math.max(0.8, slotWidth * 0.65);
  const bars = values.map((value, idx) => {
    if (value == null) return null;
    const clamped = clamp(value, 0, 8);
    const height = (clamped / 8) * viewHeight;
    const x = idx * slotWidth + (slotWidth - barWidth) / 2;
    const y = viewHeight - height;
    return {
      x: x + barWidth / 2,
      y,
      width: barWidth,
      height,
      value: clamped,
    };
  });
  return { bars };
}

export function getGoalsForMode(f: Fixture, mode: Mode) {
  if (mode === "HT") {
    const home = f?.goals_home_ht;
    const away = f?.goals_away_ht;
    if (home == null || away == null) return null;
    return { home, away };
  }
  if (mode === "2H") {
    const ftHome = f?.goals_home;
    const ftAway = f?.goals_away;
    const htHome = f?.goals_home_ht;
    const htAway = f?.goals_away_ht;
    if (ftHome == null || ftAway == null || htHome == null || htAway == null) return null;
    return {
      home: Math.max(0, ftHome - htHome),
      away: Math.max(0, ftAway - htAway),
    };
  }
  const home = f?.goals_home;
  const away = f?.goals_away;
  if (home == null || away == null) return null;
  return { home, away };
}

function resolveIsHome(f: Fixture) {
  if (typeof f?.isHome === "boolean") return f.isHome;
  if (typeof f?.home_team_id === "number" && typeof f?.team_id === "number") {
    return f.home_team_id === f.team_id;
  }
  return null;
}

function matchesLocation(isHome: boolean | null, location: Location) {
  if (location === "all") return true;
  if (isHome == null) return false;
  return location === "home" ? isHome : !isHome;
}

export default function GoalsTrendCard({
  fixtures,
  opponentFixtures = [],
  opponentName = "Adversaire",
  referenceCount = 0,
  mode = "FT",
  threshold: controlledThreshold,
  onThresholdChange,
}: {
  fixtures: Fixture[];
  opponentFixtures?: Fixture[];
  opponentName?: string;
  referenceCount?: number;
  mode?: Mode;
  threshold?: number;
  onThresholdChange?: (value: number) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [chartStyle, setChartStyle] = useState<ChartStyle>("line");
  const [showOpponent, setShowOpponent] = useState(false);
  const [location, setLocation] = useState<Location>("all");
  const [localThreshold, setLocalThreshold] = useState(3.5);
  const [isThresholdOpen, setIsThresholdOpen] = useState(false);
  const thresholdRef = useRef<HTMLDivElement | null>(null);
  const isThresholdControlled = typeof controlledThreshold === "number";
  const threshold = typeof controlledThreshold === "number" ? controlledThreshold : localThreshold;

  const setThresholdValue = (value: number) => {
    if (onThresholdChange) onThresholdChange(value);
    if (!isThresholdControlled) {
      setLocalThreshold(value);
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!thresholdRef.current) return;
      if (!thresholdRef.current.contains(event.target as Node)) {
        setIsThresholdOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const pushAsOf = (asOf?: string) => {
    if (!asOf) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("asOf", asOf);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const { points, avg, total } = useMemo(() => {
    const usable = (fixtures ?? [])
      .map((f, idx) => {
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
        const goals = getGoalsForMode(f, mode);
        if (!goals) return null; // on ignore les matchs sans score
        const { home, away } = goals;
        const isHome = resolveIsHome(f);
        if (!matchesLocation(isHome, location)) return null;
        const opponent =
          isHome === null
            ? f.away_team_name ??
              f.home_team_name ??
              f.opp?.name ??
              f.teams?.name
            : isHome
              ? f.away_team_name ?? f.opp?.name
              : f.home_team_name ?? f.teams?.name;
        const score = `${home}-${away}`;
        return {
          date,
          totalGoals: home + away,
          tooltip: {
            asOf,
            date: dateObj ? dateObj.toLocaleDateString("fr-FR") : undefined,
            opponent: opponent ?? undefined,
            score,
          },
          idx,
        };
      })
      .filter((f) => f !== null && f.date !== null)
      .sort((a, b) => (a.date ?? 0) - (b.date ?? 0));

    const totals = usable.map((u) => clamp(u.totalGoals, 0, 8));
    const sum = totals.reduce((acc, v) => acc + v, 0);
    const avg = totals.length ? sum / totals.length : 0;

    const viewW = 100;
    const viewH = 100;
    const pts: Point[] = totals.map((v, i) => ({
      x: totals.length <= 1 ? 0 : (i / (totals.length - 1)) * viewW,
      y: viewH - (clamp(v, 0, 8) / 8) * viewH,
      label: `${i + 1}`,
      value: v,
      tooltip: usable[i]?.tooltip ?? {},
    }));

    return { points: pts, avg, total: totals.length };
  }, [fixtures, mode, location]);

  const viewHeight = 100;
  const viewWidth = 100;
  const avgY = points.length ? viewHeight - (clamp(avg, 0, 8) / 8) * viewHeight : viewHeight;
  const thresholdY =
    viewHeight - (clamp(threshold, 0, 8) / 8) * viewHeight;

  const hoveredPoint = hoverIdx !== null && points[hoverIdx] ? points[hoverIdx] : null;
  const referenceLimit = points.length || referenceCount;
  const opponentSeries = useMemo(() => {
    const usableRaw = (opponentFixtures ?? [])
      .map((f, idx) => {
        const dateRaw =
          (f.fixture && f.fixture.date) ||
          f.date_utc ||
          f.date ||
          f.timestamp ||
          null;
        const dateObj = dateRaw ? new Date(dateRaw) : null;
        const date = dateObj ? dateObj.getTime() : null;
        const goals = getGoalsForMode(f, mode);
        if (!goals) return null;
        const { home, away } = goals;
        const isHome = resolveIsHome(f);
        if (!matchesLocation(isHome, location)) return null;
        return {
          date,
          totalGoals: home + away,
          tooltip: {
            date: dateObj ? dateObj.toLocaleDateString("fr-FR") : undefined,
            score: `${home}-${away}`,
          },
          idx,
        };
      })
      .filter((f) => f !== null && f.date !== null)
      .sort((a, b) => (a.date ?? 0) - (b.date ?? 0));

    const usable =
      referenceLimit > 0 && usableRaw.length > referenceLimit
        ? usableRaw.slice(usableRaw.length - referenceLimit)
        : usableRaw;

    const totals = usable.map((u) => clamp(u.totalGoals, 0, 8));
    const sum = totals.reduce((acc, v) => acc + v, 0);
    const avg = totals.length ? sum / totals.length : 0;

    const viewW = 100;
    const viewH = 100;
    const pts: Point[] = totals.map((v, i) => ({
      x: totals.length <= 1 ? 0 : (i / (totals.length - 1)) * viewW,
      y: viewH - (clamp(v, 0, 8) / 8) * viewH,
      label: `${i + 1}`,
      value: v,
      tooltip: usable[i]?.tooltip ?? {},
    }));

    return { points: pts, avg, total: totals.length };
  }, [opponentFixtures, referenceLimit, mode, location]);

  const hoveredOpponent =
    hoverIdx !== null && opponentSeries.points[hoverIdx]
      ? opponentSeries.points[hoverIdx]
      : null;
  const buttonBaseClass =
    "px-2 py-0.5 text-[11px] rounded-md border border-white/60 whitespace-nowrap shrink-0 transition";
  const activeButtonClass =
    "bg-gradient-to-br from-green-500/30 via-emerald-500/30 to-lime-500/30 border-green-400 text-white";
  const inactiveButtonClass = "bg-white/10 text-white/70 blur-[0.6px]";
  const filterRowClass = `flex items-center gap-2 flex-nowrap pb-1 ${
    isThresholdOpen ? "overflow-visible" : "overflow-x-auto no-scrollbar"
  }`;
  const mainBars = useMemo(
    () => buildBars(points.map((point) => point.value), points.length).bars,
    [points]
  );
  const opponentBars = useMemo(() => {
    const padded = padValues(
      opponentSeries.points.map((point) => point.value),
      points.length
    );
    return buildBars(padded, points.length).bars;
  }, [opponentSeries.points, points.length]);
  const hoveredBar = hoverIdx !== null ? mainBars[hoverIdx] ?? null : null;

  return (
    <div className="bg-white/5 rounded-xl p-6 shadow md:col-span-2 flex flex-col md:h-[20rem] relative">
      <div className="flex flex-col gap-2 mb-4">
        <div>
          <h3 className="font-semibold">Tendance buts (total par match)</h3>
          <p className="text-xs text-white/70">Série de {total} match(s)</p>
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
                onClick={() => setLocation(item.key)}
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
            <span className="whitespace-nowrap">Moyenne</span>
            <div className="relative" ref={thresholdRef}>
              <button
                type="button"
                className="px-3 py-1 rounded-md text-xs font-semibold bg-white/10 text-white border border-white/10 backdrop-blur-sm"
                onClick={() => setIsThresholdOpen((open) => !open)}
                aria-haspopup="listbox"
                aria-expanded={isThresholdOpen}
                aria-label="Moyenne"
              >
                {threshold}
              </button>
              {isThresholdOpen && (
                <div
                  className="absolute left-0 md:left-auto md:right-0 mt-1 min-w-full rounded-md border border-white/10 bg-white/10 text-white backdrop-blur-md shadow-lg z-20"
                  role="listbox"
                  aria-label="Moyenne"
                >
                  {THRESHOLD_OPTIONS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="option"
                      aria-selected={value === threshold}
                      className={`w-full px-3 py-1 text-left text-xs font-semibold ${
                        value === threshold ? "bg-white/20" : "bg-white/0"
                      } hover:bg-white/20`}
                      onClick={() => {
                        setThresholdValue(value);
                        setIsThresholdOpen(false);
                      }}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {([
              { key: "line", label: "Ligne" },
              { key: "bar", label: "Barres" },
            ] as { key: ChartStyle; label: string }[]).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setChartStyle(item.key)}
                className={`${buttonBaseClass} ${
                  chartStyle === item.key ? activeButtonClass : inactiveButtonClass
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="hidden md:inline-flex text-white/30">.</span>
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

      {points.length === 0 ? (
        <p className="text-sm text-white/70">Aucune donnée disponible.</p>
      ) : (
        <div className="relative w-full h-56 md:h-full flex-1 min-h-0 select-none">
          <svg
            viewBox={`0 0 ${viewWidth} ${viewHeight}`}
            preserveAspectRatio="none"
            className="w-full h-full"
          >
            {/* Grille Y 0..8 */}
            {Array.from({ length: 8 }).map((_, idx) => {
              const label = idx + 1;
              const y = viewHeight - (label / 8) * viewHeight;
              return (
                <g key={label}>
                  <line
                    x1={0}
                    y1={y}
                    x2={viewWidth}
                    y2={y}
                    stroke="rgba(255,255,255,0.05)"
                    strokeWidth={0.4}
                  />
                  <text
                    x={-4}
                    y={y + 1.8}
                    fontSize={4}
                    fill="rgba(255,255,255,0.55)"
                  >
                    {label}
                  </text>
                </g>
              );
            })}

            {/* Ligne moyenne */}
            <line
              x1={0}
              y1={avgY}
              x2={viewWidth}
              y2={avgY}
              stroke="rgba(255,255,255,0.7)"
              strokeWidth={0.8}
              strokeDasharray="1 1"
            />
            <line
              x1={0}
              y1={thresholdY}
              x2={viewWidth}
              y2={thresholdY}
              stroke={THEME_PINK}
              strokeWidth={0.6}
            />
            {showOpponent && opponentSeries.points.length > 0 && (
              <line
                x1={0}
                y1={viewHeight - (clamp(opponentSeries.avg, 0, 8) / 8) * viewHeight}
                x2={viewWidth}
                y2={viewHeight - (clamp(opponentSeries.avg, 0, 8) / 8) * viewHeight}
                stroke={THEME_ORANGE_LIGHT}
                strokeWidth={0.4}
                strokeDasharray="1 1"
              />
            )}

            {chartStyle === "line" ? (
              <>
                {/* Zone + courbe lissée */}
                <defs>
                  <linearGradient id="goalsLineSmooth" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={THEME_GREEN} stopOpacity="0.6" />
                    <stop offset="100%" stopColor={THEME_GREEN} stopOpacity="0.05" />
                  </linearGradient>
                </defs>

                <path
                  d={`${toPath(points)} L ${viewWidth},${viewHeight} L 0,${viewHeight} Z`}
                  fill="url(#goalsLineSmooth)"
                  opacity="0.6"
                />
                <path
                  d={toPath(points)}
                  fill="none"
                  stroke={THEME_GREEN}
                  strokeWidth={0.4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />

                {showOpponent && opponentSeries.points.length > 0 && (
                  <>
                    <defs>
                      <linearGradient id="opponentLineSmooth" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={THEME_ORANGE} stopOpacity="0.35" />
                        <stop offset="100%" stopColor={THEME_ORANGE} stopOpacity="0.05" />
                      </linearGradient>
                    </defs>
                    <path
                      d={`${toPath(opponentSeries.points)} L ${viewWidth},${viewHeight} L 0,${viewHeight} Z`}
                      fill="url(#opponentLineSmooth)"
                      opacity="0.5"
                    />
                    <path
                      d={toPath(opponentSeries.points)}
                      fill="none"
                      stroke={THEME_ORANGE}
                      strokeWidth={0.4}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </>
                )}

                {/* Points invisibles pour le hover */}
                {points.map((p, idx) => (
                  <circle
                    key={`main-${idx}`}
                    cx={p.x}
                    cy={p.y}
                    r={2.2}
                    fill="transparent"
                    stroke="transparent"
                  />
                ))}
                {showOpponent &&
                  opponentSeries.points.map((p, idx) => (
                    <circle
                      key={`opp-${idx}`}
                      cx={p.x}
                      cy={p.y}
                      r={2.2}
                      fill="transparent"
                      stroke="transparent"
                    />
                  ))}
              </>
            ) : (
              <>
                <defs>
                  <linearGradient id="goalsBars" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={THEME_GREEN} stopOpacity="0.9" />
                    <stop offset="100%" stopColor={THEME_GREEN} stopOpacity="0.15" />
                  </linearGradient>
                  <linearGradient id="opponentBars" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={THEME_ORANGE} stopOpacity="0.7" />
                    <stop offset="100%" stopColor={THEME_ORANGE} stopOpacity="0.12" />
                  </linearGradient>
                </defs>

                {hoveredBar && (
                  <rect
                    x={hoveredBar.x - hoveredBar.width / 2}
                    y={0}
                    width={hoveredBar.width}
                    height={viewHeight}
                    fill={THEME_GREEN_DARK}
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
                        fill="url(#opponentBars)"
                        opacity={0.5}
                        rx={0.6}
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
                      fill="url(#goalsBars)"
                      rx={0.6}
                    />
                  ) : null
                )}
              </>
            )}
          </svg>

          {/* Overlay hover */}
          <div
            className="absolute inset-0 cursor-pointer"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * viewWidth;
              let nearest = 0;
              let best = Infinity;
              points.forEach((p, idx) => {
                const dist = Math.abs(p.x - x);
                if (dist < best) {
                  best = dist;
                  nearest = idx;
                }
              });
              setHoverIdx(nearest);
            }}
            onMouseLeave={() => setHoverIdx(null)}
            onClick={(e) => {
              if (!points.length) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * viewWidth;
              let nearest = 0;
              let best = Infinity;
              points.forEach((p, idx) => {
                const dist = Math.abs(p.x - x);
                if (dist < best) {
                  best = dist;
                  nearest = idx;
                }
              });
              const target = points[nearest];
              if (target?.tooltip?.asOf) {
                pushAsOf(target.tooltip.asOf);
              }
            }}
          />

          {hoveredPoint && (
            <div
              className="absolute px-3 py-2 bg-black/70 text-white text-xs rounded-lg border border-white/10"
              style={{
                left: `${(hoveredPoint.x / viewWidth) * 100}%`,
                top: `${(hoveredPoint.y / viewHeight) * 100}%`,
                transform: "translate(-50%, -110%)",
                pointerEvents: "none",
                whiteSpace: "nowrap",
              }}
            >
              <div className="font-semibold">
                Match {hoverIdx !== null ? hoverIdx + 1 : ""}
              </div>
              {hoveredPoint.tooltip.date && (
                <div className="opacity-80">{hoveredPoint.tooltip.date}</div>
              )}
              {hoveredPoint.tooltip.opponent && (
                <div className="opacity-80">vs {hoveredPoint.tooltip.opponent}</div>
              )}
              {hoveredPoint.tooltip.score && (
                <div className="opacity-80">Score : {hoveredPoint.tooltip.score}</div>
              )}
              <div className="mt-1 text-green-300">
                Total buts : {formatNumber(hoveredPoint.value)}
              </div>
              {showOpponent && hoveredOpponent && (
                <div className="mt-1 text-blue-300">
                  Adversaire : {formatNumber(hoveredOpponent.value)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 text-xs text-white/70">
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-green-400 inline-block" />
          <span>Total buts par match</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-blue-400 inline-block" />
          <span>Moyenne ({formatNumber(avg)})</span>
        </div>
        {showOpponent && (
          <>
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-blue-400 inline-block" />
              <span>{opponentName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-blue-200 inline-block" />
              <span>Moyenne {opponentName} ({formatNumber(opponentSeries.avg)})</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
