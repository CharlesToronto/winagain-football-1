"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GoalsTrendCard, { getGoalsForMode, type Mode } from "./GoalsTrendCard";
import AiPromptButton from "./AiPromptButton";
import ConfidenceBadgeTrigger from "./ConfidenceBadgeTrigger";

type Fixture = any;
type BadgeKey = "matchTotal" | "trendTotalTeam" | "trendTotalOpponent";

type SeriesEntry = {
  date: number;
  value: number;
};

const THRESHOLD_MIN = 0.5;
const THRESHOLD_MAX = 5.5;
const DEFAULT_THRESHOLD = 3.5;

function resolveDefaultThreshold(value: number | null, fallback: number) {
  if (!Number.isFinite(value ?? NaN)) return fallback;
  const adjusted = (value as number) - 0.5;
  const clamped = Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, adjusted));
  return Math.round(clamped * 2) / 2;
}

function formatNumber(value: number) {
  if (Number.isNaN(value)) return "--";
  const rounded = Math.round(value * 100) / 100;
  return rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(2);
}

function buildEntries(fixtures: Fixture[] = [], mode: Mode): SeriesEntry[] {
  const mapped = fixtures
    .map((f) => {
      const dateRaw =
        (f.fixture && f.fixture.date) ||
        f.date_utc ||
        f.date ||
        f.timestamp ||
        null;
      const dateObj = dateRaw ? new Date(dateRaw) : null;
      const date = dateObj ? dateObj.getTime() : null;
      const goals = getGoalsForMode(f, mode);
      if (!goals || date == null) return null;
      return {
        date,
        value: (goals.home ?? 0) + (goals.away ?? 0),
      };
    })
    .filter((entry) => entry && entry.date != null) as SeriesEntry[];

  mapped.sort((a, b) => a.date - b.date);
  return mapped;
}

function computeNextMatchBelow(entries: SeriesEntry[], threshold: number) {
  if (!entries.length) {
    return {
      lastValue: null,
      lastAbove: false,
      triggers: 0,
      belowNext: 0,
      percent: 0,
    };
  }

  let triggers = 0;
  let belowNext = 0;
  for (let i = 0; i < entries.length - 1; i++) {
    const currentValue = entries[i].value;
    if (currentValue > threshold) {
      triggers += 1;
      if (entries[i + 1].value < threshold) {
        belowNext += 1;
      }
    }
  }
  const percent = triggers ? Math.round((belowNext / triggers) * 100) : 0;
  const lastValue = entries[entries.length - 1]?.value ?? null;
  const lastAbove = lastValue !== null && lastValue > threshold;

  return {
    lastValue,
    lastAbove,
    triggers,
    belowNext,
    percent,
  };
}

function NextMatchBelowTotalCard({
  entries,
  threshold,
}: {
  entries: SeriesEntry[];
  threshold: number;
}) {
  const summary = useMemo(
    () => computeNextMatchBelow(entries, threshold),
    [entries, threshold]
  );
  const thresholdLabel = `+${formatNumber(threshold)}`;
  const showPercent = summary.lastAbove && summary.triggers > 0;
  const percentLabel = showPercent ? `${summary.percent}%` : "--";
  const detailLabel = summary.triggers
    ? `${summary.percent}% (${summary.belowNext}/${summary.triggers}) des matchs suivants se sont termines avec un total de buts inferieur a ${thresholdLabel}`
    : `Aucun match au-dessus de ${thresholdLabel}`;

  return (
    <div className="bg-white/5 rounded-xl p-6 shadow flex flex-col gap-4 h-[20rem]">
      <div>
        <h3 className="font-semibold">Match suivant sous {thresholdLabel}</h3>
        <p className="text-xs text-white/70">
          {summary.lastValue === null ? (
            "Aucune donnée récente"
          ) : (
            <span className="inline-flex items-center gap-2">
              <span
                className={`inline-flex items-center justify-center w-4 h-4 rounded-full border border-white/10 ${
                  summary.lastAbove ? "text-green-400" : "text-red-400"
                }`}
                aria-hidden
              >
                {summary.lastAbove ? (
                  <svg
                    viewBox="0 0 20 20"
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      d="M4 10l3 3 8-8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 20 20"
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      d="M5 5l10 10M15 5l-10 10"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span>Dernier match {thresholdLabel}</span>
            </span>
          )}
        </p>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className={`text-6xl font-bold ${showPercent ? "text-green-400" : "text-white/40"}`}>
          {percentLabel}
        </div>
      </div>
      <div className="text-xs text-white/70 space-y-1">
        <div>{detailLabel}</div>
        <div>
          Dernier total de buts :{" "}
          {summary.lastValue === null ? "--" : formatNumber(summary.lastValue)}
        </div>
      </div>
    </div>
  );
}

export default function GoalsTotalTrendSection({
  fixtures,
  opponentFixtures = [],
  opponentName = "Adversaire",
  referenceCount = 0,
  mode = "FT",
  onAiPrompt,
  cardBorderClass = "",
  onBadgeStateChange,
  badgeActiveCount = 0,
  badgeTotalCount = 0,
}: {
  fixtures: Fixture[];
  opponentFixtures?: Fixture[];
  opponentName?: string;
  referenceCount?: number;
  mode?: Mode;
  onAiPrompt?: (cardTitle: string, detail?: string) => void;
  cardBorderClass?: string;
  onBadgeStateChange?: (key: BadgeKey, active: boolean) => void;
  badgeActiveCount?: number;
  badgeTotalCount?: number;
}) {
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [mobileIndex, setMobileIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const mobileSlides = 2;
  const entries = useMemo(() => buildEntries(fixtures ?? [], mode), [fixtures, mode]);
  const defaultThreshold = useMemo(() => {
    const lastValue = entries.length ? entries[entries.length - 1].value : null;
    return resolveDefaultThreshold(lastValue, DEFAULT_THRESHOLD);
  }, [entries]);
  const defaultThresholdRef = useRef<number | null>(null);
  useEffect(() => {
    const prevDefault = defaultThresholdRef.current;
    if (prevDefault == null || threshold === prevDefault) {
      if (threshold !== defaultThreshold) {
        setThreshold(defaultThreshold);
      }
    }
    defaultThresholdRef.current = defaultThreshold;
  }, [defaultThreshold, threshold]);
  const opponentEntries = useMemo(
    () => buildEntries(opponentFixtures ?? [], mode),
    [opponentFixtures, mode]
  );
  const matchBelowSummary = useMemo(
    () => computeNextMatchBelow(entries, threshold),
    [entries, threshold]
  );
  const matchBelowIndicator =
    matchBelowSummary.lastAbove &&
    matchBelowSummary.triggers > 0 &&
    matchBelowSummary.percent >= 70 &&
    matchBelowSummary.percent <= 100;
  const thresholdLabel = `+${formatNumber(threshold)}`;
  const lastTeamTotal = entries.length ? entries[entries.length - 1].value : null;
  const lastOpponentTotal = opponentEntries.length
    ? opponentEntries[opponentEntries.length - 1].value
    : null;
  const teamIndicatorActive = lastTeamTotal != null && lastTeamTotal > 3.5;
  const opponentIndicatorActive = lastOpponentTotal != null && lastOpponentTotal > 3.5;

  useEffect(() => {
    if (!onBadgeStateChange) return;
    onBadgeStateChange("matchTotal", matchBelowIndicator);
  }, [onBadgeStateChange, matchBelowIndicator]);

  useEffect(() => {
    if (!onBadgeStateChange) return;
    onBadgeStateChange("trendTotalTeam", teamIndicatorActive);
  }, [onBadgeStateChange, teamIndicatorActive]);

  useEffect(() => {
    if (!onBadgeStateChange) return;
    onBadgeStateChange("trendTotalOpponent", opponentIndicatorActive);
  }, [onBadgeStateChange, opponentIndicatorActive]);

  const handleCarouselScroll = () => {
    const el = carouselRef.current;
    if (!el || el.clientWidth === 0) return;
    const nextIndex = Math.round(el.scrollLeft / el.clientWidth);
    const bounded = Math.max(0, Math.min(mobileSlides - 1, nextIndex));
    if (bounded !== mobileIndex) {
      setMobileIndex(bounded);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-center gap-2 md:hidden" aria-hidden="true">
        {Array.from({ length: mobileSlides }).map((_, idx) => (
          <span
            key={`trend-total-dot-${idx}`}
            className={`h-1.5 w-1.5 rounded-full ${
              idx === mobileIndex ? "bg-blue-400" : "bg-white/30"
            }`}
          />
        ))}
      </div>
      <div
        ref={carouselRef}
        onScroll={handleCarouselScroll}
        className="flex flex-nowrap gap-6 overflow-x-auto no-scrollbar snap-x snap-mandatory md:grid md:grid-cols-3 md:overflow-visible"
      >
        <div className="order-2 md:order-1 snap-start shrink-0 w-full md:w-auto md:col-span-1">
          <div className="space-y-2">
            {onAiPrompt ? (
              <div className="flex items-center justify-between">
                <AiPromptButton
                  onClick={() =>
                    onAiPrompt(
                      `Match suivant sous ${thresholdLabel}`,
                      `Total buts | Seuil ${thresholdLabel}`
                    )
                  }
                />
                <ConfidenceBadgeTrigger
                  activeCount={badgeActiveCount}
                  totalCount={badgeTotalCount}
                  visible={matchBelowIndicator}
                />
              </div>
            ) : null}
            <div className={cardBorderClass}>
              <NextMatchBelowTotalCard entries={entries} threshold={threshold} />
            </div>
          </div>
        </div>
        <div className="order-1 md:order-2 snap-start shrink-0 w-full md:w-auto md:col-span-2">
          <div className="space-y-2">
            {onAiPrompt ? (
              <div className="flex items-center justify-between">
                <AiPromptButton
                  onClick={() =>
                    onAiPrompt(
                      "Tendance buts (total par match)",
                      `Total buts | Seuil ${thresholdLabel}`
                    )
                  }
                />
                {teamIndicatorActive || opponentIndicatorActive ? (
                  <div className="flex items-center gap-1">
                    <ConfidenceBadgeTrigger
                      activeCount={badgeActiveCount}
                      totalCount={badgeTotalCount}
                      visible={teamIndicatorActive}
                    />
                    <ConfidenceBadgeTrigger
                      activeCount={badgeActiveCount}
                      totalCount={badgeTotalCount}
                      visible={opponentIndicatorActive}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className={cardBorderClass}>
              <GoalsTrendCard
                fixtures={fixtures ?? []}
                opponentFixtures={opponentFixtures}
                opponentName={opponentName}
                referenceCount={referenceCount}
                mode={mode}
                threshold={threshold}
                onThresholdChange={setThreshold}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
