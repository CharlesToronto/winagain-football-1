"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GoalsScoredTrendCard, {
  buildEntries,
  type Location,
  type Mode,
  type SeriesEntry,
} from "./GoalsScoredTrendCard";
import AiPromptButton from "./AiPromptButton";
import ConfidenceBadgeTrigger from "./ConfidenceBadgeTrigger";

type Fixture = any;
type BadgeKey = "trendScored" | "matchScored";

const THRESHOLD_MIN = 0.5;
const THRESHOLD_MAX = 5.5;
const DEFAULT_THRESHOLD = 1.5;

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

function resolveTeamName(fixtures: Fixture[]) {
  const match = (fixtures ?? []).find(
    (fixture) =>
      typeof fixture?.isHome === "boolean" &&
      (fixture?.home_team_name || fixture?.away_team_name)
  );
  if (!match) return null;
  return match.isHome ? match.home_team_name ?? null : match.away_team_name ?? null;
}

function computeNextMatchBelow(
  entries: SeriesEntry[],
  threshold: number
) {
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

function NextMatchBelowCard({
  entries,
  threshold,
  teamName,
}: {
  entries: SeriesEntry[];
  threshold: number;
  teamName?: string | null;
}) {
  const summary = useMemo(
    () => computeNextMatchBelow(entries, threshold),
    [entries, threshold]
  );
  const thresholdLabel = `+${formatNumber(threshold)}`;
  const resolvedTeam = teamName || "cette équipe";
  const showPercent = summary.lastAbove && summary.triggers > 0;
  const percentLabel = showPercent ? `${summary.percent}%` : "--";
  const detailLabel = summary.triggers
    ? `${summary.percent}% (${summary.belowNext}/${summary.triggers}) des matchs suivants, dans une situation similaire, se sont terminés avec un nombre de buts inscrits par ${resolvedTeam} inférieur a ${thresholdLabel}`
    : `Aucun match au-dessus de ${thresholdLabel}`;

  return (
    <div className="bg-sky-400/10 backdrop-blur-sm rounded-xl p-6 shadow flex flex-col gap-4 h-[20rem]">
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
                  <svg viewBox="0 0 20 20" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 10l3 3 8-8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 20 20" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" strokeLinejoin="round" />
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
          → Dernier but marqué :{" "}
          {summary.lastValue === null ? "--" : formatNumber(summary.lastValue)}
        </div>
      </div>
    </div>
  );
}

export default function GoalsScoredTrendSection({
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
  const [location, setLocation] = useState<Location>("all");
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [mobileIndex, setMobileIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const mobileSlides = 2;

  const entries = useMemo(
    () => buildEntries(fixtures ?? [], mode, location),
    [fixtures, mode, location]
  );
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
  const teamName = useMemo(() => resolveTeamName(fixtures ?? []), [fixtures]);
  const matchBelowSummary = useMemo(
    () => computeNextMatchBelow(entries, threshold),
    [entries, threshold]
  );
  const matchBelowIndicator =
    matchBelowSummary.lastAbove &&
    matchBelowSummary.triggers > 0 &&
    matchBelowSummary.percent >= 70 &&
    matchBelowSummary.percent <= 100;
  const lastTeamGoals = entries.length ? entries[entries.length - 1].value : null;
  const trendIndicatorActive = lastTeamGoals != null && lastTeamGoals > 2.5;

  useEffect(() => {
    if (!onBadgeStateChange) return;
    onBadgeStateChange("trendScored", trendIndicatorActive);
  }, [onBadgeStateChange, trendIndicatorActive]);

  useEffect(() => {
    if (!onBadgeStateChange) return;
    onBadgeStateChange("matchScored", matchBelowIndicator);
  }, [onBadgeStateChange, matchBelowIndicator]);

  const thresholdLabel = `+${formatNumber(threshold)}`;
  const locationLabel =
    location === "all" ? "General" : location === "home" ? "Home" : "Away";

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
            key={`trend-dot-${idx}`}
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
        <div className="snap-start shrink-0 w-full md:w-auto md:col-span-2">
          <div className="space-y-2">
            {onAiPrompt ? (
              <div className="flex items-center justify-between">
                <AiPromptButton
                  onClick={() =>
                    onAiPrompt(
                      "Tendance buts (Marqués)",
                      `Buts marqués | Seuil ${thresholdLabel} | Lieu ${locationLabel}`
                    )
                  }
                />
                <ConfidenceBadgeTrigger
                  activeCount={badgeActiveCount}
                  totalCount={badgeTotalCount}
                  visible={trendIndicatorActive}
                />
              </div>
            ) : null}
            <div className={cardBorderClass}>
              <GoalsScoredTrendCard
                fixtures={fixtures ?? []}
                opponentFixtures={opponentFixtures}
                opponentName={opponentName}
                referenceCount={referenceCount}
                mode={mode}
                teamName={teamName}
                threshold={threshold}
                onThresholdChange={setThreshold}
                location={location}
                onLocationChange={setLocation}
              />
            </div>
          </div>
        </div>
        <div className="snap-start shrink-0 w-full md:w-auto md:col-span-1">
          <div className="space-y-2">
            {onAiPrompt ? (
              <div className="flex items-center justify-between">
                <AiPromptButton
                  onClick={() =>
                    onAiPrompt(
                      `Match suivant sous ${thresholdLabel}`,
                      `Buts Marqués | Seuil ${thresholdLabel} | Lieu ${locationLabel}`
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
              <NextMatchBelowCard entries={entries} threshold={threshold} teamName={teamName} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
