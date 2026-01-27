"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getGoalsForMode,
  resolveIsHome,
  type Mode,
} from "./GoalsScoredTrendCard";
import type { GoalFocus } from "./CardOverUnderTeam";

type Fixture = any;

const MAX_GOALS = 8;
const THEME_GREEN = "#2dd4bf";
const THEME_BLUE = "rgba(255,255,255,0.35)";
const THEME_ORANGE = "#60a5fa";
const THEME_ORANGE_LIGHT = "rgba(96, 165, 250, 0.6)";
const THEME_PINK = "#ff4fd8";
const THRESHOLD_OPTIONS = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(n: number) {
  if (Number.isNaN(n)) return "--";
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

function buildSeries(fixtures: Fixture[], mode: Mode, focus: GoalFocus) {
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
      if (!goals) return null;
      const isHome = resolveIsHome(f);
      if (isHome == null) return null;
      const opponent = isHome
        ? f.away_team_name ?? f.opp?.name
        : f.home_team_name ?? f.teams?.name;
      const scored = isHome ? goals.home : goals.away;
      const conceded = isHome ? goals.away : goals.home;
      const value = focus === "for" ? scored : conceded;
      if (typeof value !== "number") return null;
      return {
        date,
        value,
        tooltip: {
          asOf,
          date: dateObj ? dateObj.toLocaleDateString("fr-FR") : undefined,
          opponent: opponent ?? undefined,
          score: `${goals.home}-${goals.away}`,
        },
        idx,
      };
    })
    .filter((f) => f !== null && f.date !== null)
    .sort((a, b) => (a.date ?? 0) - (b.date ?? 0));

  const values = usable.map((u) => clamp(u.value, 0, MAX_GOALS));
  const sum = values.reduce((acc, v) => acc + v, 0);
  const avg = values.length ? sum / values.length : 0;

  const viewW = 100;
  const viewH = 100;
  const points: Point[] = values.map((v, i) => ({
    x: values.length <= 1 ? 0 : (i / (values.length - 1)) * viewW,
    y: viewH - (clamp(v, 0, MAX_GOALS) / MAX_GOALS) * viewH,
    label: `${i + 1}`,
    value: v,
    tooltip: usable[i]?.tooltip ?? {},
  }));

  return { points, avg, total: values.length };
}

export default function TeamGoalsTrendCard({
  fixtures,
  opponentFixtures = [],
  opponentName = "Adversaire",
  referenceCount = 0,
  mode = "FT",
  threshold: controlledThreshold,
  onThresholdChange,
  teamName,
  goalFocus: controlledGoalFocus,
  onGoalFocusChange,
  showOpponentComparison,
}: {
  fixtures: Fixture[];
  opponentFixtures?: Fixture[];
  opponentName?: string;
  referenceCount?: number;
  mode?: Mode;
  threshold?: number;
  onThresholdChange?: (value: number) => void;
  teamName?: string | null;
  goalFocus?: GoalFocus;
  onGoalFocusChange?: (value: GoalFocus) => void;
  showOpponentComparison?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showOpponent, setShowOpponent] = useState(false);
  const [localThreshold, setLocalThreshold] = useState(3.5);
  const [isThresholdOpen, setIsThresholdOpen] = useState(false);
  const [localGoalFocus, setLocalGoalFocus] = useState<GoalFocus>("for");
  const thresholdRef = useRef<HTMLDivElement | null>(null);
  const isThresholdControlled = typeof controlledThreshold === "number";
  const threshold =
    typeof controlledThreshold === "number" ? controlledThreshold : localThreshold;
  const isGoalFocusControlled = typeof controlledGoalFocus === "string";
  const goalFocus = controlledGoalFocus ?? localGoalFocus;

  const setThresholdValue = (value: number) => {
    if (onThresholdChange) onThresholdChange(value);
    if (!isThresholdControlled) {
      setLocalThreshold(value);
    }
  };

  const setGoalFocus = (value: GoalFocus) => {
    if (onGoalFocusChange) onGoalFocusChange(value);
    if (!isGoalFocusControlled) {
      setLocalGoalFocus(value);
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

  useEffect(() => {
    setHoverIdx(null);
  }, [fixtures, mode, goalFocus]);

  useEffect(() => {
    if (!showOpponentComparison) {
      setShowOpponent(false);
    }
  }, [showOpponentComparison]);

  const pushAsOf = (asOf?: string) => {
    if (!asOf) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("asOf", asOf);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const { points, avg, total } = useMemo(
    () => buildSeries(fixtures ?? [], mode, goalFocus),
    [fixtures, mode, goalFocus]
  );

  const opponentSeries = useMemo(() => {
    if (!showOpponentComparison) {
      return { points: [], avg: 0, total: 0 };
    }
    const series = buildSeries(opponentFixtures ?? [], mode, goalFocus);
    if (referenceCount > 0 && series.points.length > referenceCount) {
      const start = series.points.length - referenceCount;
      const limitedPoints = series.points.slice(start);
      const limitedValues = limitedPoints.map((p) => clamp(p.value, 0, MAX_GOALS));
      const sum = limitedValues.reduce((acc, v) => acc + v, 0);
      const avg = limitedValues.length ? sum / limitedValues.length : 0;
      return { points: limitedPoints, avg, total: limitedPoints.length };
    }
    return series;
  }, [opponentFixtures, referenceCount, mode, goalFocus, showOpponentComparison]);

  const viewHeight = 100;
  const viewWidth = 100;
  const avgY =
    points.length > 0
      ? viewHeight - (clamp(avg, 0, MAX_GOALS) / MAX_GOALS) * viewHeight
      : viewHeight;
  const thresholdY =
    viewHeight - (clamp(threshold, 0, MAX_GOALS) / MAX_GOALS) * viewHeight;

  const hoveredPoint = hoverIdx !== null && points[hoverIdx] ? points[hoverIdx] : null;
  const hoveredOpponent =
    hoverIdx !== null && opponentSeries.points[hoverIdx]
      ? opponentSeries.points[hoverIdx]
      : null;
  const resolvedTeamName = teamName && teamName.trim() ? teamName : "Équipe";
  const showOpponentAllowed =
    Boolean(showOpponentComparison && opponentFixtures?.length);
  const buttonBaseClass =
    "px-2 py-0.5 text-[11px] rounded-md border border-white/60 whitespace-nowrap shrink-0 transition";
  const activeButtonClass =
    "bg-gradient-to-br from-green-500/30 via-emerald-500/30 to-lime-500/30 border-green-400 text-white";
  const inactiveButtonClass = "bg-white/10 text-white/70 blur-[0.6px]";
  const filterRowClass = `flex items-center gap-2 flex-nowrap pb-1 ${
    isThresholdOpen ? "overflow-visible" : "overflow-x-auto no-scrollbar"
  }`;
  const focusLabel = goalFocus === "for" ? "Buts marqués" : "Buts encaissés";

  return (
    <div className="bg-sky-400/10 backdrop-blur-sm rounded-xl p-6 shadow md:col-span-2 flex flex-col md:h-[20rem]">
      <div className="flex flex-col gap-2 mb-4">
        <div>
          <h3 className="font-semibold">Tendance buts {resolvedTeamName}</h3>
          <p className="text-xs text-white/70">Série de {total} match(s)</p>
        </div>
        <div className={filterRowClass}>
          <div className="flex items-center gap-2 shrink-0">
            {([
              { key: "for", label: "Marqués" },
              { key: "against", label: "Encaissés" },
            ] as { key: GoalFocus; label: string }[]).map((item) => (
              <button
                key={item.key}
                onClick={() => setGoalFocus(item.key)}
                className={`${buttonBaseClass} ${
                  goalFocus === item.key ? activeButtonClass : inactiveButtonClass
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-white/70 shrink-0">
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
                  className="absolute left-0 mt-1 min-w-full rounded-md border border-white/10 bg-white/10 text-white backdrop-blur-md shadow-lg z-20"
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
          <button
            onClick={() => setShowOpponent((v) => !v)}
            disabled={!showOpponentAllowed}
            className={`${buttonBaseClass} ${
              showOpponent ? "bg-blue-500/30 border-blue-400 text-white" : inactiveButtonClass
            } ${!showOpponentAllowed ? "opacity-40 cursor-not-allowed" : ""}`}
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
            {Array.from({ length: MAX_GOALS }).map((_, idx) => {
              const label = idx + 1;
              const y = viewHeight - (label / MAX_GOALS) * viewHeight;
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

            <line
              x1={0}
              y1={avgY}
              x2={viewWidth}
              y2={avgY}
              stroke={THEME_BLUE}
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
                y1={
                  viewHeight -
                  (clamp(opponentSeries.avg, 0, MAX_GOALS) / MAX_GOALS) * viewHeight
                }
                x2={viewWidth}
                y2={
                  viewHeight -
                  (clamp(opponentSeries.avg, 0, MAX_GOALS) / MAX_GOALS) * viewHeight
                }
                stroke={THEME_ORANGE_LIGHT}
                strokeWidth={0.4}
                strokeDasharray="1 1"
              />
            )}

            <defs>
              <linearGradient id="teamGoalsLineSmooth" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={THEME_GREEN} stopOpacity="0.6" />
                <stop offset="100%" stopColor={THEME_GREEN} stopOpacity="0.05" />
              </linearGradient>
            </defs>

            <path
              d={`${toPath(points)} L ${viewWidth},${viewHeight} L 0,${viewHeight} Z`}
              fill="url(#teamGoalsLineSmooth)"
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
                  <linearGradient id="teamOpponentLineSmooth" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={THEME_ORANGE} stopOpacity="0.35" />
                    <stop offset="100%" stopColor={THEME_ORANGE} stopOpacity="0.05" />
                  </linearGradient>
                </defs>
                <path
                  d={`${toPath(opponentSeries.points)} L ${viewWidth},${viewHeight} L 0,${viewHeight} Z`}
                  fill="url(#teamOpponentLineSmooth)"
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
          </svg>

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
                {focusLabel} : {formatNumber(hoveredPoint.value)}
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
          <span>{focusLabel} par match</span>
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
