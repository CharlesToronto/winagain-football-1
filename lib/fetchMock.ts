export type League = {
  id: string;
  name: string;
  country: string;
  logo: string;
};

export type Match = {
  id: string;
  home: string;
  away: string;
  date: string;
};

export type MatchDetail = {
  id: string;
  home: { name: string; lastMatches: number[] };
  away: { name: string; lastMatches: number[] };
};

const leagues: League[] = [
  { id: "ligue1", name: "Ligue 1", country: "France", logo: "/logos/ligue1.png" },
  { id: "premierleague", name: "Premier League", country: "England", logo: "/logos/pl.png" },
  { id: "laliga", name: "La Liga", country: "Spain", logo: "/logos/laliga.png" }
];

const leagueMatches: Record<string, Match[]> = {
  ligue1: [
    { id: "psg-om", home: "PSG", away: "Marseille", date: "2025-02-05" },
    { id: "lyon-lille", home: "Lyon", away: "Lille", date: "2025-02-06" }
  ],
  premierleague: [
    { id: "city-arsenal", home: "Man City", away: "Arsenal", date: "2025-02-05" },
    { id: "chelsea-liverpool", home: "Chelsea", away: "Liverpool", date: "2025-02-06" }
  ],
  laliga: [
    { id: "real-barca", home: "Real Madrid", away: "Barcelona", date: "2025-02-07" },
    { id: "atleti-sevilla", home: "Atletico", away: "Sevilla", date: "2025-02-08" }
  ]
};

const matchDetails: Record<string, MatchDetail> = {
  "psg-om": {
    id: "psg-om",
    home: { name: "PSG", lastMatches: [3, 2, 3, 4, 2] },
    away: { name: "Marseille", lastMatches: [1, 2, 1, 0, 2] }
  },
  "lyon-lille": {
    id: "lyon-lille",
    home: { name: "Lyon", lastMatches: [1, 0, 2, 1, 1] },
    away: { name: "Lille", lastMatches: [2, 2, 3, 2, 1] }
  },
  "city-arsenal": {
    id: "city-arsenal",
    home: { name: "Man City", lastMatches: [3, 3, 2, 4, 3] },
    away: { name: "Arsenal", lastMatches: [2, 2, 1, 3, 2] }
  },
  "chelsea-liverpool": {
    id: "chelsea-liverpool",
    home: { name: "Chelsea", lastMatches: [1, 2, 0, 1, 2] },
    away: { name: "Liverpool", lastMatches: [3, 3, 2, 3, 2] }
  },
  "real-barca": {
    id: "real-barca",
    home: { name: "Real Madrid", lastMatches: [2, 2, 3, 3, 2] },
    away: { name: "Barcelona", lastMatches: [2, 1, 2, 2, 3] }
  },
  "atleti-sevilla": {
    id: "atleti-sevilla",
    home: { name: "Atletico", lastMatches: [1, 1, 2, 2, 1] },
    away: { name: "Sevilla", lastMatches: [0, 1, 1, 2, 1] }
  }
};

export function getLeagues(): League[] {
  return leagues;
}

export function getMatchesByLeague(id: string): Match[] {
  return leagueMatches[id] ?? [];
}

export function getMatch(id: string): MatchDetail | null {
  return matchDetails[id] ?? null;
}
