import StatRow from "./StatRow";

export default function CardResult({
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
  console.log("➡️ CardResult received stats:", statsEngine);
  console.log("📘 CARD streaks:", streaks);
  if (!statsEngine) return null;
  const total = statsEngine.total ?? 0;
  const safe = (obj: any) => ({
    raw: obj?.raw ?? obj?.count ?? 0,
    percent: obj?.percent ?? 0,
  });
  const win = safe(statsEngine.win);
  const draw = safe(statsEngine.draw);
  const lose = safe(statsEngine.lose);
  const dc1x = safe(statsEngine.dc_1x);
  const dcx2 = safe(statsEngine.dc_x2);
  const dc12 = safe(statsEngine.dc_12);
  const dnbHome = safe(statsEngine.dnb_home);
  const dnbAway = safe(statsEngine.dnb_away);
  const showOpponent = Boolean(opponentData);
  const opponentWin = safe(opponentData?.win);
  const opponentDraw = safe(opponentData?.draw);
  const opponentLose = safe(opponentData?.lose);
  const opponentDc1x = safe(opponentData?.dc_1x);
  const opponentDcx2 = safe(opponentData?.dc_x2);
  const opponentDc12 = safe(opponentData?.dc_12);
  const opponentDnbHome = safe(opponentData?.dnb_home);
  const opponentDnbAway = safe(opponentData?.dnb_away);

  return (
    <div className="card bg-white/5 rounded-xl p-6 shadow">
      <h3 className="font-semibold mb-3">Résultat (1X2)</h3>
      <div className="space-y-1">

        <StatRow
          label="Victoire"
          count={`(${win.raw}/${total})`}
          percentGreen={`${win.percent}%`}
          percentOrange={showOpponent ? `${opponentWin.percent}%` : undefined}
          percentBlue={resolvedStreaks?.win?.active ? `${resolvedStreaks.win.percent}%` : "–"}
        />

        <StatRow
          label="Nul"
          count={`(${draw.raw}/${total})`}
          percentGreen={`${draw.percent}%`}
          percentOrange={showOpponent ? `${opponentDraw.percent}%` : undefined}
          percentBlue={resolvedStreaks?.draw?.active ? `${resolvedStreaks.draw.percent}%` : "–"}
        />

        <StatRow
          label="Défaite"
          count={`(${lose.raw}/${total})`}
          percentGreen={`${lose.percent}%`}
          percentOrange={showOpponent ? `${opponentLose.percent}%` : undefined}
          percentBlue={resolvedStreaks?.lose?.active ? `${resolvedStreaks.lose.percent}%` : "–"}
        />

        <StatRow
          label="Double Chance 1X"
          count={`(${dc1x.raw}/${total})`}
          percentGreen={`${dc1x.percent}%`}
          percentOrange={showOpponent ? `${opponentDc1x.percent}%` : undefined}
          percentBlue={resolvedStreaks?.dc_1x?.active ? `${resolvedStreaks.dc_1x.percent}%` : "–"}
        />

        <StatRow
          label="Double Chance X2"
          count={`(${dcx2.raw}/${total})`}
          percentGreen={`${dcx2.percent}%`}
          percentOrange={showOpponent ? `${opponentDcx2.percent}%` : undefined}
          percentBlue={resolvedStreaks?.dc_x2?.active ? `${resolvedStreaks.dc_x2.percent}%` : "–"}
        />

        <StatRow
          label="Double Chance 12"
          count={`(${dc12.raw}/${total})`}
          percentGreen={`${dc12.percent}%`}
          percentOrange={showOpponent ? `${opponentDc12.percent}%` : undefined}
          percentBlue={resolvedStreaks?.dc_12?.active ? `${resolvedStreaks.dc_12.percent}%` : "–"}
        />

        <StatRow
          label="Draw No Bet Home"
          count={`(${dnbHome.raw}/${total})`}
          percentGreen={`${dnbHome.percent}%`}
          percentOrange={showOpponent ? `${opponentDnbHome.percent}%` : undefined}
          percentBlue={resolvedStreaks?.dnb_home?.active ? `${resolvedStreaks.dnb_home.percent}%` : "–"}
        />

        <StatRow
          label="Draw No Bet Away"
          count={`(${dnbAway.raw}/${total})`}
          percentGreen={`${dnbAway.percent}%`}
          percentOrange={showOpponent ? `${opponentDnbAway.percent}%` : undefined}
          percentBlue={resolvedStreaks?.dnb_away?.active ? `${resolvedStreaks.dnb_away.percent}%` : "–"}
        />

      </div>
    </div>
  );
}
