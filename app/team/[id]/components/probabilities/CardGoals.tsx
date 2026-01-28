import StatRow from "./StatRow";

export default function CardGoals({
  data,
  streaks,
  opponentData,
  showOdds,
  odds,
}: {
  data: any;
  streaks: any;
  opponentData?: any;
  showOdds?: boolean;
  odds?: {
    btts?: { yes: string; no: string } | null;
    cleanSheet?: {
      home: { yes: string; no: string };
      away: { yes: string; no: string };
    } | null;
  };
}) {
  const statsEngine = data;
  const resolvedStreaks = data?.streaks ?? streaks ?? {};
  console.log("📘 CARD streaks:", resolvedStreaks);
  if (!statsEngine) return null;
  const total = statsEngine.total ?? 0;
  const safe = (obj: any) => ({
    raw: obj?.raw ?? obj?.count ?? 0,
    percent: obj?.percent ?? 0,
  });
  const btts = safe(statsEngine.btts);
  const cleanHome = safe(statsEngine.clean_home);
  const cleanAway = safe(statsEngine.clean_away);
  const showOpponent = Boolean(opponentData);
  const opponentBtts = safe(opponentData?.btts);
  const opponentCleanHome = safe(opponentData?.clean_home);
  const opponentCleanAway = safe(opponentData?.clean_away);
  return (
    <div className="bg-white/5 rounded-xl p-6 shadow">
      <h3 className="font-semibold mb-3">Buts & scoring</h3>
      <div className="space-y-1">
        <StatRow label="BTS" count={`(${btts.raw}/${total})`} percentGreen={`${btts.percent}%`} percentOrange={showOpponent ? `${opponentBtts.percent}%` : undefined} percentBlue={resolvedStreaks?.btts?.active ? `${resolvedStreaks.btts.percent}%` : "–"} showOdd={showOdds} odd={odds?.btts?.yes} />
        <StatRow label="Clean Sheet Home" count={`(${cleanHome.raw}/${total})`} percentGreen={`${cleanHome.percent}%`} percentOrange={showOpponent ? `${opponentCleanHome.percent}%` : undefined} percentBlue={resolvedStreaks?.clean_home?.active ? `${resolvedStreaks.clean_home.percent}%` : "–"} showOdd={showOdds} odd={odds?.cleanSheet?.home?.yes} />
        <StatRow label="Clean Sheet Away" count={`(${cleanAway.raw}/${total})`} percentGreen={`${cleanAway.percent}%`} percentOrange={showOpponent ? `${opponentCleanAway.percent}%` : undefined} percentBlue={resolvedStreaks?.clean_away?.active ? `${resolvedStreaks.clean_away.percent}%` : "–"} showOdd={showOdds} odd={odds?.cleanSheet?.away?.yes} />
      </div>
    </div>
  );
}
