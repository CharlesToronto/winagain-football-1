"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Fixture = {
  goals_home?: number | null;
  goals_away?: number | null;
  round?: string | null;
  round_text?: string | null;
};

const THEME_GREEN = "#2dd4bf";
const THEME_GREEN_SOFT = "rgba(45, 212, 191, 0.15)";
const THEME_PINK = "#ff4fd8";
const THRESHOLD_OPTIONS = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
type TrendDirection = "under" | "over";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "--";
  const rounded = Math.round(value * 10) / 10;
  return rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(1);
}

function extractRoundNumber(round?: string | null) {
  if (!round) return null;
  const match = round.match(/\d+/g);
  if (!match) return null;
  const last = Number(match[match.length - 1]);
  return Number.isFinite(last) ? last : null;
}

type RoundEntry = {
  round: string;
  order: number | null;
  countUnder: number;
  total: number;
};

export default function LeagueUnderTrendCard({
  fixtures,
  threshold: controlledThreshold,
  onThresholdChange,
}: {
  fixtures: Fixture[];
  threshold?: number;
  onThresholdChange?: (value: number) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [localThreshold, setLocalThreshold] = useState(3.5);
  const [isThresholdOpen, setIsThresholdOpen] = useState(false);
  const [direction, setDirection] = useState<TrendDirection>("under");
  const thresholdRef = useRef<HTMLDivElement | null>(null);
  const isThresholdControlled = typeof controlledThreshold === "number";
  const threshold =
    typeof controlledThreshold === "number" ? controlledThreshold : localThreshold;
  const buttonBaseClass =
    "px-2 py-0.5 text-[11px] rounded-md border border-white/60 whitespace-nowrap shrink-0 transition";
  const activeButtonClass =
    "bg-gradient-to-br from-green-500/30 via-emerald-500/30 to-lime-500/30 border-green-400 text-white";
  const inactiveButtonClass = "bg-white/10 text-white/70";
  const filterRowClass = `flex items-center gap-2 flex-nowrap pb-1 ${
    isThresholdOpen ? "overflow-visible" : "overflow-x-auto no-scrollbar"
  }`;
  const signedThresholdLabel = `${direction === "under" ? "-" : "+"}${threshold}`;

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

  const rounds = useMemo(() => {
    const groups = new Map<string, RoundEntry>();
    for (const fixture of fixtures ?? []) {
      const roundLabel = fixture.round_text ?? fixture.round ?? "Round ?";
      const order = extractRoundNumber(roundLabel);
      const totalGoals =
        Number(fixture.goals_home ?? 0) + Number(fixture.goals_away ?? 0);
      const isUnder = totalGoals < threshold;
      const isMatch = direction === "under" ? isUnder : totalGoals > threshold;
      const existing = groups.get(roundLabel);
      if (existing) {
        existing.total += 1;
        if (isMatch) existing.countUnder += 1;
      } else {
        groups.set(roundLabel, {
          round: roundLabel,
          order,
          total: 1,
          countUnder: isMatch ? 1 : 0,
        });
      }
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (a.order != null && b.order != null && a.order !== b.order) {
        return a.order - b.order;
      }
      if (a.order != null && b.order == null) return -1;
      if (a.order == null && b.order != null) return 1;
      return a.round.localeCompare(b.round);
    });
  }, [fixtures, threshold, direction]);
  const averageUnder = useMemo(() => {
    if (!rounds.length) return null;
    const sum = rounds.reduce((acc, round) => acc + round.countUnder, 0);
    return sum / rounds.length;
  }, [rounds]);
  const averageLabel = averageUnder == null ? "--" : formatNumber(averageUnder);

  const totalSlots = rounds.length;
  const maxCount = useMemo(() => {
    if (!rounds.length) return 1;
    const maxValue = rounds.reduce((max, round) => Math.max(max, round.total), 0);
    return maxValue > 0 ? maxValue : 1;
  }, [rounds]);
  const mobileSlots = 10;
  const chartWidthPct =
    totalSlots > mobileSlots ? (totalSlots / mobileSlots) * 100 : 100;
  const chartWidthStyle: Record<string, string> = {
    "--chart-width": `${chartWidthPct}%`,
  };
  const viewWidth = 100;
  const viewHeight = 80;
  const slotWidth = totalSlots ? viewWidth / totalSlots : viewWidth;
  const barWidth = Math.max(0.8, slotWidth * 0.65);

  const bars = rounds.map((entry, idx) => {
    const value = clamp(entry.countUnder, 0, maxCount);
    const height = (value / maxCount) * viewHeight;
    const x = idx * slotWidth + (slotWidth - barWidth) / 2;
    const y = viewHeight - height;
    return {
      x: x + barWidth / 2,
      y,
      width: barWidth,
      height,
      value,
      round: entry.round,
      total: entry.total,
    };
  });

  const hovered = hoverIdx !== null ? bars[hoverIdx] : null;

  return (
    <div className="bg-white/5 rounded-xl p-6 shadow h-[20rem] flex flex-col">
      <div className="flex flex-col gap-2 mb-4">
        <div>
          <h3 className="font-semibold">Tendance buts ligue</h3>
          <p className="text-xs text-white/70">Par round (FT) | Moyenne: {averageLabel}</p>
        </div>
        <div className={filterRowClass}>
          <span className="text-[11px] text-white/70 whitespace-nowrap shrink-0">Filtre</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className={`${buttonBaseClass} ${
                direction === "under" ? activeButtonClass : inactiveButtonClass
              }`}
              onClick={() => setDirection("under")}
            >
              Under
            </button>
            <button
              type="button"
              className={`${buttonBaseClass} ${
                direction === "over" ? activeButtonClass : inactiveButtonClass
              }`}
              onClick={() => setDirection("over")}
            >
              Over
            </button>
          </div>
          <div className="relative" ref={thresholdRef}>
            <button
              type="button"
              className={`${buttonBaseClass} ${
                isThresholdOpen ? activeButtonClass : inactiveButtonClass
              }`}
              onClick={() => setIsThresholdOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={isThresholdOpen}
              aria-label="Filtre under"
            >
              {signedThresholdLabel}
            </button>
            {isThresholdOpen && (
              <div
                className="absolute right-0 mt-1 min-w-full rounded-md border border-white/10 bg-white/10 text-white backdrop-blur-md shadow-lg z-20"
                role="listbox"
                aria-label="Filtre under"
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
                    {direction === "under" ? `-${value}` : `+${value}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {totalSlots === 0 ? (
        <p className="text-sm text-white/70">Aucune donnée disponible.</p>
      ) : (
        <div className="w-full flex-1 min-h-0 select-none flex flex-col">
          <div
            className="w-full flex-1 min-h-0 overflow-x-auto no-scrollbar sm:overflow-visible"
            style={chartWidthStyle}
          >
            <div className="w-[var(--chart-width)] sm:w-full h-full flex flex-col">
              <div className="relative flex-1 min-h-0">
                <svg
                  viewBox={`0 0 ${viewWidth} ${viewHeight}`}
                  preserveAspectRatio="none"
                  className="w-full h-full font-sans"
                >
            <defs>
              <linearGradient id="league-bars" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={THEME_GREEN} stopOpacity="0.9" />
                <stop offset="100%" stopColor={THEME_GREEN_SOFT} stopOpacity="0.15" />
              </linearGradient>
            </defs>

            {Array.from({ length: maxCount }).map((_, idx) => {
              const label = idx + 1;
              const y = viewHeight - (label / maxCount) * viewHeight;
              return (
                <g key={`grid-${idx}`}>
                  <line
                    x1={0}
                    y1={y}
                    x2={viewWidth}
                    y2={y}
                    stroke="rgba(255,255,255,0.05)"
                    strokeWidth={0.4}
                  />
                  <text x={-4} y={y + 1.8} fontSize={4} fill="rgba(255,255,255,0.55)">
                    {label}
                  </text>
                </g>
              );
            })}

            {bars.map((bar, idx) => (
              <rect
                key={`bar-${idx}`}
                x={bar.x - bar.width / 2}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill="url(#league-bars)"
                rx={0.8}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            ))}
                </svg>

                {hovered ? (
                  <div
                    className="absolute min-w-[160px] px-4 py-2 bg-black/70 text-white text-xs rounded-lg border border-white/10 -translate-x-1/2 -translate-y-full"
                    style={{
                      left: `${(hovered.x / viewWidth) * 100}%`,
                      top: `${(hovered.y / viewHeight) * 100}%`,
                    }}
                  >
                    <div className="font-semibold">{hovered.round}</div>
                    <div>
                      {direction === "under" ? "Under" : "Over"} {signedThresholdLabel}:{" "}
                      {hovered.value}/{hovered.total}
                    </div>
                    <div className="text-white/70">Matchs: {hovered.total}</div>
                  </div>
                ) : null}
              </div>

              <div
                className="mt-3 grid w-full text-center"
                style={{
                  gridTemplateColumns: `repeat(${totalSlots}, minmax(0, 1fr))`,
                }}
              >
                {bars.map((bar, idx) => {
                  const labelValue = extractRoundNumber(bar.round);
                  const labelText = labelValue != null ? `${labelValue}` : bar.round;
                  return (
                    <div
                      key={`label-${idx}`}
                      className="flex flex-col items-center leading-tight tabular-nums"
                    >
                      <span className="text-[10px] text-white/55 font-semibold">
                        {bar.total ? `${bar.value}/${bar.total}` : "--"}
                      </span>
                      <span className="text-[11px] text-white/80 font-semibold">
                        {labelText}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
