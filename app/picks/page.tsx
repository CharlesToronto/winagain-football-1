"use client";

import { useEffect, useMemo, useState } from "react";
import PicksChart from "./components/PicksChart";

type PickRow = {
  id: string;
  snapshot_date: string;
  fixture_date_utc: string | null;
  fixture_id: number;
  league_id: number | null;
  competition_name: string | null;
  home_name: string | null;
  away_name: string | null;
  pick: string;
  market: "over_under" | "double_chance" | null;
  odd: number | null;
  probability?: number | null;
  meets_criteria: boolean | null;
  status: "pending" | "hit" | "miss" | null;
  hit?: boolean | null;
};

const criteriaOptions = [
  { key: "all", label: "Tous" },
  { key: "rose", label: "Pick rose" },
  { key: "yellow", label: "Pick jaune" },
] as const;

const marketOptions = [
  { key: "all", label: "Tous marchés" },
  { key: "over_under", label: "Over / Under" },
  { key: "double_chance", label: "Double Chance" },
] as const;

const dayOptions = [7, 30, 90];
const TARGET_COMBO_ODDS = 1.9;
const MIN_COMBO_ODDS = 1.75;
const MAX_COMBO_CANDIDATES = 18;
const MAX_COMBOS = 6;

type Combo = {
  legs: PickRow[];
  totalOdd: number;
  aboveTarget: boolean;
  score: number;
};

export default function PicksHistoryPage() {
  const [items, setItems] = useState<PickRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [criteria, setCriteria] = useState<"all" | "rose" | "yellow">("all");
  const [market, setMarket] = useState<"all" | "over_under" | "double_chance">("all");
  const [days, setDays] = useState(30);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/picks/history?days=${days}&criteria=${criteria}&market=${market}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => {
        if (!active) return;
        setItems([]);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [criteria, market, days]);

  const resolved = useMemo(
    () => items.filter((row) => row.status === "hit" || row.status === "miss"),
    [items]
  );

  const stats = useMemo(() => {
    const total = resolved.length;
    const hits = resolved.filter((row) => row.status === "hit").length;
    const misses = resolved.filter((row) => row.status === "miss").length;
    const odds = resolved.map((row) => Number(row.odd)).filter((val) => Number.isFinite(val));
    const avgOdd = odds.length ? odds.reduce((sum, val) => sum + val, 0) / odds.length : 0;
    let profit = 0;
    const points = resolved.map((row, idx) => {
      const odd = Number(row.odd);
      if (Number.isFinite(odd)) {
        profit += row.status === "hit" ? odd - 1 : -1;
      }
      return { x: idx, y: Number(profit.toFixed(2)) };
    });
    return { total, hits, misses, avgOdd, points };
  }, [resolved]);

  const latestSnapshot = useMemo(() => {
    if (!items.length) return "";
    return items.reduce((latest, item) =>
      item.snapshot_date > latest ? item.snapshot_date : latest
    , items[0].snapshot_date);
  }, [items]);

  const comboCandidates = useMemo(() => {
    if (!latestSnapshot) return [];
    const filtered = items.filter((row) => {
      if (row.snapshot_date !== latestSnapshot) return false;
      if (row.status && row.status !== "pending") return false;
      const odd = Number(row.odd);
      return Number.isFinite(odd) && odd > 1;
    });
    return filtered
      .sort((a, b) => (Number(b.probability) || 0) - (Number(a.probability) || 0))
      .slice(0, MAX_COMBO_CANDIDATES);
  }, [items, latestSnapshot]);

  const combos = useMemo(() => {
    const results: Combo[] = [];
    if (comboCandidates.length < 2) return results;

    const buildCombos = (legsCount: number) => {
      const combosLocal: Combo[] = [];
      const n = comboCandidates.length;
      if (legsCount === 2) {
        for (let i = 0; i < n - 1; i += 1) {
          const oddA = Number(comboCandidates[i].odd);
          if (!Number.isFinite(oddA)) continue;
          for (let j = i + 1; j < n; j += 1) {
            const oddB = Number(comboCandidates[j].odd);
            if (!Number.isFinite(oddB)) continue;
            const totalOdd = Number((oddA * oddB).toFixed(2));
            if (totalOdd < MIN_COMBO_ODDS) continue;
            combosLocal.push({
              legs: [comboCandidates[i], comboCandidates[j]],
              totalOdd,
              aboveTarget: totalOdd >= TARGET_COMBO_ODDS,
              score: Math.abs(totalOdd - TARGET_COMBO_ODDS),
            });
          }
        }
      }
      if (legsCount === 3) {
        for (let i = 0; i < n - 2; i += 1) {
          const oddA = Number(comboCandidates[i].odd);
          if (!Number.isFinite(oddA)) continue;
          for (let j = i + 1; j < n - 1; j += 1) {
            const oddB = Number(comboCandidates[j].odd);
            if (!Number.isFinite(oddB)) continue;
            for (let k = j + 1; k < n; k += 1) {
              const oddC = Number(comboCandidates[k].odd);
              if (!Number.isFinite(oddC)) continue;
              const totalOdd = Number((oddA * oddB * oddC).toFixed(2));
              if (totalOdd < MIN_COMBO_ODDS) continue;
              combosLocal.push({
                legs: [comboCandidates[i], comboCandidates[j], comboCandidates[k]],
                totalOdd,
                aboveTarget: totalOdd >= TARGET_COMBO_ODDS,
                score: Math.abs(totalOdd - TARGET_COMBO_ODDS),
              });
            }
          }
        }
      }
      return combosLocal.sort((a, b) => {
        if (a.aboveTarget !== b.aboveTarget) return a.aboveTarget ? -1 : 1;
        if (a.score !== b.score) return a.score - b.score;
        return a.totalOdd - b.totalOdd;
      });
    };

    const doubles = buildCombos(2);
    results.push(...doubles.slice(0, MAX_COMBOS));
    if (results.length < MAX_COMBOS) {
      const triples = buildCombos(3);
      results.push(...triples.slice(0, MAX_COMBOS - results.length));
    }
    return results;
  }, [comboCandidates]);

  return (
    <div className="min-h-screen w-full p-6 text-white space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Historique Picks (Search Algo)</h1>
        <p className="text-sm text-white/60">
          Suivi automatique des picks, odds et résultats.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          {criteriaOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setCriteria(option.key)}
              className={`px-3 py-1 rounded-lg text-sm transition ${
                criteria === option.key
                  ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                  : "bg-white/10 text-white/70 hover:bg-white/20"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {marketOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setMarket(option.key)}
              className={`px-3 py-1 rounded-lg text-sm transition ${
                market === option.key
                  ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                  : "bg-white/10 text-white/70 hover:bg-white/20"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {dayOptions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDays(option)}
              className={`px-3 py-1 rounded-lg text-sm transition ${
                days === option
                  ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                  : "bg-white/10 text-white/70 hover:bg-white/20"
              }`}
            >
              {option} jours
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Picks résolus</div>
          <div className="text-2xl font-semibold">{stats.total}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Hits</div>
          <div className="text-2xl font-semibold text-emerald-300">{stats.hits}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Miss</div>
          <div className="text-2xl font-semibold text-rose-300">{stats.misses}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Cote moyenne</div>
          <div className="text-2xl font-semibold">{stats.avgOdd.toFixed(2)}</div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white/70 text-sm">
          Chargement des picks...
        </div>
      ) : (
        <PicksChart points={stats.points} />
      )}

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <div className="text-sm font-semibold">Combinés automatiques</div>
            <div className="text-xs text-white/60">
              Cote cible {TARGET_COMBO_ODDS.toFixed(2)} (tolérance jusqu’à {MIN_COMBO_ODDS.toFixed(2)})
            </div>
          </div>
          {latestSnapshot ? (
            <div className="text-xs text-white/50">Snapshot: {latestSnapshot}</div>
          ) : null}
        </div>
        {combos.length ? (
          <div className="space-y-3">
            {combos.map((combo, idx) => (
              <div
                key={`${combo.totalOdd}-${idx}`}
                className="rounded-lg border border-white/10 bg-white/5 p-3"
              >
                <div className="flex items-center justify-between text-xs text-white/70 mb-2">
                  <span>{combo.legs.length} matchs</span>
                  <span
                    className={`px-2 py-0.5 rounded-md ${
                      combo.aboveTarget
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "bg-yellow-500/20 text-yellow-200"
                    }`}
                  >
                    Cote totale {combo.totalOdd.toFixed(2)}
                  </span>
                </div>
                <div className="space-y-2 text-xs text-white/80">
                  {combo.legs.map((leg) => (
                    <div key={leg.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate">
                          {leg.home_name ?? "Home"} vs {leg.away_name ?? "Away"}
                        </div>
                        <div className="text-white/50">
                          {leg.pick} • {leg.odd ?? "-"}
                        </div>
                      </div>
                      <div
                        className={`px-2 py-0.5 rounded-md text-[11px] ${
                          leg.meets_criteria
                            ? "bg-rose-500/20 text-rose-200"
                            : "bg-yellow-500/20 text-yellow-200"
                        }`}
                      >
                        {leg.meets_criteria ? "Rose" : "Jaune"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-white/60">
            Pas assez de picks pour générer un combiné avec la cote cible.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-sm font-semibold mb-3">Derniers picks</div>
        <div className="space-y-2">
          {items.slice(-10).map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between text-xs text-white/80"
            >
              <div className="min-w-0">
                <div className="truncate">
                  {row.home_name ?? "Home"} vs {row.away_name ?? "Away"}
                </div>
                <div className="text-white/50">
                  {row.pick} • {row.odd ?? "-"}
                </div>
              </div>
              <div
                className={`px-2 py-0.5 rounded-md ${
                  row.status === "hit"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : row.status === "miss"
                      ? "bg-rose-500/20 text-rose-300"
                      : "bg-white/10 text-white/60"
                }`}
              >
                {row.status ?? "pending"}
              </div>
            </div>
          ))}
          {!items.length && !loading ? (
            <div className="text-white/60 text-sm">Aucun pick enregistré.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
