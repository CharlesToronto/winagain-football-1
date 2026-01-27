"use client";

import { useEffect, useMemo, useState } from "react";

type TeamRef = {
  id?: number | null;
  name?: string | null;
  logo?: string | null;
};

type Fixture = {
  id?: number | null;
  date_utc?: string | null;
  round?: string | null;
  round_text?: string | null;
  goals_home?: number | null;
  goals_away?: number | null;
  teams?: TeamRef | null;
  opp?: TeamRef | null;
  home_team_name?: string | null;
  away_team_name?: string | null;
  home_team_logo?: string | null;
  away_team_logo?: string | null;
};

type RoundGroup = {
  round: string;
  order: number | null;
  fixtures: Fixture[];
};

function extractRoundNumber(round?: string | null) {
  if (!round) return null;
  const match = round.match(/\d+/g);
  if (!match) return null;
  const last = Number(match[match.length - 1]);
  return Number.isFinite(last) ? last : null;
}

function resolveTeam(
  fixture: Fixture,
  side: "home" | "away"
): { name: string; logo: string | null } {
  const ref = side === "home" ? fixture.teams : fixture.opp;
  const nameFallback = side === "home" ? fixture.home_team_name : fixture.away_team_name;
  const logoFallback = side === "home" ? fixture.home_team_logo : fixture.away_team_logo;
  return {
    name: ref?.name ?? nameFallback ?? (side === "home" ? "Home" : "Away"),
    logo: ref?.logo ?? logoFallback ?? null,
  };
}

function resolveRoundTitle(roundLabel: string) {
  const roundNumber = extractRoundNumber(roundLabel);
  return roundNumber != null ? `Round ${roundNumber}` : roundLabel;
}

function RoundFixturesList({
  round,
  threshold,
}: {
  round: RoundGroup;
  threshold: number;
}) {
  const sortedFixtures = useMemo(() => {
    const list = [...round.fixtures];
    list.sort((a, b) => {
      const dateA = a.date_utc ? new Date(a.date_utc).getTime() : 0;
      const dateB = b.date_utc ? new Date(b.date_utc).getTime() : 0;
      return dateA - dateB;
    });
    return list;
  }, [round.fixtures]);

  return (
    <div className="flex flex-col gap-2">
      {sortedFixtures.map((fixture, idx) => {
        const home = resolveTeam(fixture, "home");
        const away = resolveTeam(fixture, "away");
        const homeGoals =
          typeof fixture.goals_home === "number" ? fixture.goals_home : null;
        const awayGoals =
          typeof fixture.goals_away === "number" ? fixture.goals_away : null;
        const totalGoals =
          homeGoals != null && awayGoals != null ? homeGoals + awayGoals : null;
        const isOver = totalGoals != null && totalGoals > threshold;
        const scoreLabel =
          homeGoals != null && awayGoals != null ? `${homeGoals} - ${awayGoals}` : "--";

        return (
          <div
            key={fixture.id ?? `${round.round}-${idx}`}
            className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-sm py-2 border-b border-white/10 last:border-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              {home.logo ? (
                <img src={home.logo} alt={home.name} className="w-5 h-5" />
              ) : null}
              <span className="truncate">{home.name}</span>
            </div>
            <div
              className={`font-semibold tabular-nums ${
                isOver ? "text-orange-400" : "text-white/80"
              }`}
            >
              {scoreLabel}
            </div>
            <div className="flex items-center justify-end gap-2 min-w-0 text-right">
              <span className="truncate">{away.name}</span>
              {away.logo ? (
                <img src={away.logo} alt={away.name} className="w-5 h-5" />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function LeagueRoundFixturesCard({
  fixtures,
  threshold,
}: {
  fixtures: Fixture[];
  threshold: number;
}) {
  const rounds = useMemo<RoundGroup[]>(() => {
    const grouped = new Map<string, RoundGroup>();
    (fixtures ?? []).forEach((fixture) => {
      const roundLabel = fixture.round_text ?? fixture.round ?? "Round ?";
      const order = extractRoundNumber(roundLabel);
      const existing = grouped.get(roundLabel);
      if (existing) {
        existing.fixtures.push(fixture);
      } else {
        grouped.set(roundLabel, {
          round: roundLabel,
          order,
          fixtures: [fixture],
        });
      }
    });

    return Array.from(grouped.values()).sort((a, b) => {
      if (a.order != null && b.order != null && a.order !== b.order) {
        return a.order - b.order;
      }
      if (a.order != null && b.order == null) return -1;
      if (a.order == null && b.order != null) return 1;
      return a.round.localeCompare(b.round);
    });
  }, [fixtures]);

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!rounds.length) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex(rounds.length - 1);
  }, [rounds]);

  const currentRound = rounds[activeIndex] ?? null;
  const canPrev = activeIndex > 0;
  const canNext = activeIndex < rounds.length - 1;
  const currentTitle = currentRound ? resolveRoundTitle(currentRound.round) : "--";
  const navButtonClass =
    "w-7 h-7 rounded-md border border-white/60 bg-white/10 text-white transition disabled:opacity-40";

  return (
    <div className="bg-white/5 rounded-xl p-6 shadow min-h-[20rem] flex flex-col">
      <div className="flex flex-col gap-2 mb-4">
        <div>
          <h3 className="font-semibold">Matchs par round</h3>
          <p className="text-xs text-white/70 hidden sm:block">{currentTitle}</p>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <button
            type="button"
            className={navButtonClass}
            onClick={() => setActiveIndex((prev) => Math.max(0, prev - 1))}
            disabled={!canPrev}
            aria-label="Round precedent"
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4 mx-auto" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className={navButtonClass}
            onClick={() =>
              setActiveIndex((prev) => Math.min(rounds.length - 1, prev + 1))
            }
            disabled={!canNext}
            aria-label="Round suivant"
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4 mx-auto" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {rounds.length === 0 ? (
        <p className="text-sm text-white/70">Aucune donnée disponible.</p>
      ) : (
        <>
          <div className="hidden sm:block">
            {currentRound ? (
              <RoundFixturesList round={currentRound} threshold={threshold} />
            ) : null}
          </div>

          <div className="sm:hidden">
            <div className="flex gap-4 overflow-x-auto no-scrollbar snap-x snap-mandatory">
              {rounds.map((round) => (
                <div
                  key={`round-${round.round}`}
                  className="snap-start shrink-0 w-full flex flex-col"
                >
                  <p className="text-xs text-white/70 mb-2">
                    {resolveRoundTitle(round.round)}
                  </p>
                  <RoundFixturesList round={round} threshold={threshold} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
