import { API_FOOTBALL_KEY, API_BASE } from "./apiFootball";

/**
 * Core API-Football request wrapper
 */
export async function fetchApi(
  endpoint: string,
  params: Record<string, any> = {}
) {
  if (!API_FOOTBALL_KEY) {
    throw new Error("Missing API_FOOTBALL_KEY");
  }

  // Clean endpoint without breaking RegExp
  const cleanEndpoint = endpoint.startsWith("http")
    ? endpoint
    : `${API_BASE}/${endpoint.replace(/^\/+/, "")}`;

  const url = new URL(cleanEndpoint);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-apisports-key": API_FOOTBALL_KEY,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`API-Football error: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch all leagues from API-Football
 */
export async function getAllLeagues() {
  return fetchApi("leagues");
}

/**
 * Fetch teams for a league + season
 */
export async function getTeams(leagueId: number, season: number) {
  return fetchApi("teams", { league: leagueId, season });
}

/**
 * Fetch fixtures for a league + season
 */
export async function getFixtures(leagueId: number, season: number) {
  return fetchApi("fixtures", { league: leagueId, season });
}

export async function getStandings(leagueId: number, season: number) {
  if (!API_FOOTBALL_KEY) {
    throw new Error("Missing API_FOOTBALL_KEY");
  }

  const url = `https://v3.football.api-sports.io/standings?league=${leagueId}&season=${season}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-apisports-key": API_FOOTBALL_KEY,
    },
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error(`API-Football error: ${response.status}`);
  }

  const data = await response.json();
  return data?.response?.[0]?.league?.standings?.[0] ?? [];
}

// Backward-compatible helpers
export async function getCompetitionList() {
  return fetchApi("leagues");
}

export const getCompetitions = getCompetitionList;

export async function fetchFixtures(params: Record<string, any>) {
  return fetchApi("fixtures", params);
}
