export const API_FOOTBALL_KEY =
  process.env.API_FOOTBALL_KEY ||
  process.env.NEXT_PUBLIC_API_FOOTBALL_KEY ||
  "65d8cee64f2201969afde24540f10e35";
export const API_BASE = "https://v3.football.api-sports.io";

export async function apiFootball(url: string) {
  const res = await fetch(`https://v3.football.api-sports.io/${url}`, {
    headers: {
      "x-apisports-key": process.env.API_FOOTBALL_KEY!,
    },
    cache: "no-store"
  });
  return res.json();
}

export async function fetchLeagueStandings(leagueId: number, season: number) {
  return apiFootball(`standings?league=${leagueId}&season=${season}`);
}
