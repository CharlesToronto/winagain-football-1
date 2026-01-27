import StatRow from "./StatRow";

export default function CardHalfFull({
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
  const win = statsEngine.win ?? { raw: 0, percent: 0 };
  const draw = statsEngine.draw ?? { raw: 0, percent: 0 };
  const lose = statsEngine.lose ?? { raw: 0, percent: 0 };
  const showOpponent = Boolean(opponentData);
  const opponentWin = opponentData?.win ?? { raw: 0, percent: 0 };
  const opponentDraw = opponentData?.draw ?? { raw: 0, percent: 0 };
  const opponentLose = opponentData?.lose ?? { raw: 0, percent: 0 };

  return (
    <div className="bg-white/5 rounded-xl p-6 shadow">
      <h3 className="font-semibold mb-3">Mi-temps / Match</h3>
      <div className="space-y-1">
        <StatRow label="Victoire" count={`(${win.raw ?? 0}/${total})`} percentGreen={`${win.percent ?? 0}%`} percentOrange={showOpponent ? `${opponentWin.percent ?? 0}%` : undefined} percentBlue={resolvedStreaks?.win?.active ? `${resolvedStreaks.win.percent}%` : "–"} />
        <StatRow label="Nul" count={`(${draw.raw ?? 0}/${total})`} percentGreen={`${draw.percent ?? 0}%`} percentOrange={showOpponent ? `${opponentDraw.percent ?? 0}%` : undefined} percentBlue={resolvedStreaks?.draw?.active ? `${resolvedStreaks.draw.percent}%` : "–"} />
        <StatRow label="Défaite" count={`(${lose.raw ?? 0}/${total})`} percentGreen={`${lose.percent ?? 0}%`} percentOrange={showOpponent ? `${opponentLose.percent ?? 0}%` : undefined} percentBlue={resolvedStreaks?.lose?.active ? `${resolvedStreaks.lose.percent}%` : "–"} />
      </div>
    </div>
  );
}
