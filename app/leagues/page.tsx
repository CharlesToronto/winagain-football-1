"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "@/app/components/ui/Card";
import Link from "next/link";
import { IconSearch } from "@/app/components/icons";
import { COMPETITION_IDS_BY_COUNTRY } from "@/app/lib/data/competitionIds";

// TOP 5 major leagues
const TOP_LEAGUES = [
  { id: 39, name: "Premier League", country: "England", logo: "https://media.api-sports.io/football/leagues/39.png" },
  { id: 140, name: "LaLiga", country: "Spain", logo: "https://media.api-sports.io/football/leagues/140.png" },
  { id: 135, name: "Serie A", country: "Italy", logo: "https://media.api-sports.io/football/leagues/135.png" },
  { id: 78, name: "Bundesliga", country: "Germany", logo: "https://media.api-sports.io/football/leagues/78.png" },
  { id: 61, name: "Ligue 1", country: "France", logo: "https://media.api-sports.io/football/leagues/61.png" },
];

const leaguesBase = COMPETITION_IDS_BY_COUNTRY.flatMap((group) =>
  group.ids.map((id) => ({
    id,
    country: group.country
  }))
);

export default function LeaguesPage() {
  const [query, setQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const [competitionIndex, setCompetitionIndex] = useState<Record<number, { name?: string }>>({});

  useEffect(() => {
    let active = true;
    fetch("/api/competitions")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load competitions");
        return res.json();
      })
      .then((data) => {
        if (!active || !Array.isArray(data)) return;
        const index: Record<number, { name?: string }> = {};
        data.forEach((item) => {
          if (!item || typeof item.id !== "number") return;
          index[item.id] = { name: item.name ?? undefined };
        });
        setCompetitionIndex(index);
      })
      .catch(() => {
        if (!active) return;
        setCompetitionIndex({});
      });
    return () => {
      active = false;
    };
  }, []);

  const leaguesData = useMemo(() => {
    return leaguesBase.map((league) => ({
      ...league,
      name: competitionIndex[league.id]?.name ?? `League ${league.id}`,
    }));
  }, [competitionIndex]);

  // Filter all leagues by search
  const filteredLeagues = useMemo(() => {
    let filtered = leaguesData;
    if (countryFilter !== "all") {
      filtered = filtered.filter((l) => l.country === countryFilter);
    }
    if (!query) return filtered;
    const q = query.toLowerCase();
    return filtered.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.country.toLowerCase().includes(q)
    );
  }, [query, countryFilter, leaguesData]);

  const countries = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    COMPETITION_IDS_BY_COUNTRY.forEach((group) => {
      if (!seen.has(group.country)) {
        seen.add(group.country);
        list.push(group.country);
      }
    });
    return list;
  }, []);

  return (
    <div className="p-6 flex flex-col gap-10">

      {/* SEARCH BAR */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="relative w-full max-w-md">
          <IconSearch className="absolute left-3 top-3 h-5 w-5 text-white/70" />
          <input
            type="text"
            placeholder="Rechercher une ligue..."
            className="w-full rounded-lg border border-white/20 bg-white/10 px-10 py-2 text-sm text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400/60"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-col">
          <select
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            className="w-56 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white shadow-sm backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-400/70"
          >
            <option value="all" className="bg-black/80 text-white">
              Tous les pays
            </option>
            {countries.map((country) => (
              <option key={country} value={country} className="bg-black/80 text-white">
                {country}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* TOP 5 LEAGUES */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Top 5 Ligues Europeennes</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-6">
          {TOP_LEAGUES.map((l) => (
            <Card
              key={l.id}
              className="flex flex-col items-center gap-2 sm:gap-4 text-center bg-white/5 border-white/10 text-white backdrop-blur-sm !p-2 sm:!p-4"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.logo} className="h-10 w-10 sm:h-16 sm:w-16" alt={l.name} />
              <div>
                <p className="text-base sm:text-lg font-semibold">{l.name}</p>
                <p className="text-white/70 text-xs sm:text-sm">{l.country}</p>
              </div>
              <Link
                href={`/league/${l.id}`}
                className="text-sky-300 text-xs sm:text-sm font-medium hover:underline"
              >
                Voir la ligue →
              </Link>
            </Card>
          ))}
        </div>
      </div>

      {/* ALL LEAGUES DROPDOWN */}
      <div className="flex flex-col gap-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-blue-600 text-sm font-medium hover:underline"
        >
          {expanded ? "Masquer toutes les ligues ↑" : "Afficher toutes les ligues ↓"}
        </button>

        {expanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredLeagues.map((l) => (
              <Card
                key={l.id}
                className="flex items-center justify-between bg-white/5 border-white/10 text-white backdrop-blur-sm !p-2 sm:!p-4"
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://media.api-sports.io/football/leagues/${l.id}.png`}
                    className="h-5 w-5 sm:h-6 sm:w-6"
                    alt={l.name}
                  />
                  <div>
                    <p className="text-xs sm:text-sm font-semibold">{l.name}</p>
                    <p className="text-[10px] sm:text-xs text-white/70">{l.country}</p>
                  </div>
                </div>

                <Link
                  href={`/league/${l.id}`}
                  className="text-sky-300 text-[10px] sm:text-xs font-medium hover:underline"
                >
                  Voir →
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
