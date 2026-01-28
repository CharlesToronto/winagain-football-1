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

export default function CardDoubleChance({
  data,
  streaks,
  fixtures = [],
  opponentFixtures = [],
  opponentData,
  showOpponentComparison = false,
  highlightKeys,
  highlightActive,
  mode = "FT",
  showOdds,
  odds,
}: {
  data: any;
  streaks: any;
  fixtures?: any[];
  opponentFixtures?: any[];
  opponentData?: any;
  showOpponentComparison?: boolean;
  highlightKeys?: Set<string>;
  highlightActive?: boolean;
  mode?: Mode;
  showOdds?: boolean;
  odds?: Record<"1X" | "X2" | "12", string> | null;
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
    () => (computeStreaks ? computeStreaks(filteredFixtures) : data?.streaks ?? streaks ?? {}),
    [computeStreaks, filteredFixtures, data?.streaks, streaks]
  );
  const opponentStats = useMemo(
    () =>
      showOpponentComparison && computeEngine
        ? computeEngine(filteredOpponentFixtures)
        : opponentData ?? null,
    [showOpponentComparison, computeEngine, filteredOpponentFixtures, opponentData]
  );

  if (!statsEngine) return null;
  const total = statsEngine.total ?? 0;
  const safe = (obj: any) => ({
    raw: obj?.raw ?? obj?.count ?? 0,
    percent: obj?.percent ?? 0,
  });
  const percentFallback = "-";
  const dc1x = safe(statsEngine.dc_1x);
  const dcx2 = safe(statsEngine.dc_x2);
  const dc12 = safe(statsEngine.dc_12);
  const showOpponent = Boolean(showOpponentComparison && opponentStats);
  const opponentDc1x = safe(opponentStats?.dc_1x);
  const opponentDcx2 = safe(opponentStats?.dc_x2);
  const opponentDc12 = safe(opponentStats?.dc_12);
  const shouldHighlight = (key: "1x" | "x2" | "12") =>
    Boolean(highlightActive && highlightKeys?.has(`dc:${key}`));
  const buttonBaseClass =
    "px-2 py-0.5 text-[11px] rounded-md border border-white/60 whitespace-nowrap shrink-0 transition";
  const activeButtonClass =
    "bg-gradient-to-br from-green-500/30 via-emerald-500/30 to-lime-500/30 border-green-400 text-white";
  const inactiveButtonClass = "bg-white/10 text-white/70 blur-[0.6px]";
  const locationLabel =
    location === "all" ? "General" : location === "home" ? "Home" : "Away";
  const selectionCategory = `Double chance (${locationLabel})`;

  return (
    <div className="card bg-white/5 rounded-xl p-6 shadow">
      <div className="flex flex-col gap-2 mb-3">
        <h3 className="font-semibold">Double chance</h3>
        <p className="text-[11px] text-white/50">
          1 = équipe, 2 = adversaire
        </p>
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
          label="1X"
          count={`(${dc1x.raw}/${total})`}
          percentGreen={`${dc1x.percent}%`}
          percentOrange={showOpponent ? `${opponentDc1x.percent}%` : undefined}
          highlight={shouldHighlight("1x")}
          percentBlue={
            resolvedStreaks?.dc_1x?.active
              ? `${resolvedStreaks.dc_1x.percent}%`
              : percentFallback
          }
          selectionCategory={selectionCategory}
          showOdd={showOdds}
          odd={odds?.["1X"]}
        />
        <StatRow
          label="X2"
          count={`(${dcx2.raw}/${total})`}
          percentGreen={`${dcx2.percent}%`}
          percentOrange={showOpponent ? `${opponentDcx2.percent}%` : undefined}
          highlight={shouldHighlight("x2")}
          percentBlue={
            resolvedStreaks?.dc_x2?.active
              ? `${resolvedStreaks.dc_x2.percent}%`
              : percentFallback
          }
          selectionCategory={selectionCategory}
          showOdd={showOdds}
          odd={odds?.["X2"]}
        />
        <StatRow
          label="12"
          count={`(${dc12.raw}/${total})`}
          percentGreen={`${dc12.percent}%`}
          percentOrange={showOpponent ? `${opponentDc12.percent}%` : undefined}
          highlight={shouldHighlight("12")}
          percentBlue={
            resolvedStreaks?.dc_12?.active
              ? `${resolvedStreaks.dc_12.percent}%`
              : percentFallback
          }
          selectionCategory={selectionCategory}
          showOdd={showOdds}
          odd={odds?.["12"]}
        />
      </div>
    </div>
  );
}
