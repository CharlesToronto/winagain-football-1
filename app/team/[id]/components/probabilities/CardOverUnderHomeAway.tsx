import { useMemo, useState } from "react";
import StatRow from "./StatRow";

type Fixture = any;
type Side = "home" | "away";

function computeOverUnder(fixtures: Fixture[] = [], side: Side) {
  const thresholds = ["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"];
  const totals = fixtures
    .filter((f) => {
      if (f.goals_home == null || f.goals_away == null) return false;
      if (side === "home") return f.isHome === true;
      return f.isHome === false;
    })
    .map((f) => {
      const gf = side === "home" ? f.goals_home : f.goals_away;
      const ga = side === "home" ? f.goals_away : f.goals_home;
      return (gf ?? 0) + (ga ?? 0);
    });
  const total = totals.length;
  const over: Record<string, { raw: number; percent: number }> = {};
  const under: Record<string, { raw: number; percent: number }> = {};
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  thresholds.forEach((t) => {
    const threshold = Number(t);
    const overCount = totals.filter((x) => x > threshold).length;
    const underCount = totals.filter((x) => x <= threshold).length;
    over[t] = { raw: overCount, percent: pct(overCount) };
    under[t] = { raw: underCount, percent: pct(underCount) };
  });
  return { total, over, under };
}

export default function CardOverUnderHomeAway({
  fixtures,
  opponentFixtures,
  showOpponentComparison,
  highlightKeys,
  highlightActive,
}: {
  fixtures: Fixture[];
  opponentFixtures?: Fixture[];
  showOpponentComparison?: boolean;
  highlightKeys?: Set<string>;
  highlightActive?: boolean;
}) {
  const [side, setSide] = useState<Side>("home");
  const stats = useMemo(() => computeOverUnder(fixtures, side), [fixtures, side]);
  const opponentStats = useMemo(
    () => computeOverUnder(opponentFixtures ?? [], side),
    [opponentFixtures, side]
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
  const shouldHighlight = (type: "over" | "under", key: string) =>
    Boolean(highlightActive && highlightKeys?.has(`${type}:${key}`));
  const buttonBaseClass =
    "px-2 py-0.5 text-[11px] rounded-md border border-white/60 whitespace-nowrap shrink-0 transition";
  const activeButtonClass =
    "bg-gradient-to-br from-green-500/30 via-emerald-500/30 to-lime-500/30 border-green-400 text-white";
  const inactiveButtonClass = "bg-white/10 text-white/70 blur-[0.6px]";
  const selectionCategory = `Over / Under ${side === "home" ? "Home" : "Away"}`;

  return (
    <div className="bg-white/5 rounded-xl p-6 shadow relative overflow-hidden h-[20rem]">
      <div className="flex flex-col gap-2 mb-3">
        <h3 className="font-semibold">Over / Under ({side === "home" ? "Home" : "Away"})</h3>
        <div className="flex items-center gap-2 flex-nowrap overflow-x-auto no-scrollbar pb-1">
          {(["home", "away"] as Side[]).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`${buttonBaseClass} ${
                side === s ? activeButtonClass : inactiveButtonClass
              }`}
            >
              {s === "home" ? "Home" : "Away"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <StatRow label="+0.5" count={`(${val(over["0.5"]).raw}/${total})`} percentGreen={`${val(over["0.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["0.5"]).percent}%` : undefined} percentBlue="–" highlight={shouldHighlight("over", "0.5")} selectionCategory={selectionCategory} />
          <StatRow label="+1.5" count={`(${val(over["1.5"]).raw}/${total})`} percentGreen={`${val(over["1.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["1.5"]).percent}%` : undefined} percentBlue="–" highlight={shouldHighlight("over", "1.5")} selectionCategory={selectionCategory} />
          <StatRow label="+2.5" count={`(${val(over["2.5"]).raw}/${total})`} percentGreen={`${val(over["2.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["2.5"]).percent}%` : undefined} percentBlue="–" highlight={shouldHighlight("over", "2.5")} selectionCategory={selectionCategory} />
          <StatRow label="+3.5" count={`(${val(over["3.5"]).raw}/${total})`} percentGreen={`${val(over["3.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["3.5"]).percent}%` : undefined} percentBlue="–" highlight={shouldHighlight("over", "3.5")} selectionCategory={selectionCategory} />
          <StatRow label="+4.5" count={`(${val(over["4.5"]).raw}/${total})`} percentGreen={`${val(over["4.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["4.5"]).percent}%` : undefined} percentBlue="–" highlight={shouldHighlight("over", "4.5")} selectionCategory={selectionCategory} />
          <StatRow label="+5.5" count={`(${val(over["5.5"]).raw}/${total})`} percentGreen={`${val(over["5.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["5.5"]).percent}%` : undefined} percentBlue="–" highlight={shouldHighlight("over", "5.5")} selectionCategory={selectionCategory} />
        </div>
        <div className="space-y-1">
          <StatRow label="-0.5" count={`(${val(under["0.5"]).raw}/${total})`} percentGreen={`${val(under["0.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["0.5"]).percent}%` : undefined} percentBlue="–" highlight={shouldHighlight("under", "0.5")} selectionCategory={selectionCategory} />
          <StatRow label="-1.5" count={`(${val(under["1.5"]).raw}/${total})`} percentGreen={`${val(under["1.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["1.5"]).percent}%` : undefined} percentBlue="–" highlight={shouldHighlight("under", "1.5")} selectionCategory={selectionCategory} />
          <StatRow label="-2.5" count={`(${val(under["2.5"]).raw}/${total})`} percentGreen={`${val(under["2.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["2.5"]).percent}%` : undefined} percentBlue="–" highlight={shouldHighlight("under", "2.5")} selectionCategory={selectionCategory} />
          <StatRow label="-3.5" count={`(${val(under["3.5"]).raw}/${total})`} percentGreen={`${val(under["3.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["3.5"]).percent}%` : undefined} percentBlue="–" highlight={shouldHighlight("under", "3.5")} selectionCategory={selectionCategory} />
          <StatRow label="-4.5" count={`(${val(under["4.5"]).raw}/${total})`} percentGreen={`${val(under["4.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["4.5"]).percent}%` : undefined} percentBlue="–" highlight={shouldHighlight("under", "4.5")} selectionCategory={selectionCategory} />
          <StatRow label="-5.5" count={`(${val(under["5.5"]).raw}/${total})`} percentGreen={`${val(under["5.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["5.5"]).percent}%` : undefined} percentBlue="–" highlight={shouldHighlight("under", "5.5")} selectionCategory={selectionCategory} />
        </div>
      </div>
    </div>
  );
}

