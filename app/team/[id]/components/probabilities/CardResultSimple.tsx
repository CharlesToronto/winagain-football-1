import { useMemo, useState } from "react";
import StatRow from "./StatRow";
import { getProbabilityEngines } from "@/lib/adapters/probabilities";

type Location = "all" | "home" | "away";
type Mode = "FT" | "HT" | "2H";

function resolveIsHome(fixture: any) {
  if (typeof fixture?.isHome === "boolean") return fixture.isHome;
  return null;
}

function filterFixtures(fixtures: any[] = [], location: Location) {
  if (location === "all") return fixtures;
  return fixtures.filter((fixture) => {
    const isHome = resolveIsHome(fixture);
    if (isHome == null) return false;
    return location === "home" ? isHome : !isHome;
  });
}

export default function CardResultSimple({
  data,
  streaks,
  fixtures = [],
  opponentFixtures = [],
  showOpponentComparison = false,
  mode = "FT",
}: {
  data?: any;
  streaks?: any;
  fixtures?: any[];
  opponentFixtures?: any[];
  showOpponentComparison?: boolean;
  mode?: Mode;
}) {
  const [location, setLocation] = useState<Location>("all");
  const engines = useMemo(() => getProbabilityEngines(), []);
  const computeEngine = engines.engines[mode];
  const computeStreaks = engines.computeStreaks;

  const filteredFixtures = useMemo(
    () => filterFixtures(fixtures ?? [], location),
    [fixtures, location]
  );
  const filteredOpponentFixtures = useMemo(
    () => filterFixtures(opponentFixtures ?? [], location),
    [opponentFixtures, location]
  );
  const statsEngine = useMemo(
    () => (computeEngine ? computeEngine(filteredFixtures) : data),
    [computeEngine, filteredFixtures, data]
  );
  const resolvedStreaks = useMemo(
    () => (computeStreaks ? computeStreaks(filteredFixtures) : streaks ?? {}),
    [computeStreaks, filteredFixtures, streaks]
  );
  const opponentStats = useMemo(
    () =>
      showOpponentComparison && computeEngine
        ? computeEngine(filteredOpponentFixtures)
        : null,
    [showOpponentComparison, computeEngine, filteredOpponentFixtures]
  );

  if (!statsEngine) return null;
  const total = statsEngine.total ?? 0;
  const safe = (obj: any) => ({
    raw: obj?.raw ?? obj?.count ?? 0,
    percent: obj?.percent ?? 0,
  });
  const percentFallback = "-";
  const win = safe(statsEngine.win);
  const draw = safe(statsEngine.draw);
  const lose = safe(statsEngine.lose);
  const btts = safe(statsEngine.btts);
  const cleanHome = safe(statsEngine.clean_home);
  const cleanAway = safe(statsEngine.clean_away);
  const showOpponent = Boolean(showOpponentComparison && opponentStats);
  const opponentWin = safe(opponentStats?.win);
  const opponentDraw = safe(opponentStats?.draw);
  const opponentLose = safe(opponentStats?.lose);
  const opponentBtts = safe(opponentStats?.btts);
  const opponentCleanHome = safe(opponentStats?.clean_home);
  const opponentCleanAway = safe(opponentStats?.clean_away);
  const buttonBaseClass =
    "px-2 py-0.5 text-[11px] rounded-md border border-white/60 whitespace-nowrap shrink-0 transition";
  const activeButtonClass =
    "bg-gradient-to-br from-green-500/30 via-emerald-500/30 to-lime-500/30 border-green-400 text-white";
  const inactiveButtonClass = "bg-white/10 text-white/70 blur-[0.6px]";
  const locationLabel =
    location === "all" ? "General" : location === "home" ? "Home" : "Away";
  const resultCategory = `Résultats (${locationLabel})`;
  const scoringCategory = `Buts & scoring (${locationLabel})`;

  return (
    <div className="card bg-white/5 rounded-xl p-6 shadow">
      <div className="flex flex-col gap-2 mb-3">
        <h3 className="font-semibold">Résultats</h3>
        <div className="flex items-center gap-2 flex-nowrap overflow-x-auto no-scrollbar pb-1">
          {([
            { key: "all", label: "General" },
            { key: "home", label: "Home" },
            { key: "away", label: "Away" },
          ] as { key: Location; label: string }[]).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setLocation(option.key)}
              className={`${buttonBaseClass} ${
                location === option.key ? activeButtonClass : inactiveButtonClass
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <StatRow
          label="Victoire"
          count={`(${win.raw}/${total})`}
          percentGreen={`${win.percent}%`}
          percentOrange={showOpponent ? `${opponentWin.percent}%` : undefined}
          percentBlue={
            resolvedStreaks?.win?.active ? `${resolvedStreaks.win.percent}%` : percentFallback
          }
          selectionCategory={resultCategory}
        />
        <StatRow
          label="Nul"
          count={`(${draw.raw}/${total})`}
          percentGreen={`${draw.percent}%`}
          percentOrange={showOpponent ? `${opponentDraw.percent}%` : undefined}
          percentBlue={
            resolvedStreaks?.draw?.active
              ? `${resolvedStreaks.draw.percent}%`
              : percentFallback
          }
          selectionCategory={resultCategory}
        />
        <StatRow
          label="Défaite"
          count={`(${lose.raw}/${total})`}
          percentGreen={`${lose.percent}%`}
          percentOrange={showOpponent ? `${opponentLose.percent}%` : undefined}
          percentBlue={
            resolvedStreaks?.lose?.active
              ? `${resolvedStreaks.lose.percent}%`
              : percentFallback
          }
          selectionCategory={resultCategory}
        />
      </div>
      <div className="pt-3 border-t border-white/10 space-y-1">
        <div className="text-xs text-white uppercase tracking-wide font-semibold">
          Buts & scoring
        </div>
        <StatRow
          label="BTS"
          count={`(${btts.raw}/${total})`}
          percentGreen={`${btts.percent}%`}
          percentOrange={showOpponent ? `${opponentBtts.percent}%` : undefined}
          percentBlue={
            resolvedStreaks?.btts?.active
              ? `${resolvedStreaks.btts.percent}%`
              : percentFallback
          }
          selectionCategory={scoringCategory}
        />
        <StatRow
          label="Clean Sheet Home"
          count={`(${cleanHome.raw}/${total})`}
          percentGreen={`${cleanHome.percent}%`}
          percentOrange={showOpponent ? `${opponentCleanHome.percent}%` : undefined}
          percentBlue={
            resolvedStreaks?.clean_home?.active
              ? `${resolvedStreaks.clean_home.percent}%`
              : percentFallback
          }
          selectionCategory={scoringCategory}
        />
        <StatRow
          label="Clean Sheet Away"
          count={`(${cleanAway.raw}/${total})`}
          percentGreen={`${cleanAway.percent}%`}
          percentOrange={showOpponent ? `${opponentCleanAway.percent}%` : undefined}
          percentBlue={
            resolvedStreaks?.clean_away?.active
              ? `${resolvedStreaks.clean_away.percent}%`
              : percentFallback
          }
          selectionCategory={scoringCategory}
        />
      </div>
    </div>
  );
}
