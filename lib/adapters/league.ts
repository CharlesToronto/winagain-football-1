import { fetchApi } from "@/lib/football";

export type LeagueAdapterResult = {
  table: any[];
  opponentByTeam: Record<number, number | undefined>;
};

export async function loadLeagueData(leagueId: string): Promise<LeagueAdapterResult> {
  const standingsResp = await fetchApi("standings", {
    league: leagueId,
    season: 2025,
  });

  const table = standingsResp?.response?.[0]?.league?.standings?.[0] || [];

  // Prochains adversaires via fixtures next:50
  let opponentByTeam: Record<number, number | undefined> = {};
  try {
    const fixturesData = await fetchApi("fixtures", {
      league: leagueId,
      season: 2025,
      next: 50,
    });

    const upcoming = fixturesData?.response || [];
    const nextByTeam: Record<number, { opponentId: number; date: number }> = {};

    const updateNext = (teamId?: number, opponentId?: number, date?: number) => {
      if (!teamId || !opponentId || !date) return;
      const existing = nextByTeam[teamId];
      if (!existing || date < existing.date) {
        nextByTeam[teamId] = { opponentId, date };
      }
    };

    upcoming.forEach((match: any) => {
      const date = new Date(match?.fixture?.date ?? 0).getTime();
      const homeId = match?.teams?.home?.id;
      const awayId = match?.teams?.away?.id;
      updateNext(homeId, awayId, date);
      updateNext(awayId, homeId, date);
    });

    opponentByTeam = Object.fromEntries(
      Object.entries(nextByTeam).map(([teamId, value]) => [Number(teamId), value.opponentId])
    );
  } catch {
    opponentByTeam = {};
  }

  return { table, opponentByTeam };
}
