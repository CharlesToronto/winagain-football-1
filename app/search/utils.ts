import { SearchFilters, TeamResult } from "./types";

// Mock data: dans la vraie vie, on brancherait sur Supabase/fixtures existants.
// Ici on garde l’UI fonctionnelle sans toucher au backend existant.
export const mockTeams: TeamResult[] = [
  {
    id: 49,
    name: "Chelsea",
    league: "Premier League",
    logo: "https://media.api-sports.io/football/teams/49.png",
    lastMatchDate: new Date().toISOString(),
    opponent: "Newcastle",
    market: "OVER_2_5",
    probGreen: 72,
    probBlue: 65,
    aboveAverage: true,
  },
  {
    id: 50,
    name: "Newcastle",
    league: "Premier League",
    logo: "https://media.api-sports.io/football/teams/34.png",
    lastMatchDate: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    opponent: "Chelsea",
    market: "DC_1X",
    probGreen: 68,
    probBlue: 60,
    aboveAverage: false,
  },
  {
    id: 85,
    name: "PSG",
    league: "Ligue 1",
    logo: "https://media.api-sports.io/football/teams/85.png",
    lastMatchDate: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    opponent: "OM",
    market: "OVER_1_5",
    probGreen: 90,
    probBlue: 75,
    aboveAverage: true,
  },
  {
    id: 166,
    name: "Marseille",
    league: "Ligue 1",
    logo: "https://media.api-sports.io/football/teams/166.png",
    lastMatchDate: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    opponent: "PSG",
    market: "OVER_3_5",
    probGreen: 55,
    probBlue: 52,
    aboveAverage: false,
  },
  {
    id: 101,
    name: "Dortmund",
    league: "Bundesliga",
    logo: "https://media.api-sports.io/football/teams/165.png",
    lastMatchDate: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    opponent: "Leipzig",
    market: "UNDER_2_5",
    probGreen: 62,
    probBlue: 58,
    aboveAverage: true,
  },
  {
    id: 102,
    name: "Leipzig",
    league: "Bundesliga",
    logo: "https://media.api-sports.io/football/teams/173.png",
    lastMatchDate: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    opponent: "Dortmund",
    market: "UNDER_3_5",
    probGreen: 48,
    probBlue: 44,
    aboveAverage: false,
  },
];

export function filterTeams(data: TeamResult[], _filters: SearchFilters): TeamResult[] {
  return data;
}
