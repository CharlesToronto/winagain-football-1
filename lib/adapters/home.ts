import { createClient } from "@/lib/supabase/server";
import { fetchApi } from "@/lib/football";

export type HomeCounts = {
  fixturesToday: number;
  leagues: number;
  teams: number;
  teamStats: number;
  odds: number;
  topLeaguesToday: { id: number; name: string; count: number }[];
};

const TOP_LEAGUES = [
  { id: 39, name: "Angleterre" },
  { id: 140, name: "Espagne" },
  { id: 135, name: "Italie" },
  { id: 78, name: "Allemagne" },
  { id: 61, name: "France" },
];

async function fetchTopLeagueCountsFromApi(date: string) {
  const results = await Promise.all(
    TOP_LEAGUES.map(async (league) => {
      try {
        const api = await fetchApi("fixtures", { league: league.id, date });
        const count = Array.isArray(api?.response) ? api.response.length : 0;
        return { ...league, count };
      } catch (error) {
        return { ...league, count: 0 };
      }
    })
  );

  return results;
}

export async function loadHomeCounts(): Promise<HomeCounts> {
  try {
    const supabase = createClient();
    const today = new Date().toISOString().slice(0, 10);

    const { count: fixturesToday } = await supabase
      .from("fixtures")
      .select("*", { count: "exact", head: true })
      .gte("date", today)
      .lte("date", today);

    const { data: leagueFixtures, error: leagueFixturesError } = await supabase
      .from("fixtures")
      .select("competition_id")
      .in(
        "competition_id",
        TOP_LEAGUES.map((league) => league.id)
      )
      .gte("date", today)
      .lte("date", today);

    let topLeaguesToday = TOP_LEAGUES.map((league) => ({ ...league, count: 0 }));

    if (!leagueFixturesError && Array.isArray(leagueFixtures)) {
      const counts = new Map<number, number>();
      leagueFixtures.forEach((row: any) => {
        const id = row?.competition_id;
        if (typeof id !== "number") return;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      });
      topLeaguesToday = TOP_LEAGUES.map((league) => ({
        ...league,
        count: counts.get(league.id) ?? 0,
      }));
    } else {
      topLeaguesToday = await fetchTopLeagueCountsFromApi(today);
    }

    const { count: leagues } = await supabase
      .from("competitions")
      .select("*", { count: "exact", head: true });

    const { count: teams } = await supabase
      .from("teams")
      .select("*", { count: "exact", head: true });

    const { count: teamStats } = await supabase
      .from("team_stats")
      .select("*", { count: "exact", head: true });

    const { count: odds } = await supabase
      .from("odds")
      .select("*", { count: "exact", head: true });

    return {
      fixturesToday: fixturesToday || 0,
      leagues: leagues || 0,
      teams: teams || 0,
      teamStats: teamStats || 0,
      odds: odds || 0,
      topLeaguesToday,
    };
  } catch (e) {
    console.error("Home counts error:", e);
    return {
      fixturesToday: 0,
      leagues: 0,
      teams: 0,
      teamStats: 0,
      odds: 0,
      topLeaguesToday: TOP_LEAGUES.map((league) => ({ ...league, count: 0 })),
    };
  }
}
