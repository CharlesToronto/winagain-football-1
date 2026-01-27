import StatRow from "./StatRow";

export default function CardOverUnder({
  data,
  streaks,
  opponentData,
  highlightKeys,
  highlightActive,
}: {
  data: any;
  streaks: any;
  opponentData?: any;
  highlightKeys?: Set<string>;
  highlightActive?: boolean;
}) {
  const statsEngine = data;
  const resolvedStreaks = data?.streaks ?? streaks ?? {};
  console.log("📘 CARD streaks:", resolvedStreaks);
  if (!statsEngine) return null;
  const over = statsEngine.over ?? {};
  const under = statsEngine.under ?? {};
  const total = statsEngine.total ?? 0;
  const showOpponent = Boolean(opponentData);
  const opponentOver = opponentData?.over ?? {};
  const opponentUnder = opponentData?.under ?? {};
  const val = (obj: any) => ({
    raw: obj?.raw ?? obj?.count ?? 0,
    percent: obj?.percent ?? 0,
  });
  const shouldHighlight = (type: "over" | "under", key: string) =>
    Boolean(highlightActive && highlightKeys?.has(`${type}:${key}`));

  return (
    <div className="bg-white/5 rounded-xl p-6 shadow h-[20rem]">
      <h3 className="font-semibold mb-3">Over / Under</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <StatRow label="+0.5" count={`(${val(over["0.5"]).raw}/${total})`} percentGreen={`${val(over["0.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["0.5"]).percent}%` : undefined} percentBlue={resolvedStreaks?.over?.["0.5"]?.active ? `${resolvedStreaks.over["0.5"].percent}%` : "–"} highlight={shouldHighlight("over", "0.5")} selectionCategory="Over / Under" />
          <StatRow label="+1.5" count={`(${val(over["1.5"]).raw}/${total})`} percentGreen={`${val(over["1.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["1.5"]).percent}%` : undefined} percentBlue={resolvedStreaks?.over?.["1.5"]?.active ? `${resolvedStreaks.over["1.5"].percent}%` : "–"} highlight={shouldHighlight("over", "1.5")} selectionCategory="Over / Under" />
          <StatRow label="+2.5" count={`(${val(over["2.5"]).raw}/${total})`} percentGreen={`${val(over["2.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["2.5"]).percent}%` : undefined} percentBlue={resolvedStreaks?.over?.["2.5"]?.active ? `${resolvedStreaks.over["2.5"].percent}%` : "–"} highlight={shouldHighlight("over", "2.5")} selectionCategory="Over / Under" />
          <StatRow label="+3.5" count={`(${val(over["3.5"]).raw}/${total})`} percentGreen={`${val(over["3.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["3.5"]).percent}%` : undefined} percentBlue={resolvedStreaks?.over?.["3.5"]?.active ? `${resolvedStreaks.over["3.5"].percent}%` : "–"} highlight={shouldHighlight("over", "3.5")} selectionCategory="Over / Under" />
          <StatRow label="+4.5" count={`(${val(over["4.5"]).raw}/${total})`} percentGreen={`${val(over["4.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["4.5"]).percent}%` : undefined} percentBlue={resolvedStreaks?.over?.["4.5"]?.active ? `${resolvedStreaks.over["4.5"].percent}%` : "–"} highlight={shouldHighlight("over", "4.5")} selectionCategory="Over / Under" />
          <StatRow label="+5.5" count={`(${val(over["5.5"]).raw}/${total})`} percentGreen={`${val(over["5.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentOver["5.5"]).percent}%` : undefined} percentBlue={resolvedStreaks?.over?.["5.5"]?.active ? `${resolvedStreaks.over["5.5"].percent}%` : "–"} highlight={shouldHighlight("over", "5.5")} selectionCategory="Over / Under" />
        </div>
        <div className="space-y-1">
          <StatRow label="-0.5" count={`(${val(under["0.5"]).raw}/${total})`} percentGreen={`${val(under["0.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["0.5"]).percent}%` : undefined} percentBlue={resolvedStreaks?.under?.["0.5"]?.active ? `${resolvedStreaks.under["0.5"].percent}%` : "–"} highlight={shouldHighlight("under", "0.5")} selectionCategory="Over / Under" />
          <StatRow label="-1.5" count={`(${val(under["1.5"]).raw}/${total})`} percentGreen={`${val(under["1.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["1.5"]).percent}%` : undefined} percentBlue={resolvedStreaks?.under?.["1.5"]?.active ? `${resolvedStreaks.under["1.5"].percent}%` : "–"} highlight={shouldHighlight("under", "1.5")} selectionCategory="Over / Under" />
          <StatRow label="-2.5" count={`(${val(under["2.5"]).raw}/${total})`} percentGreen={`${val(under["2.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["2.5"]).percent}%` : undefined} percentBlue={resolvedStreaks?.under?.["2.5"]?.active ? `${resolvedStreaks.under["2.5"].percent}%` : "–"} highlight={shouldHighlight("under", "2.5")} selectionCategory="Over / Under" />
          <StatRow label="-3.5" count={`(${val(under["3.5"]).raw}/${total})`} percentGreen={`${val(under["3.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["3.5"]).percent}%` : undefined} percentBlue={resolvedStreaks?.under?.["3.5"]?.active ? `${resolvedStreaks.under["3.5"].percent}%` : "–"} highlight={shouldHighlight("under", "3.5")} selectionCategory="Over / Under" />
          <StatRow label="-4.5" count={`(${val(under["4.5"]).raw}/${total})`} percentGreen={`${val(under["4.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["4.5"]).percent}%` : undefined} percentBlue={resolvedStreaks?.under?.["4.5"]?.active ? `${resolvedStreaks.under["4.5"].percent}%` : "–"} highlight={shouldHighlight("under", "4.5")} selectionCategory="Over / Under" />
          <StatRow label="-5.5" count={`(${val(under["5.5"]).raw}/${total})`} percentGreen={`${val(under["5.5"]).percent}%`} percentOrange={showOpponent ? `${val(opponentUnder["5.5"]).percent}%` : undefined} percentBlue={resolvedStreaks?.under?.["5.5"]?.active ? `${resolvedStreaks.under["5.5"].percent}%` : "–"} highlight={shouldHighlight("under", "5.5")} selectionCategory="Over / Under" />
        </div>
      </div>
    </div>
  );
}


