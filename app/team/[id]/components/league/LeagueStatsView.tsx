"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CardDoubleChance from "../probabilities/CardDoubleChance";
import CardOverUnder from "../probabilities/CardOverUnder";
import LeagueUnderTrendCard from "./LeagueUnderTrendCard";
import LeagueRoundFixturesCard from "./LeagueRoundFixturesCard";
import computeLeagueFT from "@/lib/analysisEngine/computeLeagueFT";
import { getLeagueFixturesBySeason } from "@/lib/queries/fixtures";

type Fixture = Record<string, any>;
export default function LeagueStatsView({
  leagueId,
  season,
}: {
  leagueId?: number | null;
  season?: number | string | null;
}) {
  const [allFixtures, setAllFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [underThreshold, setUnderThreshold] = useState(3.5);
  const [mobileIndex, setMobileIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const mobileSlides = 2;
  const resolvedLeagueId = useMemo(() => {
    if (leagueId == null) return null;
    const parsed = Number(leagueId);
    return Number.isFinite(parsed) ? parsed : null;
  }, [leagueId]);
  const resolvedSeason = useMemo(() => {
    if (season == null) return null;
    const parsed = Number(season);
    return Number.isFinite(parsed) ? parsed : null;
  }, [season]);

  useEffect(() => {
    let active = true;
    if (!resolvedLeagueId || !resolvedSeason) {
      setAllFixtures([]);
      setFetchError(null);
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    setFetchError(null);
    getLeagueFixturesBySeason(resolvedLeagueId, resolvedSeason)
      .then((data) => {
        if (!active) return;
        setAllFixtures(Array.isArray(data) ? data : []);
      })
      .catch((error: any) => {
        if (!active) return;
        setAllFixtures([]);
        setFetchError(error?.message ?? "Erreur chargement ligue.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [resolvedLeagueId, resolvedSeason]);

  const leagueFixtures = useMemo<Fixture[]>(() => {
    const played = allFixtures.filter((fixture) => {
      const status = String(fixture.status_short ?? "").trim().toUpperCase();
      const statusOk = !status || status === "FT";
      return (
        statusOk &&
        fixture.goals_home !== null &&
        fixture.goals_away !== null
      );
    });
    return played;
  }, [allFixtures]);

  const roundCount = useMemo(() => {
    const rounds = new Set<string>();
    for (const fixture of allFixtures) {
      const roundLabel = fixture.round_text ?? fixture.round;
      if (roundLabel) {
        rounds.add(roundLabel);
      }
    }
    return rounds.size;
  }, [allFixtures]);

  const stats = useMemo(
    () => computeLeagueFT(leagueFixtures ?? []),
    [leagueFixtures]
  );
  const totalMatches = leagueFixtures.length;
  const totalFetched = allFixtures.length;
  const cardBorderClass = "";

  const handleCarouselScroll = () => {
    const el = carouselRef.current;
    if (!el || el.clientWidth === 0) return;
    const nextIndex = Math.round(el.scrollLeft / el.clientWidth);
    const bounded = Math.max(0, Math.min(mobileSlides - 1, nextIndex));
    if (bounded !== mobileIndex) {
      setMobileIndex(bounded);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-center gap-2 md:hidden" aria-hidden="true">
        {Array.from({ length: mobileSlides }).map((_, idx) => (
          <span
            key={`league-dot-${idx}`}
            className={`h-1.5 w-1.5 rounded-full ${
              idx === mobileIndex ? "bg-blue-400" : "bg-white/30"
            }`}
          />
        ))}
      </div>
      <div className="md:hidden">
        <div
          ref={carouselRef}
          onScroll={handleCarouselScroll}
          className="flex flex-nowrap gap-6 overflow-x-auto no-scrollbar snap-x snap-mandatory"
        >
          <div className="snap-start shrink-0 w-full">
            <div className={cardBorderClass}>
              <CardOverUnder data={stats} streaks={null} />
            </div>
          </div>
          <div className="snap-start shrink-0 w-full">
            <div className={cardBorderClass}>
              <CardDoubleChance data={stats} streaks={null} />
            </div>
          </div>
        </div>
      </div>
      <div className="hidden md:grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <div className={cardBorderClass}>
            <CardOverUnder data={stats} streaks={null} />
          </div>
        </div>
        <div className="space-y-2">
          <div className={cardBorderClass}>
            <CardDoubleChance data={stats} streaks={null} />
          </div>
        </div>
      </div>

      <LeagueUnderTrendCard
        fixtures={leagueFixtures}
        threshold={underThreshold}
        onThresholdChange={setUnderThreshold}
      />
      <LeagueRoundFixturesCard
        fixtures={leagueFixtures}
        threshold={underThreshold}
      />

      <div className="p-4 rounded-lg bg-white/10 text-white text-sm">
        Debug ligue: league {resolvedLeagueId ?? "--"} / saison {resolvedSeason ?? "--"} / charge {loading ? "..." : totalFetched} / FT {totalMatches}
        <br />
        Debug rounds saison {resolvedSeason ?? "--"} = {roundCount}
        {fetchError ? <span className="block text-red-300">{fetchError}</span> : null}
      </div>
    </div>
  );
}
