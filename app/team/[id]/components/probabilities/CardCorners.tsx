import StatRow from "./StatRow";

export default function CardCorners({
  data,
  streaks,
  opponentData,
}: {
  data: any;
  streaks: any;
  opponentData?: any;
}) {
  const statsEngine = data;
  const resolvedStreaks = data?.streaks ?? streaks ?? {};
  console.log("📘 CARD streaks:", resolvedStreaks);
  if (!statsEngine) return null;
  const total = statsEngine.total ?? 0;
  const over = statsEngine.corners?.over ?? { raw: 0, percent: 0 };
  const under = statsEngine.corners?.under ?? { raw: 0, percent: 0 };
  const showOpponent = Boolean(opponentData);
  const opponentOver = opponentData?.corners?.over ?? { raw: 0, percent: 0 };
  const opponentUnder = opponentData?.corners?.under ?? { raw: 0, percent: 0 };

  return (
    <div className="bg-white/5 rounded-xl p-6 shadow">
      <h3 className="font-semibold mb-3">Corners</h3>
      <div className="space-y-1">
        <StatRow label="Corners +" count={`(${over.raw}/${total})`} percentGreen={`${over.percent}%`} percentOrange={showOpponent ? `${opponentOver.percent}%` : undefined} percentBlue={resolvedStreaks?.corners_over?.active ? `${resolvedStreaks.corners_over.percent}%` : "–"} />
        <StatRow label="Corners -" count={`(${under.raw}/${total})`} percentGreen={`${under.percent}%`} percentOrange={showOpponent ? `${opponentUnder.percent}%` : undefined} percentBlue={resolvedStreaks?.corners_under?.active ? `${resolvedStreaks.corners_under.percent}%` : "–"} />
      </div>
    </div>
  );
}
