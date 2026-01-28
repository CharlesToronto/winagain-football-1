﻿"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CardResultSimple from "./CardResultSimple";
import CardOverUnder from "./CardOverUnder";
import CardCorners from "./CardCorners";
import CardCards from "./CardCards";
import CardSeries from "./CardSeries";
import CardHalfFull from "./CardHalfFull";
import GoalsTotalTrendSection from "./GoalsTotalTrendSection";
import GoalsScoredTrendSection from "./GoalsScoredTrendSection";
import CardDoubleChance from "./CardDoubleChance";
import CardOverUnderHomeAway from "./CardOverUnderHomeAway";
import CardOverUnderTeam from "./CardOverUnderTeam";
import CardOverUnderTeamHomeAway from "./CardOverUnderTeamHomeAway";
import CardGoalsSplit from "./CardGoalsSplit";
import CardHalfWinRate from "./CardHalfWinRate";
import HalfWinTrendCard from "./HalfWinTrendCard";
import AiPromptButton from "./AiPromptButton";
import ConfidenceBadgeTrigger from "./ConfidenceBadgeTrigger";

import { getProbabilityEngines } from "@/lib/adapters/probabilities";
import { getTeamFixturesAllSeasons } from "@/lib/queries/fixtures";
import { usePathname, useRouter } from "next/navigation";

type Fixture = any;
type FilterKey = "FT" | "HT" | "2H";

type RangeOption = number | "season";

const CURRENT_SEASON = 2025;
const BADGE_KEYS = [
  "trendScored",
  "matchScored",
  "trendTotalTeam",
  "trendTotalOpponent",
  "matchTotal",
  "overUnder",
  "overUnderHomeAway",
] as const;
type BadgeKey = (typeof BADGE_KEYS)[number];
const INITIAL_BADGE_STATE = BADGE_KEYS.reduce((acc, key) => {
  acc[key] = false;
  return acc;
}, {} as Record<BadgeKey, boolean>);

function selectOpponentFixtures(
  fixtures: Fixture[],
  range?: RangeOption,
  cutoffDate?: Date | null
) {
  let played = fixtures.filter((f) => f.goals_home !== null && f.goals_away !== null);

  if (range === "season") {
    played = played.filter((f) => f.season === CURRENT_SEASON);
  }

  if (cutoffDate) {
    const cutoffTime = cutoffDate.getTime();
    played = played.filter((f) => {
      const raw = f.date_utc ?? f.date ?? f.timestamp ?? null;
      if (!raw) return false;
      const time = new Date(raw).getTime();
      return Number.isFinite(time) && time <= cutoffTime;
    });
  }

  played.sort(
    (a, b) => new Date(b.date_utc).getTime() - new Date(a.date_utc).getTime()
  );

  const selectedCount = range === "season" || range == null ? played.length : range;
  return played.slice(0, selectedCount);
}


export default function ProbabilitiesView({
  fixtures,
  teamId,
  nextOpponentId,
  nextOpponentName,
  isTeamHome,
  range,
  cutoffDate,
  overUnderMatchKeys,
  overUnderHighlight,
  showOpponentComparison,
  showOdds,
  fixtureId,
  leagueId,
  season,
  filter,
  onFilterChange,
  cibleActive,
}: {
  fixtures: Fixture[];
  teamId?: number | null;
  nextOpponentId?: number | null;
  nextOpponentName?: string | null;
  isTeamHome?: boolean | null;
  range?: RangeOption;
  cutoffDate?: Date | null;
  overUnderMatchKeys?: Set<string>;
  overUnderHighlight?: boolean;
  showOpponentComparison?: boolean;
  showOdds?: boolean;
  fixtureId?: number | null;
  leagueId?: number | null;
  season?: number | null;
  filter: FilterKey;
  onFilterChange: (value: FilterKey) => void;
  cibleActive?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [opponentFixtures, setOpponentFixtures] = useState<Fixture[]>([]);
  const [mobileSummaryIndex, setMobileSummaryIndex] = useState(0);
  const mobileSummaryRef = useRef<HTMLDivElement | null>(null);
  const mobileSummarySlides = 2;
  const [overUnderOdds, setOverUnderOdds] = useState<{
    over: Record<string, string>;
    under: Record<string, string>;
  } | null>(null);
  const [doubleChanceOdds, setDoubleChanceOdds] = useState<
    Record<"1X" | "X2" | "12", string> | null
  >(null);
  const [bttsOdds, setBttsOdds] = useState<{ yes: string; no: string } | null>(null);
  const [cleanSheetOdds, setCleanSheetOdds] = useState<{
    home: { yes: string; no: string };
    away: { yes: string; no: string };
  } | null>(null);
  const [overUnderOddsLoading, setOverUnderOddsLoading] = useState(false);
  const [teamGoalsFocus, setTeamGoalsFocus] = useState<"for" | "against">("for");
  const [halfWinLocation, setHalfWinLocation] = useState<"all" | "home" | "away">(
    "all"
  );
  const [badgeStates, setBadgeStates] =
    useState<Record<BadgeKey, boolean>>(INITIAL_BADGE_STATE);
  const totalBadgeCount = BADGE_KEYS.length;
  const badgeActiveCount = useMemo(
    () => Object.values(badgeStates).filter(Boolean).length,
    [badgeStates]
  );
  const handleBadgeStateChange = useCallback((key: BadgeKey, active: boolean) => {
    setBadgeStates((prev) => {
      if (prev[key] === active) return prev;
      return { ...prev, [key]: active };
    });
  }, []);

  const { engines, computeStreaks } = getProbabilityEngines();

  const computeEngine = engines[filter];
  const baseStats = computeEngine(fixtures ?? []);
  const streakStats = computeStreaks(fixtures ?? []);

  const stats = {
    ...baseStats,
    streaks: streakStats,
  };
  const streaks = streakStats;

  useEffect(() => {
    let active = true;
    if (!showOdds || !fixtureId || !leagueId || !season) {
      setOverUnderOdds(null);
      setDoubleChanceOdds(null);
      setBttsOdds(null);
      setCleanSheetOdds(null);
      setOverUnderOddsLoading(false);
      return () => {
        active = false;
      };
    }
    setOverUnderOddsLoading(true);
    fetch(
      `/api/odds/fixture?fixture=${fixtureId}&league=${leagueId}&season=${season}&bookmaker=1`
    )
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Odds API error: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        setOverUnderOdds(data?.odds?.overUnder ?? null);
        setDoubleChanceOdds(data?.odds?.doubleChance ?? null);
        setBttsOdds(data?.odds?.btts ?? null);
        setCleanSheetOdds(data?.odds?.cleanSheet ?? null);
      })
      .catch(() => {
        if (!active) return;
        setOverUnderOdds(null);
        setDoubleChanceOdds(null);
        setBttsOdds(null);
        setCleanSheetOdds(null);
      })
      .finally(() => {
        if (!active) return;
        setOverUnderOddsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [showOdds, fixtureId, leagueId, season]);
  const calendarActive = Boolean(cutoffDate);
  const cardBorderClass = calendarActive
    ? "rounded-xl border border-red-500/70"
    : cibleActive
    ? "rounded-xl border border-blue-500/60"
    : "";
  const opponentComparisonActive = Boolean(showOpponentComparison);
  const teamGoalsLabel = teamGoalsFocus === "for" ? "Buts marqués" : "Buts encaissés";
  const teamName = useMemo(() => {
    const match = (fixtures ?? []).find(
      (fixture) =>
        typeof fixture?.isHome === "boolean" &&
        (fixture?.home_team_name || fixture?.away_team_name)
    );
    if (!match) return null;
    return match.isHome ? match.home_team_name ?? null : match.away_team_name ?? null;
  }, [fixtures]);
  const opponentStatsForIndicator = useMemo(() => {
    if (!opponentFixtures.length) return null;
    return computeEngine(opponentFixtures ?? []);
  }, [opponentFixtures, computeEngine]);
  const resolvePercent = (value: any) => {
    const percent =
      typeof value?.percent === "number" ? value.percent : Number(value?.percent ?? NaN);
    return Number.isFinite(percent) ? percent : null;
  };
  const isBetween70And99 = (percent: number | null) =>
    percent != null && percent >= 70 && percent <= 99;
  const teamUnder35 = resolvePercent(stats?.under?.["3.5"]);
  const opponentUnder35 = resolvePercent(opponentStatsForIndicator?.under?.["3.5"]);
  const overUnderIndicatorActive =
    isBetween70And99(teamUnder35) && isBetween70And99(opponentUnder35);
  const getUnderPercentBySide = (list: Fixture[], side: "home" | "away") => {
    const totals = (list ?? [])
      .filter((f) => {
        if (f.goals_home == null || f.goals_away == null) return false;
        if (side === "home") return f.isHome === true;
        return f.isHome === false;
      })
      .map((f) => Number(f.goals_home ?? 0) + Number(f.goals_away ?? 0));
    if (!totals.length) return null;
    const underCount = totals.filter((total) => total <= 3.5).length;
    return Math.round((underCount / totals.length) * 100);
  };
  const teamHomeUnder35 = useMemo(
    () => getUnderPercentBySide(fixtures ?? [], "home"),
    [fixtures]
  );
  const teamAwayUnder35 = useMemo(
    () => getUnderPercentBySide(fixtures ?? [], "away"),
    [fixtures]
  );
  const opponentHomeUnder35 = useMemo(
    () => getUnderPercentBySide(opponentFixtures ?? [], "home"),
    [opponentFixtures]
  );
  const opponentAwayUnder35 = useMemo(
    () => getUnderPercentBySide(opponentFixtures ?? [], "away"),
    [opponentFixtures]
  );
  const overUnderHomeAwayIndicatorActive = useMemo(() => {
    if (isTeamHome == null) return false;
    const homePercent = isTeamHome ? teamHomeUnder35 : opponentHomeUnder35;
    const awayPercent = isTeamHome ? opponentAwayUnder35 : teamAwayUnder35;
    return isBetween70And99(homePercent) && isBetween70And99(awayPercent);
  }, [
    isTeamHome,
    teamHomeUnder35,
    teamAwayUnder35,
    opponentHomeUnder35,
    opponentAwayUnder35,
  ]);

  useEffect(() => {
    handleBadgeStateChange("overUnder", overUnderIndicatorActive);
  }, [handleBadgeStateChange, overUnderIndicatorActive]);

  useEffect(() => {
    handleBadgeStateChange("overUnderHomeAway", overUnderHomeAwayIndicatorActive);
  }, [handleBadgeStateChange, overUnderHomeAwayIndicatorActive]);
  const handleSummaryScroll = () => {
    const el = mobileSummaryRef.current;
    if (!el || el.clientWidth === 0) return;
    const nextIndex = Math.round(el.scrollLeft / el.clientWidth);
    const bounded = Math.max(0, Math.min(mobileSummarySlides - 1, nextIndex));
    if (bounded !== mobileSummaryIndex) {
      setMobileSummaryIndex(bounded);
    }
  };
  const opponentStats =
    opponentComparisonActive && opponentFixtures.length > 0
      ? computeEngine(opponentFixtures ?? [])
      : null;

  console.log("âž¡ï¸ FIXTURES RECEIVED BY ProbabilitiesView:", fixtures?.length);
  console.log("âž¡ï¸ CURRENT FILTER:", filter);
  console.log("âž¡ï¸ BASE STATS:", baseStats);
  console.log("âž¡ï¸ STREAK STATS:", streakStats);
  console.log("âž¡ï¸ FINAL MERGED STATS:", stats);
  console.log("âž¡ï¸ STATS SENT TO CARDS:", stats);

  useEffect(() => {
    async function loadOpponent() {
      if (!nextOpponentId) {
        setOpponentFixtures([]);
        return;
      }
      try {
        const raw = await getTeamFixturesAllSeasons(Number(nextOpponentId));
        if (!raw || raw.length === 0) {
          setOpponentFixtures([]);
          return;
        }
        const filtered = selectOpponentFixtures(raw, range, cutoffDate);
        if (!filtered || filtered.length === 0) {
          setOpponentFixtures([]);
          return;
        }
        const mapped = filtered.map((f: any) => {
          const isHome = f.home_team_id === Number(nextOpponentId);
          return {
            ...f,
            isHome,
            goals_home: f.goals_home,
            goals_away: f.goals_away,
            home_team_name: f.teams?.name ?? f.home_team_name ?? "Unknown",
            away_team_name: f.opp?.name ?? f.away_team_name ?? "Unknown",
            fixture: { date: f.date_utc ?? f.date ?? f.timestamp ?? null },
          };
        });
        setOpponentFixtures(mapped);
      } catch (e) {
        setOpponentFixtures([]);
      }
    }
    loadOpponent();
  }, [nextOpponentId, range, cutoffDate]);

  const handleAiPrompt = (cardTitle: string, detail?: string) => {
    if (!Number.isFinite(teamId)) return;
    const opponentLabel = nextOpponentName ?? "le prochain adversaire";
    const detailSuffix = detail ? ` Contexte: ${detail}.` : "";
    const keyPointsSuffix =
      " Termine par 3 points clés (puces) sur le prochain match de l'équipe et du prochain adversaire, ou sur leurs séries en cours si les infos de match manquent.";
    const prompt = `Charly, que penses-tu des informations de la carte "${cardTitle}" (filtre ${filter}) pour l'équipe, et de la carte équivalente pour ${opponentLabel} ?${detailSuffix}${keyPointsSuffix}`;
    try {
      localStorage.setItem(
        "team-ai-pending-prompt",
        JSON.stringify({ teamId, prompt, createdAt: Date.now() })
      );
    } catch {
      // Ignore storage failures
    }
    router.push(`${pathname}?tab=dashboard`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-center mb-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => onFilterChange("FT")}
            className={`px-3 py-1 text-xs rounded-md border transition ${
              filter === "FT"
                ? "border-white text-white"
                : "border-transparent text-white/60 hover:text-white/80"
            }`}
          >
            Full Game
          </button>

          <button
            onClick={() => onFilterChange("HT")}
            className={`px-3 py-1 text-xs rounded-md border transition ${
              filter === "HT"
                ? "border-white text-white"
                : "border-transparent text-white/60 hover:text-white/80"
            }`}
          >
            1 Half
          </button>

          <button
            onClick={() => onFilterChange("2H")}
            className={`px-3 py-1 text-xs rounded-md border transition ${
              filter === "2H"
                ? "border-white text-white"
                : "border-transparent text-white/60 hover:text-white/80"
            }`}
          >
            2 Half
          </button>
        </div>
      </div>

      <div className="md:hidden space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2" aria-hidden="true">
            {Array.from({ length: mobileSummarySlides }).map((_, idx) => (
              <span
                key={`summary-dot-${idx}`}
                className={`h-1.5 w-1.5 rounded-full ${
                  idx === mobileSummaryIndex ? "bg-blue-400" : "bg-white/30"
                }`}
              />
            ))}
          </div>
          <div
            ref={mobileSummaryRef}
            onScroll={handleSummaryScroll}
            className="flex flex-nowrap gap-6 overflow-x-auto no-scrollbar snap-x snap-mandatory"
          >
            <div className="snap-start shrink-0 w-full">
              <div className="space-y-2">
            <AiPromptButton onClick={() => handleAiPrompt("Résultats")} />
                <div className={cardBorderClass}>
                  <CardResultSimple
                    data={stats}
                    streaks={streaks}
                    fixtures={fixtures ?? []}
                    opponentFixtures={opponentFixtures}
                    showOpponentComparison={opponentComparisonActive}
                    mode={filter}
                    showOdds={Boolean(showOdds) && !overUnderOddsLoading}
                    odds={{
                      btts: bttsOdds,
                      cleanSheet: cleanSheetOdds,
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="snap-start shrink-0 w-full">
              <div className="space-y-2">
                <AiPromptButton onClick={() => handleAiPrompt("Double chance")} />
                <div className={cardBorderClass}>
                  <CardDoubleChance
                    data={stats}
                    streaks={streaks}
                    fixtures={fixtures ?? []}
                    opponentFixtures={opponentFixtures}
                    opponentData={opponentStats}
                    showOpponentComparison={opponentComparisonActive}
                    highlightKeys={overUnderMatchKeys}
                    highlightActive={overUnderHighlight}
                    mode={filter}
                    showOdds={Boolean(showOdds) && !overUnderOddsLoading}
                    odds={doubleChanceOdds}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <AiPromptButton onClick={() => handleAiPrompt("Buts marqués / Encaissés")} />
          <div className={cardBorderClass}>
            <CardGoalsSplit fixtures={fixtures ?? []} />
          </div>
        </div>
      </div>

      <div className="hidden md:grid md:grid-cols-3 gap-6">
        <div className="space-y-2">
          <AiPromptButton onClick={() => handleAiPrompt("Résultats")} />
          <div className={cardBorderClass}>
            <CardResultSimple
              data={stats}
              streaks={streaks}
              fixtures={fixtures ?? []}
              opponentFixtures={opponentFixtures}
              showOpponentComparison={opponentComparisonActive}
              mode={filter}
              showOdds={Boolean(showOdds) && !overUnderOddsLoading}
              odds={{
                btts: bttsOdds,
                cleanSheet: cleanSheetOdds,
              }}
            />
          </div>
        </div>
        <div className="space-y-2">
          <AiPromptButton onClick={() => handleAiPrompt("Buts marqués / Encaissés")} />
          <div className={cardBorderClass}>
            <CardGoalsSplit fixtures={fixtures ?? []} />
          </div>
        </div>
        <div className="space-y-2">
          <AiPromptButton onClick={() => handleAiPrompt("Double chance")} />
          <div className={cardBorderClass}>
            <CardDoubleChance
              data={stats}
              streaks={streaks}
              fixtures={fixtures ?? []}
              opponentFixtures={opponentFixtures}
              opponentData={opponentStats}
              showOpponentComparison={opponentComparisonActive}
              highlightKeys={overUnderMatchKeys}
              highlightActive={overUnderHighlight}
              mode={filter}
              showOdds={Boolean(showOdds) && !overUnderOddsLoading}
              odds={doubleChanceOdds}
            />
          </div>
        </div>
      </div>

      <GoalsTotalTrendSection
        fixtures={fixtures ?? []}
        opponentFixtures={opponentFixtures}
        opponentName={nextOpponentName ?? "Adversaire"}
        referenceCount={fixtures?.length ?? 0}
        mode={filter}
        onAiPrompt={handleAiPrompt}
        cardBorderClass={cardBorderClass}
        onBadgeStateChange={handleBadgeStateChange}
        badgeActiveCount={badgeActiveCount}
        badgeTotalCount={totalBadgeCount}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <AiPromptButton onClick={() => handleAiPrompt("Over / Under")} />
            <ConfidenceBadgeTrigger
              activeCount={badgeActiveCount}
              totalCount={totalBadgeCount}
              visible={overUnderIndicatorActive}
            />
          </div>
          <div className={cardBorderClass}>
            <CardOverUnder
              data={stats}
              streaks={streaks}
              opponentData={opponentStats}
              highlightKeys={overUnderMatchKeys}
              highlightActive={overUnderHighlight}
              showOdds={Boolean(showOdds) && !overUnderOddsLoading}
              odds={overUnderOdds}
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <AiPromptButton onClick={() => handleAiPrompt("Over / Under (Home/Away)")} />
            <ConfidenceBadgeTrigger
              activeCount={badgeActiveCount}
              totalCount={totalBadgeCount}
              visible={overUnderHomeAwayIndicatorActive}
            />
          </div>
          <div className={cardBorderClass}>
            <CardOverUnderHomeAway
              fixtures={fixtures ?? []}
              opponentFixtures={opponentFixtures}
              showOpponentComparison={opponentComparisonActive}
              highlightKeys={overUnderMatchKeys}
              highlightActive={overUnderHighlight}
            />
          </div>
        </div>
      </div>

      <GoalsScoredTrendSection
        fixtures={fixtures ?? []}
        opponentFixtures={opponentFixtures}
        opponentName={nextOpponentName ?? "Adversaire"}
        referenceCount={fixtures?.length ?? 0}
        mode={filter}
        onAiPrompt={handleAiPrompt}
        cardBorderClass={cardBorderClass}
        onBadgeStateChange={handleBadgeStateChange}
        badgeActiveCount={badgeActiveCount}
        badgeTotalCount={totalBadgeCount}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <AiPromptButton
            onClick={() =>
              handleAiPrompt(
                "Over / Under équipe",
                `${teamGoalsLabel} | Mode ${filter}`
              )
            }
          />
          <div className={cardBorderClass}>
            <CardOverUnderTeam
              fixtures={fixtures ?? []}
              opponentFixtures={opponentFixtures}
              showOpponentComparison={opponentComparisonActive}
              teamName={teamName}
              goalFocus={teamGoalsFocus}
              onGoalFocusChange={setTeamGoalsFocus}
              mode={filter}
              highlightActive={overUnderHighlight}
            />
          </div>
        </div>
        <div className="space-y-2">
          <AiPromptButton
            onClick={() =>
              handleAiPrompt(
                "Over / Under équipe (Home/Away)",
                `${teamGoalsLabel} | Home/Away | Mode ${filter}`
              )
            }
          />
          <div className={cardBorderClass}>
            <CardOverUnderTeamHomeAway
              fixtures={fixtures ?? []}
              opponentFixtures={opponentFixtures}
              showOpponentComparison={opponentComparisonActive}
              teamName={teamName}
              goalFocus={teamGoalsFocus}
              onGoalFocusChange={setTeamGoalsFocus}
              mode={filter}
              highlightActive={overUnderHighlight}
            />
          </div>
        </div>
      </div>

      <div className="hidden">
        <div className={cardBorderClass}>
          <CardCorners data={stats} streaks={streaks} opponentData={opponentStats} />
        </div>
      </div>
      <div className="hidden">
        <div className={cardBorderClass}>
          <CardCards data={stats} streaks={streaks} opponentData={opponentStats} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        <div className="hidden">
          <div className={cardBorderClass}>
            <CardSeries
              data={stats}
              streaks={streaks}
              opponentData={opponentStats}
              showOdds={Boolean(showOdds) && !overUnderOddsLoading}
              odds={{
                btts: bttsOdds,
                cleanSheet: cleanSheetOdds,
              }}
            />
          </div>
        </div>
        <div className="hidden">
          <div className={cardBorderClass}>
            <CardHalfFull data={stats} streaks={streaks} opponentData={opponentStats} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <div className="space-y-2 md:col-span-2">
          <AiPromptButton onClick={() => handleAiPrompt("Mi-temps gagnee")} />
          <div className={cardBorderClass}>
            <CardHalfWinRate
              fixtures={fixtures ?? []}
              opponentFixtures={opponentFixtures}
              showOpponentComparison={opponentComparisonActive}
              highlightActive={overUnderHighlight}
              teamId={teamId}
              location={halfWinLocation}
            />
          </div>
        </div>
        <div className="space-y-2 md:col-span-3">
          <AiPromptButton
            onClick={() => handleAiPrompt("Tendance mi-temps gagnee")}
          />
          <div className={cardBorderClass}>
            <HalfWinTrendCard
              fixtures={fixtures ?? []}
              opponentFixtures={opponentFixtures}
              opponentName={nextOpponentName ?? "Adversaire"}
              referenceCount={fixtures?.length ?? 0}
              teamId={teamId}
              location={halfWinLocation}
              onLocationChange={setHalfWinLocation}
            />
          </div>
        </div>
      </div>
      <div className="mt-6 p-4 rounded-lg bg-white/10 text-white text-sm">
        Mode sélectionné : {filter}
        <br />
        Matchs utilisés : {fixtures?.length ?? 0}
      </div>
    </div>
  );
}
