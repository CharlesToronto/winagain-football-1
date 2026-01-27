import { useMemo } from "react";

type Fixture = any;
type Location = "all" | "home" | "away";

type GoalsSnapshot = {
  matches: number;
  goalsFor: number;
  goalsAgainst: number;
  avgFor: number;
  avgAgainst: number;
};

function formatAvg(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(2);
}

function computeGoalsSnapshot(fixtures: Fixture[] = [], location: Location): GoalsSnapshot {
  let matches = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;

  for (const fixture of fixtures) {
    if (fixture?.goals_home == null || fixture?.goals_away == null) continue;
    const isHome = typeof fixture?.isHome === "boolean" ? fixture.isHome : null;
    if (location === "home" && isHome !== true) continue;
    if (location === "away" && isHome !== false) continue;
    if (location !== "all" && isHome === null) continue;

    const gf = isHome ? fixture.goals_home : fixture.goals_away;
    const ga = isHome ? fixture.goals_away : fixture.goals_home;
    goalsFor += Number(gf ?? 0);
    goalsAgainst += Number(ga ?? 0);
    matches += 1;
  }

  const avgFor = matches ? goalsFor / matches : 0;
  const avgAgainst = matches ? goalsAgainst / matches : 0;

  return { matches, goalsFor, goalsAgainst, avgFor, avgAgainst };
}

function GoalsRow({
  label,
  value,
  avg,
}: {
  label: string;
  value: number;
  avg: number;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-white/80">{label}</span>
      <span className="font-semibold text-white">
        {value}{" "}
        <span className="text-xs text-white/40">({formatAvg(avg)})</span>
      </span>
    </div>
  );
}

export default function CardGoalsSplit({ fixtures }: { fixtures: Fixture[] }) {
  const snapshots = useMemo(() => {
    return {
      total: computeGoalsSnapshot(fixtures ?? [], "all"),
      home: computeGoalsSnapshot(fixtures ?? [], "home"),
      away: computeGoalsSnapshot(fixtures ?? [], "away"),
    };
  }, [fixtures]);

  const sections = [
    { key: "total", label: "Total", data: snapshots.total },
    { key: "home", label: "Home", data: snapshots.home },
    { key: "away", label: "Away", data: snapshots.away },
  ];

  return (
    <div className="card bg-white/5 rounded-xl p-6 shadow">
      <h3 className="font-semibold mb-3">Buts Marqués / Encaissés</h3>
      <div className="space-y-3">
        {sections.map((section, idx) => (
          <div
            key={section.key}
            className={idx === 0 ? "" : "pt-3 border-t border-white/10"}
          >
            <div className="flex items-center justify-between text-xs text-white uppercase tracking-wide font-semibold">
              <span>{section.label}</span>
              <span>{section.data.matches} matchs</span>
            </div>
            <div className="mt-2 space-y-1">
              <GoalsRow
                label="Marqués"
                value={section.data.goalsFor}
                avg={section.data.avgFor}
              />
              <GoalsRow
                label="Encaissés"
                value={section.data.goalsAgainst}
                avg={section.data.avgAgainst}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
