"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Card from "@/app/components/ui/Card";
import { useAlgoSettings } from "@/app/components/algo/useAlgoSettings";

const THRESHOLD_OPTIONS = [0.55, 0.6, 0.65, 0.7, 0.75];
const MIN_PICKS_OPTIONS = [10, 20, 30, 40, 50];

type RankingRow = {
  id: number;
  name: string;
  logo?: string | null;
  picks: number;
  hits: number;
  hitRate: number;
};

type TeamHitRankingProps = {
  leagueId?: number;
  currentSeason: number;
};

export default function TeamHitRanking({ leagueId, currentSeason }: TeamHitRankingProps) {
  const [season, setSeason] = useState(currentSeason);
  const [minPicks, setMinPicks] = useState(20);
  const [results, setResults] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { settings, updateSettings } = useAlgoSettings();

  const canFetch = Number.isFinite(leagueId);

  useEffect(() => {
    if (!canFetch) {
      setResults([]);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      leagueId: String(leagueId),
      season: String(season),
      threshold: String(settings.threshold),
      minPicks: String(minPicks),
      limit: "20",
      windowSize: String(settings.windowSize),
      bucketSize: String(settings.bucketSize),
      weights: settings.weights.join(","),
      minMatches: String(settings.minMatches),
      minLeagueMatches: String(settings.minLeagueMatches),
      lines: settings.lines.join(","),
    });

    fetch(`/api/search/team-rankings?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || "Erreur chargement classement");
        }
        return data;
      })
      .then((data) => {
        if (!Array.isArray(data?.results)) {
          setResults([]);
          return;
        }
        setResults(data.results as RankingRow[]);
      })
      .catch((err: any) => {
        if (err?.name === "AbortError") return;
        setError(err?.message ?? "Erreur chargement classement");
        setResults([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [canFetch, leagueId, season, settings, minPicks]);

  const rows = useMemo(() => results.slice(0, 20), [results]);

  return (
    <Card className="bg-white/10 border-white/10 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-sm text-white/60">Classement</p>
          <h2 className="text-xl font-semibold">Meilleur HIT par équipe</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {[currentSeason, currentSeason - 1].map((value) => (
            <button
              key={`season-${value}`}
              type="button"
              onClick={() => setSeason(value)}
              className={`px-3 py-1 rounded-lg text-sm transition ${
                season === value
                  ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                  : "bg-white/10 text-white/70 hover:bg-white/15"
              }`}
            >
              Season {value}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {THRESHOLD_OPTIONS.map((value) => (
            <button
              key={`thr-${value}`}
              type="button"
              onClick={() => updateSettings({ threshold: value })}
              className={`px-3 py-1 rounded-lg text-sm transition ${
                settings.threshold === value
                  ? "bg-blue-500 text-white"
                  : "bg-white/10 text-white/70 hover:bg-white/15"
              }`}
            >
              &gt;= {value.toFixed(2)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-sm text-white/70">
          <span>Min picks</span>
          <select
            className="rounded bg-[#1f0f3a] border border-white/20 px-2 py-1 text-sm text-white [color-scheme:dark]"
            value={minPicks}
            onChange={(e) => setMinPicks(Number(e.target.value))}
          >
            {MIN_PICKS_OPTIONS.map((value) => (
              <option key={`min-${value}`} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!canFetch ? (
        <p className="text-sm text-white/70">Choisis une ligue pour afficher le classement.</p>
      ) : loading ? (
        <p className="text-sm text-white/70">Chargement du classement...</p>
      ) : error ? (
        <p className="text-sm text-red-200">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-white/70">Aucun résultat avec ces filtres.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div
              key={`rank-${row.id}`}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border border-white/10 rounded-lg px-3 py-2 bg-white/5"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs text-white/50 w-6">#{index + 1}</span>
                {row.logo ? (
                  <img src={row.logo} alt={row.name} className="w-8 h-8 object-contain" />
                ) : null}
                <div>
                  <Link href={`/team/${row.id}`} className="text-sm font-medium hover:underline">
                    {row.name}
                  </Link>
                  <p className="text-xs text-white/60">Picks {row.picks} • Hits {row.hits}</p>
                </div>
              </div>
              <div className="text-sm font-semibold text-white">
                {(row.hitRate * 100).toFixed(1)}%
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
