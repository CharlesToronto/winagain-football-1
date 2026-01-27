import { fetchApi } from "@/lib/football";
import { getTeamFixturesAllSeasons } from "@/lib/queries/fixtures";

type RangeFilter = number | "season";

export type TeamAdapterResult = {
  team: any;
  league: any;
  fixtures: any[];
  stats: any;
  nextMatch: any;
  standings: any[];
};

const STANDINGS_SEASON = 2025;

function resolveLeagueIdFromFixtures(fixtures: any[], season: number) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) return null;
  const seasonMatches = fixtures.filter(
    (fixture: any) => Number(fixture?.season) === season
  );
  const candidates = seasonMatches.length ? seasonMatches : fixtures;
  const counts = new Map<number, number>();
  candidates.forEach((fixture: any) => {
    const rawId = fixture?.competition_id;
    const id = Number(rawId);
    if (!Number.isFinite(id)) return;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  });

  let bestId: number | null = null;
  let bestCount = 0;
  counts.forEach((count, id) => {
    if (count > bestCount) {
      bestCount = count;
      bestId = id;
    }
  });

  return bestId;
}

export async function loadTeamData(
  teamIdRaw: string,
  range: RangeFilter,
  cutoffDate?: Date | null
): Promise<TeamAdapterResult> {
  const id = Number(teamIdRaw);

  const teamData = await fetchApi("teams", { id: teamIdRaw });
  const apiTeam = teamData?.response?.[0];
  const team = apiTeam?.team ?? null;

  const allFixtures = await getTeamFixturesAllSeasons(id);
  const leagueIdFromFixtures = resolveLeagueIdFromFixtures(
    allFixtures,
    STANDINGS_SEASON
  );
  const leagueFromApi = apiTeam?.league ?? null;
  const preferredLeagueId = leagueIdFromFixtures ?? leagueFromApi?.id ?? null;

  // Prochain match via API Football (prefere le championnat principal)
  let nextMatch = null;
  if (apiTeam?.team?.id) {
    try {
      const nextData = await fetchApi("fixtures", { team: apiTeam.team.id, next: 5 });
      const candidates = nextData?.response ?? [];
      const preferred =
        preferredLeagueId != null
          ? candidates.find(
              (fixture: any) =>
                Number(fixture?.league?.id) === Number(preferredLeagueId)
            )
          : null;
      nextMatch = preferred ?? candidates[0] ?? null;
    } catch (error) {
      nextMatch = null;
    }
  }

  const leagueFromNext = nextMatch?.league ?? null;
  const leagueId =
    leagueIdFromFixtures ?? leagueFromApi?.id ?? leagueFromNext?.id ?? null;

  let league = null;
  if (leagueFromApi && Number(leagueFromApi.id) === Number(leagueId)) {
    league = leagueFromApi;
  } else if (leagueFromNext && Number(leagueFromNext.id) === Number(leagueId)) {
    league = leagueFromNext;
  } else if (leagueId != null) {
    try {
      const leagueData = await fetchApi("leagues", { id: leagueId });
      league = leagueData?.response?.[0]?.league ?? leagueData?.response?.[0] ?? null;
    } catch (error) {
      league = null;
    }
  }

  // Fetch standings after resolving league
  let standings: any[] = [];

  if (leagueId) {
    const data = await fetchApi("standings", {
      league: leagueId,
      season: STANDINGS_SEASON,
    });

    standings = data.response?.[0]?.league?.standings?.[0] || [];
  }
  let fixtures: any[] = [];
  let stats: any = null;

  if (allFixtures && allFixtures.length > 0) {
    let played = allFixtures.filter(
      (f: any) => f.goals_home !== null && f.goals_away !== null
    );

    if (range === "season") {
      played = played.filter((f: any) => f.season === STANDINGS_SEASON);
    }

    if (cutoffDate) {
      const cutoffTime = cutoffDate.getTime();
      played = played.filter((f: any) => {
        const raw =
          f.date_utc ?? f.date ?? f.fixture?.date ?? f.timestamp ?? null;
        if (!raw) return false;
        const time = new Date(raw).getTime();
        return Number.isFinite(time) && time <= cutoffTime;
      });
    }

    played.sort(
      (a: any, b: any) => new Date(b.date_utc).getTime() - new Date(a.date_utc).getTime()
    );

    const selectedFilterValue = range === "season" ? played.length : range;
    const rawFixtures = played.slice(0, selectedFilterValue);

    const limited = rawFixtures.map((f: any) => {
      const isHome = f.home_team_id === id;

      return {
        ...f,
        isHome,
        home_team_name: f.teams?.name ?? f.home_team_name ?? "Unknown",
        home_team_logo: f.teams?.logo ?? f.home_team_logo ?? null,
        away_team_name: f.opp?.name ?? f.away_team_name ?? "Unknown",
        away_team_logo: f.opp?.logo ?? f.away_team_logo ?? null,
      };
    });

    const matchesUsed = limited;

    let wins = 0;
    let draws = 0;
    let losses = 0;

    let goalsFor = 0;
    let goalsAgainst = 0;

    let bttsCount = 0;
    let over25Count = 0;

    const form: string[] = [];

    matchesUsed.forEach((g: any) => {
      const gf = g.isHome ? g.goals_home : g.goals_away;
      const ga = g.isHome ? g.goals_away : g.goals_home;

      goalsFor += gf;
      goalsAgainst += ga;

      if (gf > ga) {
        wins++;
        form.push("W");
      } else if (gf === ga) {
        draws++;
        form.push("D");
      } else {
        losses++;
        form.push("L");
      }

      if (g.goals_home > 0 && g.goals_away > 0) bttsCount++;
      if (g.goals_home + g.goals_away >= 3) over25Count++;
    });

    const playedCount = matchesUsed.length;

    const engineStats = {
      played: playedCount,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      goal_diff: goalsFor - goalsAgainst,
      win_rate: playedCount ? Math.round((wins / playedCount) * 100) : 0,
      btts_percent: playedCount ? Math.round((bttsCount / playedCount) * 100) : 0,
      over25_percent: playedCount ? Math.round((over25Count / playedCount) * 100) : 0,
      avg_goals_for: playedCount ? +(goalsFor / playedCount).toFixed(2) : 0,
      avg_goals_against: playedCount ? +(goalsAgainst / playedCount).toFixed(2) : 0,
      form,
      standings,
    };

    fixtures = limited;
    stats = engineStats;
  }

  return {
    team,
    league,
    fixtures,
    stats,
    nextMatch,
    standings,
  };
}
