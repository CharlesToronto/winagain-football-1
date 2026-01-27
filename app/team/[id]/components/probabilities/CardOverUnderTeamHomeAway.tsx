"use client";

import { useMemo, useState } from "react";
import StatRow from "./StatRow";
import { getGoalsForMode, resolveIsHome, type Mode } from "./GoalsScoredTrendCard";
import type { GoalFocus } from "./CardOverUnderTeam";

type Fixture = any;
type Side = "home" | "away";

const THRESHOLDS = ["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"];
const HIGHLIGHT_HIGH_MIN = 70;
const HIGHLIGHT_HIGH_MAX = 99;

function getBand(percent: number) {
  if (!Number.isFinite(percent)) return null;
  if (percent >= HIGHLIGHT_HIGH_MIN && percent <= HIGHLIGHT_HIGH_MAX) return "high";
  return null;
}

function computeOverUnder(
  fixtures: Fixture[] = [],
  side: Side,
  mode: Mode,
  focus: GoalFocus
) {
  const totals = fixtures
    .map((f) => {
      const goals = getGoalsForMode(f, mode);
      if (!goals) return null;
      const isHome = resolveIsHome(f);
      if (isHome == null) return null;
      if (side === "home" && !isHome) return null;
      if (side === "away" && isHome) return null;
      const scored = isHome ? goals.home : goals.away;
      const conceded = isHome ? goals.away : goals.home;
      const value = focus === "for" ? scored : conceded;
      return typeof value === "number" ? value : null;
    })
    .filter((value): value is number => value != null);
  const total = totals.length;
  const over: Record<string, { raw: number; percent: number }> = {};
  const under: Record<string, { raw: number; percent: number }> = {};
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  THRESHOLDS.forEach((t) => {
    const threshold = Number(t);
    const overCount = totals.filter((x) => x > threshold).length;
    const underCount = totals.filter((x) => x <= threshold).length;
    over[t] = { raw: overCount, percent: pct(overCount) };
    under[t] = { raw: underCount, percent: pct(underCount) };
  });
  return { total, over, under };
}

export default function CardOverUnderTeamHomeAway({
  fixtures,
  opponentFixtures,
  showOpponentComparison,
  teamName,
  goalFocus: controlledGoalFocus,
  onGoalFocusChange,
  mode = "FT",
  highlightActive,
}: {
  fixtures: Fixture[];
  opponentFixtures?: Fixture[];
  showOpponentComparison?: boolean;
  teamName?: string | null;
  goalFocus?: GoalFocus;
  onGoalFocusChange?: (value: GoalFocus) => void;
  mode?: Mode;
  highlightActive?: boolean;
}) {
  const [side, setSide] = useState<Side>("home");
  const [localGoalFocus, setLocalGoalFocus] = useState<GoalFocus>("for");
  const isControlled = typeof controlledGoalFocus === "string";
  const goalFocus = controlledGoalFocus ?? localGoalFocus;

  const setGoalFocus = (value: GoalFocus) => {
    if (onGoalFocusChange) onGoalFocusChange(value);
    if (!isControlled) {
      setLocalGoalFocus(value);
    }
  };

  const stats = useMemo(
    () => computeOverUnder(fixtures, side, mode, goalFocus),
    [fixtures, side, mode, goalFocus]
  );
  const opponentStats = useMemo(
    () => computeOverUnder(opponentFixtures ?? [], side, mode, goalFocus),
    [opponentFixtures, side, mode, goalFocus]
  );
  const showOpponent = Boolean(showOpponentComparison && opponentFixtures?.length);
  const total = stats.total;
  const over = stats.over;
  const under = stats.under;
  const opponentOver = opponentStats.over;
  const opponentUnder = opponentStats.under;
  const val = (obj: any) => ({
    raw: obj?.raw ?? 0,
    percent: obj?.percent ?? 0,
  });
  const shouldHighlight = (type: "over" | "under", key: string) => {
    if (!highlightActive || !opponentFixtures?.length) return false;
    const teamValue = type === "over" ? val(over[key]).percent : val(under[key]).percent;
    const opponentValue = type === "over" ? val(opponentOver[key]).percent : val(opponentUnder[key]).percent;
    const teamBand = getBand(teamValue);
    const opponentBand = getBand(opponentValue);
    return teamBand != null && teamBand === opponentBand;
  };

  const resolvedTeamName = teamName && teamName.trim() ? teamName : "Équipe";
  const title = `Over / Under ${resolvedTeamName} (${side === "home" ? "Home" : "Away"})`;
  const focusLabel = goalFocus === "for" ? "Marqués" : "Encaissés";
  const selectionCategory = `${title} - ${focusLabel}`;
  const buttonBaseClass =
    "px-2 py-0.5 text-[11px] rounded-md border border-white/60 whitespace-nowrap shrink-0 transition";
  const activeButtonClass =
    "bg-gradient-to-br from-green-500/30 via-emerald-500/30 to-lime-500/30 border-green-400 text-white";
  const inactiveButtonClass = "bg-white/10 text-white/70 blur-[0.6px]";

  const homeAwayButtons = (["home", "away"] as Side[]).map((s) => (
    <button
      key={s}
      onClick={() => setSide(s)}
      className={`${buttonBaseClass} ${
        side === s ? activeButtonClass : inactiveButtonClass
      }`}
    >
      {s === "home" ? "Home" : "Away"}
    </button>
  ));

  const focusButtons = ([
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
  ));

  return (
    <div className="bg-sky-400/10 backdrop-blur-sm rounded-xl p-6 shadow group relative overflow-hidden h-[20rem]">
      <div className="mb-3 flex flex-col gap-2">
        <h3 className="font-semibold whitespace-nowrap truncate">{title}</h3>
        <div className="flex items-center gap-2 flex-nowrap overflow-x-auto no-scrollbar pb-1">
          {homeAwayButtons}
          <span className="h-4 w-px bg-white/20 shrink-0" aria-hidden="true" />
          {focusButtons}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 filter blur-sm group-hover:blur-0 transition">
        <div className="space-y-1">
          <StatRow label="+0.5" count={`(${val(over["0.5"]).raw}/${total})`} percentGreen={`${val(over["0.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["0.5"]).percent}%` : undefined} percentBlue="-" highlight={shouldHighlight("over", "0.5")} selectionCategory={selectionCategory} />
          <StatRow label="+1.5" count={`(${val(over["1.5"]).raw}/${total})`} percentGreen={`${val(over["1.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["1.5"]).percent}%` : undefined} percentBlue="-" highlight={shouldHighlight("over", "1.5")} selectionCategory={selectionCategory} />
          <StatRow label="+2.5" count={`(${val(over["2.5"]).raw}/${total})`} percentGreen={`${val(over["2.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["2.5"]).percent}%` : undefined} percentBlue="-" highlight={shouldHighlight("over", "2.5")} selectionCategory={selectionCategory} />
          <StatRow label="+3.5" count={`(${val(over["3.5"]).raw}/${total})`} percentGreen={`${val(over["3.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["3.5"]).percent}%` : undefined} percentBlue="-" highlight={shouldHighlight("over", "3.5")} selectionCategory={selectionCategory} />
          <StatRow label="+4.5" count={`(${val(over["4.5"]).raw}/${total})`} percentGreen={`${val(over["4.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["4.5"]).percent}%` : undefined} percentBlue="-" highlight={shouldHighlight("over", "4.5")} selectionCategory={selectionCategory} />
          <StatRow label="+5.5" count={`(${val(over["5.5"]).raw}/${total})`} percentGreen={`${val(over["5.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["5.5"]).percent}%` : undefined} percentBlue="-" highlight={shouldHighlight("over", "5.5")} selectionCategory={selectionCategory} />
        </div>
        <div className="space-y-1">
          <StatRow label="-0.5" count={`(${val(under["0.5"]).raw}/${total})`} percentGreen={`${val(under["0.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["0.5"]).percent}%` : undefined} percentBlue="-" highlight={shouldHighlight("under", "0.5")} selectionCategory={selectionCategory} />
          <StatRow label="-1.5" count={`(${val(under["1.5"]).raw}/${total})`} percentGreen={`${val(under["1.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["1.5"]).percent}%` : undefined} percentBlue="-" highlight={shouldHighlight("under", "1.5")} selectionCategory={selectionCategory} />
          <StatRow label="-2.5" count={`(${val(under["2.5"]).raw}/${total})`} percentGreen={`${val(under["2.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["2.5"]).percent}%` : undefined} percentBlue="-" highlight={shouldHighlight("under", "2.5")} selectionCategory={selectionCategory} />
          <StatRow label="-3.5" count={`(${val(under["3.5"]).raw}/${total})`} percentGreen={`${val(under["3.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["3.5"]).percent}%` : undefined} percentBlue="-" highlight={shouldHighlight("under", "3.5")} selectionCategory={selectionCategory} />
          <StatRow label="-4.5" count={`(${val(under["4.5"]).raw}/${total})`} percentGreen={`${val(under["4.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["4.5"]).percent}%` : undefined} percentBlue="-" highlight={shouldHighlight("under", "4.5")} selectionCategory={selectionCategory} />
          <StatRow label="-5.5" count={`(${val(under["5.5"]).raw}/${total})`} percentGreen={`${val(under["5.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["5.5"]).percent}%` : undefined} percentBlue="-" highlight={shouldHighlight("under", "5.5")} selectionCategory={selectionCategory} />
        </div>
      </div>
    </div>
  );
}

