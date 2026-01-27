"use client";

import { useEffect, useMemo, useState } from "react";
import { getFixturesForTeamsSeasons, getLeagueFixturesAllSeasons } from "@/lib/queries/fixtures";

type RangeOption = number | "season";
type SeasonFilter = "all" | "2024" | "2025";
type ScopeFilter = "team" | "league";

type TeamRef = {
  id?: number | null;
  name?: string | null;
  logo?: string | null;
};

type Fixture = {
  id: number;
  date_utc: string | null;
  season: number | string | null;
  competition_id?: number | null;
  teams?: TeamRef | null;
  opp?: TeamRef | null;
  home_team_id: number | null;
  away_team_id: number | null;
  goals_home: number | null;
  goals_away: number | null;
};
type FixtureInput = Partial<Fixture> & Record<string, any>;

type TeamFixture = {
  id: number;
  dateRaw: string | null;
  dateValue: number;
  season: number;
  competitionId: number | null;
  isHome: boolean;
  opponentId: number;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  goalsHome: number;
  goalsAway: number;
};

type BadgeMatch = {
  id: number;
  dateValue: number;
  dateLabel: string;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  scoreLabel: string;
  isSuccess: boolean;
};

type BadgeBucket = {
  badgeCount: number;
  total: number;
  success: number;
  matches: BadgeMatch[];
};

const SEASON_OPTIONS = [2024, 2025] as const;
const TOTAL_BADGES = 7;
const SCORED_THRESHOLD = 1.5;
const TOTAL_THRESHOLD = 3.5;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseSeason(value: number | string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getDateValue(value: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function getGoalsScored(match: TeamFixture) {
  return match.isHome ? match.goalsHome : match.goalsAway;
}

function getGoalsTotal(match: TeamFixture) {
  return match.goalsHome + match.goalsAway;
}

function computeNextMatchBelow(values: number[], threshold: number) {
  if (values.length === 0) {
    return { lastAbove: false, triggers: 0, percent: 0 };
  }
  let triggers = 0;
  let belowNext = 0;
  for (let i = 0; i < values.length - 1; i += 1) {
    if (values[i] > threshold) {
      triggers += 1;
      if (values[i + 1] < threshold) {
        belowNext += 1;
      }
    }
  }
  const percent = triggers ? Math.round((belowNext / triggers) * 100) : 0;
  const lastValue = values[values.length - 1];
  return {
    lastAbove: lastValue > threshold,
    triggers,
    percent,
  };
}

function percentUnder(values: number[], threshold: number) {
  if (!values.length) return null;
  const underCount = values.filter((value) => value <= threshold).length;
  return Math.round((underCount / values.length) * 100);
}

function isBetween70And99(value: number | null) {
  return value != null && value >= 70 && value <= 99;
}

function isBetween68And99(value: number | null) {
  return value != null && value >= 68 && value <= 99;
}

function rangeLabel(range?: RangeOption) {
  if (typeof range === "number") return `${range} matchs`;
  if (range === "season") return "tous les matchs";
  return "tous les matchs";
}

function formatMatchDate(value: number) {
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function normalizeTeamRef(value: any): TeamRef | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function normalizeFixtureRefs(item: any) {
  if (!item) return item;
  return {
    ...item,
    teams: normalizeTeamRef(item.teams),
    opp: normalizeTeamRef(item.opp),
  };
}

function buildTeamFixtureMap(
  fixtures: FixtureInput[],
  seasons: number[],
  leagueId?: number | null
) {
  const map = new Map<number, TeamFixture[]>();
  const seasonSet = new Set(seasons);

  for (const fixture of fixtures ?? []) {
    const season = parseSeason(fixture.season);
    if (season == null || !seasonSet.has(season)) continue;
    if (leagueId != null) {
      if (fixture.competition_id == null) continue;
      if (Number(fixture.competition_id) !== Number(leagueId)) continue;
    }
    const dateRaw = fixture.date_utc ?? null;
    const dateValue = getDateValue(dateRaw);
    if (dateValue == null) continue;
    if (fixture.goals_home == null || fixture.goals_away == null) continue;
    if (fixture.home_team_id == null || fixture.away_team_id == null) continue;

    const homeId = Number(fixture.home_team_id);
    const awayId = Number(fixture.away_team_id);
    if (!Number.isFinite(homeId) || !Number.isFinite(awayId)) continue;
    const goalsHome = Number(fixture.goals_home);
    const goalsAway = Number(fixture.goals_away);
    const competitionId =
      fixture.competition_id != null ? Number(fixture.competition_id) : null;
    const homeName = fixture.teams?.name ?? fixture.home_team_name ?? "Home";
    const awayName = fixture.opp?.name ?? fixture.away_team_name ?? "Away";
    const homeLogo = fixture.teams?.logo ?? fixture.home_team_logo ?? null;
    const awayLogo = fixture.opp?.logo ?? fixture.away_team_logo ?? null;

    const homeEntry: TeamFixture = {
      id: fixture.id,
      dateRaw,
      dateValue,
      season,
      competitionId,
      isHome: true,
      opponentId: awayId,
      homeName,
      awayName,
      homeLogo,
      awayLogo,
      goalsHome,
      goalsAway,
    };
    const awayEntry: TeamFixture = {
      id: fixture.id,
      dateRaw,
      dateValue,
      season,
      competitionId,
      isHome: false,
      opponentId: homeId,
      homeName,
      awayName,
      homeLogo,
      awayLogo,
      goalsHome,
      goalsAway,
    };

    if (!map.has(homeId)) map.set(homeId, []);
    if (!map.has(awayId)) map.set(awayId, []);
    map.get(homeId)?.push(homeEntry);
    map.get(awayId)?.push(awayEntry);
  }

  Array.from(map.values()).forEach((list) => {
    list.sort((a, b) => a.dateValue - b.dateValue);
  });

  return map;
}

function findCutoffIndex(list: TeamFixture[], cutoff: number) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (list[mid].dateValue < cutoff) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function sliceHistory(list: TeamFixture[], cutoff: number, limit?: number | null) {
  if (!list.length) return [];
  const cutoffIndex = findCutoffIndex(list, cutoff);
  if (cutoffIndex <= 0) return [];
  if (typeof limit === "number") {
    const start = Math.max(0, cutoffIndex - limit);
    return list.slice(start, cutoffIndex);
  }
  return list.slice(0, cutoffIndex);
}

function makeBuckets() {
  return Array.from({ length: TOTAL_BADGES }, (_, idx) => ({
    badgeCount: idx + 1,
    total: 0,
    success: 0,
    matches: [],
  }));
}

export default function ConfidenceView({
  fixtures,
  teamId,
  leagueId,
  range,
  asOfDate,
}: {
  fixtures: FixtureInput[];
  teamId?: number | null;
  leagueId?: number | null;
  range?: RangeOption;
  asOfDate?: Date | null;
}) {
  const [seasonFilter, setSeasonFilter] = useState<SeasonFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("team");
  const [allFixtures, setAllFixtures] = useState<FixtureInput[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeBadgeCount, setActiveBadgeCount] = useState<number | null>(null);

  const seasons = useMemo(
    () =>
      seasonFilter === "all"
        ? [...SEASON_OPTIONS]
        : [Number(seasonFilter)],
    [seasonFilter]
  );
  const fetchSeasons = useMemo(() => [...SEASON_OPTIONS], []);
  const asOfTime = useMemo(() => {
    if (!asOfDate) return null;
    const time = asOfDate.getTime();
    return Number.isFinite(time) ? time : null;
  }, [asOfDate]);

  const teamIds = useMemo(() => {
    if (leagueId != null) return [];
    const ids = new Set<number>();
    const seasonSet = new Set(seasons);
    for (const fixture of fixtures ?? []) {
      const season = parseSeason(fixture.season);
      if (season == null || !seasonSet.has(season)) continue;
      if (leagueId != null) {
        if (fixture.competition_id == null) continue;
        if (Number(fixture.competition_id) !== Number(leagueId)) continue;
      }
      if (fixture.home_team_id != null) {
        const homeId = Number(fixture.home_team_id);
        if (Number.isFinite(homeId)) ids.add(homeId);
      }
      if (fixture.away_team_id != null) {
        const awayId = Number(fixture.away_team_id);
        if (Number.isFinite(awayId)) ids.add(awayId);
      }
    }
    return Array.from(ids);
  }, [fixtures, seasons, leagueId]);

  useEffect(() => {
    let active = true;
    async function loadLeagueFixtures() {
      if (leagueId == null) return;
      const numericLeagueId = Number(leagueId);
      if (!Number.isFinite(numericLeagueId)) {
        setAllFixtures([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const data = await getLeagueFixturesAllSeasons(numericLeagueId);
      if (!active) return;
      const normalized = (data ?? []).map(normalizeFixtureRefs);
      setAllFixtures(normalized);
      setLoading(false);
    }
    loadLeagueFixtures();
    return () => {
      active = false;
    };
  }, [leagueId]);

  useEffect(() => {
    if (leagueId != null) return;
    let active = true;
    async function loadFallbackFixtures() {
      if (!teamIds.length) {
        setAllFixtures([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const data = await getFixturesForTeamsSeasons(teamIds, fetchSeasons, leagueId);
      if (!active) return;
      const normalized = (data ?? []).map(normalizeFixtureRefs);
      setAllFixtures(normalized);
      setLoading(false);
    }
    loadFallbackFixtures();
    return () => {
      active = false;
    };
  }, [teamIds, fetchSeasons, leagueId]);

  useEffect(() => {
    setActiveBadgeCount(null);
  }, [scopeFilter, seasonFilter, range]);

  const analysis = useMemo(() => {
    const buckets = makeBuckets();
    const summary = {
      totalMatches: 0,
      usedMatches: 0,
      overallTotal: 0,
      overallSuccess: 0,
      buckets,
    };

    if (!allFixtures.length) return summary;

    const fixturesByTeam = buildTeamFixtureMap(allFixtures, fetchSeasons, leagueId);
    if (!fixturesByTeam.size) return summary;
    const scopeTeamIds =
      scopeFilter === "league"
        ? Array.from(fixturesByTeam.keys())
        : Number.isFinite(teamId)
          ? [Number(teamId)]
          : [];
    if (!scopeTeamIds.length) return summary;

    const limit = typeof range === "number" ? range : null;

    for (const scopeTeamId of scopeTeamIds) {
      const teamList = fixturesByTeam.get(Number(scopeTeamId)) ?? [];
      if (!teamList.length) continue;
      if (teamList.length < 20) continue;

      const seasonFilteredList =
        seasonFilter === "all"
          ? teamList
          : teamList.filter((match) => match.season === Number(seasonFilter));
      const dateFilteredList =
        asOfTime != null
          ? seasonFilteredList.filter((match) => match.dateValue <= asOfTime)
          : seasonFilteredList;
      if (!dateFilteredList.length) continue;

      summary.totalMatches += dateFilteredList.length;

      for (const match of dateFilteredList) {
        const opponentId = match.opponentId;
        const opponentList = fixturesByTeam.get(opponentId) ?? [];
        if (opponentList.length < 20) continue;
        const historyCutoffValue = match.dateValue - DAY_MS;
        const teamHistory = sliceHistory(teamList, historyCutoffValue, limit);
        const oppHistory = sliceHistory(opponentList, historyCutoffValue, limit);

        const teamScoredValues = teamHistory.map(getGoalsScored);
        const teamTotalValues = teamHistory.map(getGoalsTotal);
        const oppTotalValues = oppHistory.map(getGoalsTotal);

        const lastScored = teamScoredValues.length
          ? teamScoredValues[teamScoredValues.length - 1]
          : null;
        const lastTotalTeam = teamTotalValues.length
          ? teamTotalValues[teamTotalValues.length - 1]
          : null;
        const lastTotalOpp = oppTotalValues.length
          ? oppTotalValues[oppTotalValues.length - 1]
          : null;

        const scoredNext = computeNextMatchBelow(teamScoredValues, SCORED_THRESHOLD);
        const totalNext = computeNextMatchBelow(teamTotalValues, TOTAL_THRESHOLD);

        const teamUnderPercent = percentUnder(teamTotalValues, TOTAL_THRESHOLD);
        const oppUnderPercent = percentUnder(oppTotalValues, TOTAL_THRESHOLD);
        const overUnderIndicatorActive =
          isBetween68And99(teamUnderPercent) || isBetween68And99(oppUnderPercent);
        if (!overUnderIndicatorActive) continue;

        const homeHistory = teamHistory.filter((entry) => entry.isHome);
        const awayHistory = teamHistory.filter((entry) => !entry.isHome);
        const oppHomeHistory = oppHistory.filter((entry) => entry.isHome);
        const oppAwayHistory = oppHistory.filter((entry) => !entry.isHome);

        const homePercent = match.isHome
          ? percentUnder(homeHistory.map(getGoalsTotal), TOTAL_THRESHOLD)
          : percentUnder(oppHomeHistory.map(getGoalsTotal), TOTAL_THRESHOLD);
        const awayPercent = match.isHome
          ? percentUnder(oppAwayHistory.map(getGoalsTotal), TOTAL_THRESHOLD)
          : percentUnder(awayHistory.map(getGoalsTotal), TOTAL_THRESHOLD);

        const badges = [
          lastScored != null && lastScored > 2.5,
          scoredNext.lastAbove && scoredNext.triggers > 0 && scoredNext.percent >= 70,
          totalNext.lastAbove && totalNext.triggers > 0 && totalNext.percent >= 70,
          lastTotalTeam != null && lastTotalTeam > TOTAL_THRESHOLD,
          lastTotalOpp != null && lastTotalOpp > TOTAL_THRESHOLD,
          isBetween70And99(teamUnderPercent) && isBetween70And99(oppUnderPercent),
          isBetween70And99(homePercent) && isBetween70And99(awayPercent),
        ];

        const badgeCount = badges.filter(Boolean).length;
        if (badgeCount < 1 || badgeCount > TOTAL_BADGES) continue;

        const matchTotal = getGoalsTotal(match);
        const underResult = matchTotal <= TOTAL_THRESHOLD;

        const bucket = buckets.find((item) => item.badgeCount === badgeCount);
        if (!bucket) continue;
        bucket.total += 1;
        if (underResult) bucket.success += 1;
        bucket.matches.push({
          id: match.id,
          dateValue: match.dateValue,
          dateLabel: formatMatchDate(match.dateValue),
          homeName: match.homeName,
          awayName: match.awayName,
          homeLogo: match.homeLogo,
          awayLogo: match.awayLogo,
          scoreLabel: `${match.goalsHome} - ${match.goalsAway}`,
          isSuccess: underResult,
        });
        summary.overallTotal += 1;
        if (underResult) summary.overallSuccess += 1;
        summary.usedMatches += 1;
      }
    }

    for (const bucket of buckets) {
      bucket.matches.sort((a, b) => b.dateValue - a.dateValue);
    }

    return summary;
  }, [
    allFixtures,
    teamId,
    seasons,
    leagueId,
    range,
    scopeFilter,
    asOfTime,
    seasonFilter,
    fetchSeasons,
  ]);

  const activeBucket =
    activeBadgeCount != null
      ? analysis.buckets.find((bucket) => bucket.badgeCount === activeBadgeCount) ??
        null
      : null;
  const hasData = analysis.totalMatches > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setScopeFilter("team")}
          className={`px-3 py-1 text-sm rounded-lg transition ${
            scopeFilter === "team"
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/60 hover:bg-white/15"
          }`}
        >
          Équipe
        </button>
        <button
          type="button"
          onClick={() => setScopeFilter("league")}
          disabled={leagueId == null}
          className={`px-3 py-1 text-sm rounded-lg transition ${
            scopeFilter === "league"
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/60 hover:bg-white/15"
          } ${leagueId == null ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          Ligue
        </button>
        <button
          type="button"
          onClick={() => setSeasonFilter("all")}
          className={`px-3 py-1 text-sm rounded-lg transition ${
            seasonFilter === "all"
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/60 hover:bg-white/15"
          }`}
        >
          Saisons 2024 + 2025
        </button>
        <button
          type="button"
          onClick={() => setSeasonFilter("2024")}
          className={`px-3 py-1 text-sm rounded-lg transition ${
            seasonFilter === "2024"
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/60 hover:bg-white/15"
          }`}
        >
          Saison 2024
        </button>
        <button
          type="button"
          onClick={() => setSeasonFilter("2025")}
          className={`px-3 py-1 text-sm rounded-lg transition ${
            seasonFilter === "2025"
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/60 hover:bg-white/15"
          }`}
        >
          Saison 2025
        </button>
      </div>

      <div className="p-4 bg-white/10 backdrop-blur-sm border border-white/10 rounded-xl text-white">
        <div className="font-semibold">Calibration badges (under 3.5)</div>
        <div className="text-xs text-white/70 mt-1">
          {scopeFilter === "league" ? "Scope ligue" : "Scope équipe"} | Mode FT | Filtre
          historique: {rangeLabel(range)} | Badges actifs sur {TOTAL_BADGES}
        </div>
        <div className="text-xs text-white/70 mt-1">
          Matchs utilises: {analysis.usedMatches} / {analysis.totalMatches}
        </div>
      </div>

      {loading && !hasData ? (
        <div className="p-4 bg-white/5 border border-white/10 rounded-xl text-white/80">
          Chargement des fixtures...
        </div>
      ) : !hasData ? (
        <div className="p-4 bg-white/5 border border-white/10 rounded-xl text-white/80">
          Aucune donnée disponible pour ce filtre.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="p-4 bg-white/10 backdrop-blur-sm border border-white/10 rounded-xl text-white">
            <div className="text-sm text-white/70">Moyenne badges (1-7)</div>
            <div className="text-3xl font-semibold mt-2">
              {analysis.overallTotal
                ? `${Math.round(
                    (analysis.overallSuccess / analysis.overallTotal) * 100
                  )}%`
                : "--"}
            </div>
            <div className="text-xs text-white/70 mt-2">
              Under 3.5:{" "}
              {analysis.overallTotal
                ? `${analysis.overallSuccess}/${analysis.overallTotal}`
                : "--"}
            </div>
          </div>
          {analysis.buckets.map((bucket) => {
            const percent = bucket.total
              ? Math.round((bucket.success / bucket.total) * 100)
              : null;
            return (
              <button
                key={`badge-${bucket.badgeCount}`}
                type="button"
                onClick={() => setActiveBadgeCount(bucket.badgeCount)}
                className="p-4 bg-white/10 backdrop-blur-sm border border-white/10 rounded-xl text-white text-left transition hover:bg-white/15"
              >
                <div className="text-sm text-white/70">
                  Badge {bucket.badgeCount}/{TOTAL_BADGES}
                </div>
                <div className="text-3xl font-semibold mt-2">
                  {percent == null ? "--" : `${percent}%`}
                </div>
                <div className="text-xs text-white/70 mt-2">
                  Under 3.5: {bucket.total ? `${bucket.success}/${bucket.total}` : "--"}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {activeBucket ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="Fermer la liste des matchs"
            onClick={() => setActiveBadgeCount(null)}
          />
          <div className="relative w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-2xl border border-white/20 bg-white/10 backdrop-blur-lg shadow-xl text-white">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <div className="text-sm text-white/70">
                  Badge {activeBucket.badgeCount}/{TOTAL_BADGES}
                </div>
                <div className="text-lg font-semibold">
                  Detail des matchs (Under 3.5)
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-white/70">
                  {activeBucket.total
                    ? `${activeBucket.success}/${activeBucket.total}`
                    : "--"}
                </div>
                <button
                  type="button"
                  onClick={() => setActiveBadgeCount(null)}
                  className="rounded-md bg-white/10 px-3 py-1 text-xs text-white/80 hover:bg-white/20"
                >
                  Fermer
                </button>
              </div>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              {activeBucket.matches.length === 0 ? (
                <div className="text-sm text-white/70">Aucun match disponible.</div>
              ) : (
                <div className="space-y-3">
                  {activeBucket.matches.map((match) => (
                    <div
                      key={match.id}
                      className={`rounded-xl border px-4 py-3 backdrop-blur-sm ${
                        match.isSuccess
                          ? "border-emerald-400/40 bg-emerald-500/10"
                          : "border-red-400/40 bg-red-500/10"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            {match.homeLogo ? (
                              <img
                                src={match.homeLogo}
                                alt={match.homeName}
                                className="w-6 h-6 object-contain"
                              />
                            ) : null}
                            <span className="text-sm font-semibold">{match.homeName}</span>
                          </div>
                          <span className="text-xs text-white/60">vs</span>
                          <div className="flex items-center gap-2">
                            {match.awayLogo ? (
                              <img
                                src={match.awayLogo}
                                alt={match.awayName}
                                className="w-6 h-6 object-contain"
                              />
                            ) : null}
                            <span className="text-sm font-semibold">{match.awayName}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-xs text-white/70">{match.dateLabel}</span>
                          <span className="text-sm font-semibold">{match.scoreLabel}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
