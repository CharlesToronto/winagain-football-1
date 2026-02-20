"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TeamInfo = {
  id: number;
  name: string | null;
  logo: string | null;
};

type FixtureView = {
  id: number;
  timeLabel: string;
  roundLabel: string | null;
  hasScore: boolean;
  goalsHome: number | null;
  goalsAway: number | null;
  home: TeamInfo | null;
  away: TeamInfo | null;
  homeHref: string | null;
};

type GroupView = {
  anchorId: string;
  competition: {
    id: number;
    name: string | null;
    country: string | null;
    logo: string | null;
  };
  competitionLabel: string;
  competitionRound: string | null;
  leagueStats: {
    resolved: number;
    hits: number;
    hitRate: number;
  } | null;
  fixtures: FixtureView[];
};

type SectionView = {
  key: string;
  title: string;
  groups: GroupView[];
};

const FAVORITE_LEAGUES_STORAGE_KEY = "winagain:rencontre:favorite-leagues";

export default function RencontreClientView({
  activeDay,
  yesterdayHref,
  todayHref,
  tomorrowHref,
  hasError,
  sections,
}: {
  activeDay: "yesterday" | "today" | "tomorrow";
  yesterdayHref: string;
  todayHref: string;
  tomorrowHref: string;
  hasError: boolean;
  sections: SectionView[];
}) {
  const [favoriteLeagueIds, setFavoriteLeagueIds] = useState<number[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITE_LEAGUES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const cleaned = parsed
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0);
      setFavoriteLeagueIds(cleaned);
    } catch {
      setFavoriteLeagueIds([]);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(FAVORITE_LEAGUES_STORAGE_KEY, JSON.stringify(favoriteLeagueIds));
    } catch {
      // Ignore storage errors.
    }
  }, [favoriteLeagueIds]);

  const favoriteLeagueSet = useMemo(() => new Set(favoriteLeagueIds), [favoriteLeagueIds]);

  const sortedSections = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        groups: [...section.groups].sort((a, b) => {
          const aFav = favoriteLeagueSet.has(a.competition.id);
          const bFav = favoriteLeagueSet.has(b.competition.id);
          if (aFav !== bFav) return aFav ? -1 : 1;
          return a.competitionLabel.localeCompare(b.competitionLabel);
        }),
      })),
    [sections, favoriteLeagueSet]
  );

  const toggleFavoriteLeague = (leagueId: number) => {
    if (!Number.isFinite(leagueId) || leagueId <= 0) return;
    setFavoriteLeagueIds((prev) =>
      prev.includes(leagueId) ? prev.filter((id) => id !== leagueId) : [...prev, leagueId]
    );
  };

  return (
    <div className="min-h-screen p-6 text-white">
      <div className="flex items-center gap-2 mb-6">
        <Link
          href={yesterdayHref}
          className={`px-3 py-1 rounded-lg text-sm transition ${
            activeDay === "yesterday"
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
        >
          Hier
        </Link>
        <Link
          href={todayHref}
          className={`px-3 py-1 rounded-lg text-sm transition ${
            activeDay === "today"
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
        >
          Aujourd'hui
        </Link>
        <Link
          href={tomorrowHref}
          className={`px-3 py-1 rounded-lg text-sm transition ${
            activeDay === "tomorrow"
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
        >
          Demain
        </Link>
      </div>

      {hasError ? (
        <div className="p-4 rounded-lg bg-red-500/20 border border-red-500/40 text-red-100">
          Erreur chargement rencontres.
        </div>
      ) : null}

      <div className="space-y-8">
        {sortedSections.map((section) => (
          <div key={section.key} className="space-y-4">
            <div className="sr-only">{section.title}</div>
            {section.groups.length === 0 ? (
              <div className="text-sm text-white/60">Aucun match prévu.</div>
            ) : (
              <div className="space-y-4">
                {section.groups.map((group) => {
                  const isFavorite = favoriteLeagueSet.has(group.competition.id);
                  return (
                    <details
                      key={`competition-${section.key}-${group.competition.id}-${activeDay}`}
                      id={group.anchorId}
                      className="group -mx-4 px-2 rounded-xl bg-transparent"
                    >
                      <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none rounded-xl border border-white/20 bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm group-open:border-transparent group-open:bg-transparent text-[11px]">
                        <button
                          type="button"
                          className={`shrink-0 rounded p-1 text-[18px] leading-none transition ${
                            isFavorite
                              ? "text-amber-300 hover:text-amber-200"
                              : "text-white/30 hover:text-white/60"
                          }`}
                          aria-label={
                            isFavorite
                              ? `Retirer ${group.competitionLabel} des favoris`
                              : `Ajouter ${group.competitionLabel} aux favoris`
                          }
                          aria-pressed={isFavorite}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleFavoriteLeague(group.competition.id);
                          }}
                        >
                          <span aria-hidden>{isFavorite ? "★" : "☆"}</span>
                        </button>

                        {group.competition.logo ? (
                          <img
                            src={group.competition.logo}
                            alt={group.competitionLabel}
                            className="w-8 h-8 rounded-md object-contain bg-white/10"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-md bg-white/10 border border-white/10" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold truncate text-[12px]">{group.competitionLabel}</div>
                          <div className="text-[10px] text-white/60 flex items-center gap-2">
                            <span>{group.fixtures.length} matchs</span>
                            {group.leagueStats?.resolved ? (
                              <>
                                <span className="text-white/40">•</span>
                                <span className="tabular-nums text-[11px] font-medium">
                                  Hit rate {group.leagueStats.hitRate.toFixed(1)}% •{" "}
                                  {group.leagueStats.resolved} picks résolus
                                </span>
                              </>
                            ) : null}
                            {group.competitionRound ? (
                              <>
                                <span className="text-white/40">•</span>
                                <span className="truncate">{group.competitionRound}</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <span className="text-white/50 transition-transform group-open:rotate-180 animate-pulse group-open:animate-none motion-reduce:animate-none">
                          <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden>
                            <path
                              d="M6 9l6 6 6-6"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                      </summary>

                      <div className="-mx-4 px-2 pb-4 space-y-2">
                        {group.fixtures.map((fixture) => {
                          const row = (
                            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 transition hover:bg-white/10">
                              <div className="flex items-center justify-between text-[10px] text-white/60">
                                <span>{fixture.timeLabel}</span>
                                <span className="truncate">{fixture.roundLabel ?? ""}</span>
                              </div>
                              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-xs">
                                <div className="flex items-center gap-2 min-w-0">
                                  {fixture.home?.logo ? (
                                    <img
                                      src={fixture.home.logo}
                                      alt={fixture.home.name ?? "Home"}
                                      className="w-4 h-4 object-contain"
                                    />
                                  ) : (
                                    <div className="w-4 h-4 rounded-full bg-white/10" />
                                  )}
                                  <span className="truncate font-semibold">
                                    {fixture.home?.name ?? "Home"}
                                  </span>
                                </div>
                                <div
                                  className={`text-center ${
                                    activeDay === "yesterday" && fixture.hasScore
                                      ? "text-sm font-semibold text-white/90"
                                      : "text-xs text-white/60"
                                  }`}
                                >
                                  {activeDay === "yesterday" && fixture.hasScore
                                    ? `${fixture.goalsHome} - ${fixture.goalsAway}`
                                    : "VS"}
                                </div>
                                <div className="flex items-center justify-end gap-2 min-w-0 text-right">
                                  <span className="truncate font-semibold">
                                    {fixture.away?.name ?? "Away"}
                                  </span>
                                  {fixture.away?.logo ? (
                                    <img
                                      src={fixture.away.logo}
                                      alt={fixture.away.name ?? "Away"}
                                      className="w-4 h-4 object-contain"
                                    />
                                  ) : (
                                    <div className="w-4 h-4 rounded-full bg-white/10" />
                                  )}
                                </div>
                              </div>
                            </div>
                          );

                          return fixture.homeHref ? (
                            <Link key={fixture.id} href={fixture.homeHref} className="block">
                              {row}
                            </Link>
                          ) : (
                            <div key={fixture.id}>{row}</div>
                          );
                        })}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
