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
  team_id?: number | null;
  home_name: string | null;
  away_name: string | null;
  pick: string;
  market: "over_under" | "double_chance" | null;
  odd: number | null;
  probability?: number | null;
  hit_rate?: number | null;
  meets_criteria: boolean | null;
  status: "pending" | "hit" | "miss" | null;
  hit?: boolean | null;
};

const criteriaOptions = [
  { key: "all", label: "Tous" },
  { key: "rose", label: "Pick rose" },
  { key: "yellow", label: "Pick jaune" },
] as const;

const oddsFilterOptions = [
  { key: "all", label: "Tous picks" },
  { key: "with_odds", label: "Odds ≥ 1.18" },
] as const;

const marketOptions = [
  { key: "all", label: "Tous marchés" },
  { key: "over_under", label: "Over / Under" },
  { key: "double_chance", label: "Double Chance" },
] as const;

const dayOptions = [7, 30, 90];
const MIN_COMBO_ODDS = 1.75;
const MAX_COMBO_ODDS = 3;
const MAX_COMBO_CANDIDATES = 18;
const MAX_COMBOS = 6;
const BASE_BANKROLL = 1000;
const STAKE = 10;
const MIN_ODDS_FILTER = 1.18;

type Combo = {
  legs: PickRow[];
  totalOdd: number;
  avgHitRate: number;
};

export default function PicksHistoryPage() {
  const [items, setItems] = useState<PickRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [criteria, setCriteria] = useState<"all" | "rose" | "yellow">("all");
  const [market, setMarket] = useState<"all" | "over_under" | "double_chance">("all");
  const [oddsFilter, setOddsFilter] = useState<"all" | "with_odds">("all");
  const [days, setDays] = useState(30);
  const historyUrl = useMemo(
    () => `/api/picks/history?days=${days}&criteria=${criteria}&market=${market}&v=${refreshKey}`,
    [criteria, market, days, refreshKey]
  );
  const dailyAlgoUrl = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
    return `${base.replace(/\/$/, "")}/api/jobs/daily-algo?task=all`;
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch(historyUrl, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.error || "Erreur chargement historique");
        }
        return body;
      })
      .then((data) => {
        if (!active) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
      })
      .catch((err: any) => {
        if (!active) return;
        setItems([]);
        setError(err?.message ?? "Erreur chargement historique");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [historyUrl]);

  const runManualSnapshot = async () => {
    setSnapshotLoading(true);
    setSnapshotMessage(null);
    try {
      const res = await fetch(dailyAlgoUrl, { method: "GET" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setSnapshotMessage(
        `Snapshot OK (nouveaux: ${body?.created ?? "?"}, maj: ${body?.updated ?? "?"}, resolved: ${body?.resolved ?? "?"})`
      );
      setRefreshKey((prev) => prev + 1);
    } catch (err: any) {
      setSnapshotMessage(err?.message ?? "Erreur snapshot");
    } finally {
      setSnapshotLoading(false);
    }
  };

  const displayItems = useMemo(() => {
    if (oddsFilter === "with_odds") {
      return items.filter((row) => Number(row.odd) >= MIN_ODDS_FILTER);
    }
    return items;
  }, [items, oddsFilter]);

  const resolved = useMemo(
    () => displayItems.filter((row) => row.status === "hit" || row.status === "miss"),
    [displayItems]
  );

  const stats = useMemo(() => {
    const totalDisplay = displayItems.length;
    const total = resolved.length;
    const hits = resolved.filter((row) => row.status === "hit").length;
    const misses = resolved.filter((row) => row.status === "miss").length;
    const odds = resolved
      .map((row) => Number(row.odd))
      .filter((val) => Number.isFinite(val) && val > 1);
    const avgOdd = odds.length ? odds.reduce((sum, val) => sum + val, 0) / odds.length : 0;
    const allOdds = displayItems
      .map((row) => Number(row.odd))
      .filter((val) => Number.isFinite(val) && val > 1);
    const avgOddAll = allOdds.length ? allOdds.reduce((sum, val) => sum + val, 0) / allOdds.length : 0;
    const odds130Count = allOdds.filter((val) => val >= 1.3).length;
    const odds125Count = allOdds.filter((val) => val >= 1.25).length;
    const odds118Count = allOdds.filter((val) => val >= 1.18).length;
    const oddsUnder118Count = allOdds.filter((val) => val < 1.18).length;
    const odds130Pct = allOdds.length ? (odds130Count / allOdds.length) * 100 : 0;
    const odds125Pct = allOdds.length ? (odds125Count / allOdds.length) * 100 : 0;
    const odds118Pct = allOdds.length ? (odds118Count / allOdds.length) * 100 : 0;
    const oddsUnder118Pct = allOdds.length
      ? (oddsUnder118Count / allOdds.length) * 100
      : 0;

    const resolvedOdds = resolved.filter((row) => {
      const odd = Number(row.odd);
      return Number.isFinite(odd) && odd > 1;
    });
    const hitRateForMinOdd = (min: number) => {
      const subset = resolvedOdds.filter((row) => Number(row.odd) >= min);
      if (!subset.length) return 0;
      const hitCount = subset.filter((row) => row.status === "hit").length;
      return (hitCount / subset.length) * 100;
    };
    const odds130HitRate = hitRateForMinOdd(1.3);
    const odds125HitRate = hitRateForMinOdd(1.25);
    const odds118HitRate = hitRateForMinOdd(1.18);
    const oddsUnder118HitRate = (() => {
      const subset = resolvedOdds.filter((row) => Number(row.odd) < 1.18);
      if (!subset.length) return 0;
      const hitCount = subset.filter((row) => row.status === "hit").length;
      return (hitCount / subset.length) * 100;
    })();
    let capital = BASE_BANKROLL;
    const points = resolved.map((row, idx) => {
      const odd = Number(row.odd);
      const oddUsed = Number.isFinite(odd) && odd > 1 ? odd : avgOddAll;
      if (Number.isFinite(oddUsed) && oddUsed > 1) {
        capital += row.status === "hit" ? STAKE * (oddUsed - 1) : -STAKE;
      }
      return { x: idx, y: Number(capital.toFixed(2)) };
    });
    const hitRate = total ? (hits / total) * 100 : 0;
    const pickGroups = resolved.reduce<Record<string, { total: number; hits: number }>>(
      (acc, row) => {
        const key = row.pick || "N/A";
        if (!acc[key]) acc[key] = { total: 0, hits: 0 };
        acc[key].total += 1;
        if (row.status === "hit") acc[key].hits += 1;
        return acc;
      },
      {}
    );
    const pickEntries = Object.entries(pickGroups).map(([pick, data]) => {
      const hitRate = data.total ? (data.hits / data.total) * 100 : 0;
      const share = total ? (data.total / total) * 100 : 0;
      return { pick, count: data.total, hitRate, share };
    });
    const topPickEntry = pickEntries.sort((a, b) => b.count - a.count)[0];
    const topPick = topPickEntry ? `${topPickEntry.pick} • ${topPickEntry.count}` : "-";
    return {
      totalDisplay,
      total,
      hits,
      misses,
      avgOdd,
      avgOddAll,
      odds130Pct,
      odds125Pct,
      odds118Pct,
      odds130Count,
      odds125Count,
      odds118Count,
      oddsUnder118Count,
      odds130HitRate,
      odds125HitRate,
      odds118HitRate,
      oddsUnder118HitRate,
      oddsUnder118Pct,
      hitRate,
      points,
      topPick,
      pickEntries,
    };
  }, [resolved, displayItems]);

  const latestSnapshot = useMemo(() => {
    if (!displayItems.length) return "";
    return displayItems.reduce((latest, item) =>
      item.snapshot_date > latest ? item.snapshot_date : latest
    , displayItems[0].snapshot_date);
  }, [displayItems]);

  const comboCandidates = useMemo(() => {
    if (!latestSnapshot) return [];
    const filtered = displayItems.filter((row) => {
      if (row.snapshot_date !== latestSnapshot) return false;
      if (row.status && row.status !== "pending") return false;
      const odd = Number(row.odd);
      return Number.isFinite(odd) && odd > 1;
    });
    return filtered
      .sort((a, b) => (Number(b.probability) || 0) - (Number(a.probability) || 0))
      .slice(0, MAX_COMBO_CANDIDATES);
  }, [displayItems, latestSnapshot]);

  const combos = useMemo(() => {
    const results: Combo[] = [];
    if (comboCandidates.length < 2) return results;

    const hasDuplicateTeam = (legs: PickRow[]) => {
      const seen = new Set<number>();
      for (const leg of legs) {
        const teamId = Number(leg.team_id);
        if (!Number.isFinite(teamId)) continue;
        if (seen.has(teamId)) return true;
        seen.add(teamId);
      }
      return false;
    };

    const hasDuplicateFixture = (legs: PickRow[]) => {
      const seen = new Set<number>();
      for (const leg of legs) {
        const fixtureId = Number(leg.fixture_id);
        if (!Number.isFinite(fixtureId)) continue;
        if (seen.has(fixtureId)) return true;
        seen.add(fixtureId);
      }
      return false;
    };

    const avgHitRate = (legs: PickRow[]) => {
      if (!legs.length) return 0;
      const total = legs.reduce((sum, leg) => sum + (Number(leg.hit_rate) || 0), 0);
      return total / legs.length;
    };

    const inOddRange = (value: number) => value >= MIN_COMBO_ODDS && value <= MAX_COMBO_ODDS;

    const rankCombos = (list: Combo[]) =>
      list.sort((a, b) => {
        if (b.avgHitRate !== a.avgHitRate) return b.avgHitRate - a.avgHitRate;
        return a.totalOdd - b.totalOdd;
      });

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
            if (!inOddRange(totalOdd)) continue;
            const legs = [comboCandidates[i], comboCandidates[j]];
            if (hasDuplicateFixture(legs)) continue;
            if (hasDuplicateTeam(legs)) continue;
            combosLocal.push({
              legs,
              totalOdd,
              avgHitRate: avgHitRate(legs),
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
              if (!inOddRange(totalOdd)) continue;
              const legs = [comboCandidates[i], comboCandidates[j], comboCandidates[k]];
              if (hasDuplicateFixture(legs)) continue;
              if (hasDuplicateTeam(legs)) continue;
              const hasElite = legs.some((leg) => (Number(leg.hit_rate) || 0) >= 0.9);
              if (!hasElite) continue;
              combosLocal.push({
                legs,
                totalOdd,
                avgHitRate: avgHitRate(legs),
              });
            }
          }
        }
      }
      return rankCombos(combosLocal);
    };

    const selectedKeys = new Set<string>();
    const selectCombos = (list: Combo[]) => {
      for (const combo of list) {
        const legsKeys = combo.legs
          .map((leg) => `${leg.fixture_id}:${leg.pick}`)
          .filter(Boolean);
        if (legsKeys.some((key) => selectedKeys.has(key))) continue;
        legsKeys.forEach((key) => selectedKeys.add(key));
        results.push(combo);
        if (results.length >= MAX_COMBOS) break;
      }
    };

    const doubles = buildCombos(2);
    selectCombos(doubles);
    if (results.length < MAX_COMBOS) {
      const triples = buildCombos(3);
      selectCombos(triples);
    }
    return results;
  }, [comboCandidates]);

  return (
    <div className="min-h-screen w-full p-6 text-white space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-yellow-400">Historique Picks (Search Algo)</h1>
        <p className="text-sm text-white/60">
          Suivi automatique des picks, odds et résultats.
        </p>
        <p className="text-xs text-white/50 mt-1">{displayItems.length} pick(s) chargés</p>
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
          {oddsFilterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setOddsFilter(option.key)}
              className={`px-3 py-1 rounded-lg text-sm transition ${
                oddsFilter === option.key
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
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={runManualSnapshot}
            disabled={snapshotLoading}
            className={`px-3 py-1 rounded-lg text-sm transition ${
              snapshotLoading
                ? "bg-white/10 text-white/50 cursor-not-allowed"
                : "bg-pink-500/70 hover:bg-pink-500 text-white"
            }`}
          >
            {snapshotLoading ? "Snapshot..." : "Insérer snapshot"}
          </button>
        </div>
      </div>

      {snapshotMessage ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
          {snapshotMessage}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Picks résolus</div>
          <div className="text-2xl font-semibold">
            {stats.total}
            <span className="text-sm text-white/40 ml-2">/ {stats.totalDisplay}</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Hits / Miss</div>
          <div className="text-2xl font-semibold">
            <span className="text-emerald-300">{stats.hits}</span>
            <span className="text-white/50"> / </span>
            <span className="text-rose-300">{stats.misses}</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Taux de réussite</div>
          <div className="text-2xl font-semibold text-emerald-200">
            {stats.hitRate.toFixed(1)}%
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Cote moyenne (tous picks)</div>
          <div className="text-2xl font-semibold">{stats.avgOddAll.toFixed(2)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Odds minimum</div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-white/70">≥ 1.30</span>
              <span className="text-emerald-200">
                {stats.odds130Pct.toFixed(1)}%
                <span className="text-white/40 text-xs ml-2">{stats.odds130Count}</span>
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-white/60">
              <span>Hit rate</span>
              <span>{stats.odds130HitRate.toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/70">≥ 1.25</span>
              <span className="text-emerald-200">
                {stats.odds125Pct.toFixed(1)}%
                <span className="text-white/40 text-xs ml-2">{stats.odds125Count}</span>
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-white/60">
              <span>Hit rate</span>
              <span>{stats.odds125HitRate.toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/70">≥ 1.18</span>
              <span className="text-emerald-200">
                {stats.odds118Pct.toFixed(1)}%
                <span className="text-white/40 text-xs ml-2">{stats.odds118Count}</span>
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-white/60">
              <span>Hit rate</span>
              <span>{stats.odds118HitRate.toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between pt-1 mt-1 border-t border-white/10">
              <span className="text-white/70">&lt; 1.18</span>
              <span className="text-emerald-200">
                {stats.oddsUnder118Pct.toFixed(1)}%
                <span className="text-white/40 text-xs ml-2">{stats.oddsUnder118Count}</span>
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-white/60">
              <span>Hit rate</span>
              <span>{stats.oddsUnder118HitRate.toFixed(1)}%</span>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Pick le plus sélectionné</div>
          <div className="text-2xl font-semibold">{stats.topPick}</div>
          {stats.pickEntries.length ? (
            <div className="mt-3 space-y-1 text-[11px] text-white/70 max-h-40 overflow-y-auto pr-1">
              {stats.pickEntries
                .slice()
                .sort((a, b) => b.count - a.count)
                .map((entry) => (
                  <div
                    key={`pick-${entry.pick}`}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{entry.pick}</span>
                    <span className="text-white/50">
                      {entry.share.toFixed(1)}% • {entry.hitRate.toFixed(1)}%
                    </span>
                  </div>
                ))}
            </div>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white/70 text-sm">
          Chargement des picks...
        </div>
      ) : (
        <PicksChart
          points={stats.points}
          label="Évolution du capital"
          subLabel={`(${BASE_BANKROLL}$ base • ${STAKE}$ / mise)`}
        />
      )}

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <div className="text-sm font-semibold">Combinés automatiques</div>
              <div className="text-xs text-white/60">
              Fourchette {MIN_COMBO_ODDS.toFixed(2)} – {MAX_COMBO_ODDS.toFixed(2)} • 2 matchs prioritaires
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
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-200">
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
            Pas assez de picks pour générer un combiné dans la fourchette demandée.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-sm font-semibold mb-3">Derniers picks</div>
        <div className="space-y-2">
          {(() => {
            const seen = new Set<string>();
            const unique = [];
            for (let i = displayItems.length - 1; i >= 0; i -= 1) {
              const row = displayItems[i];
              const key = `${row.fixture_id ?? ""}:${row.pick ?? ""}:${row.home_name ?? ""}:${row.away_name ?? ""}`;
              if (seen.has(key)) continue;
              seen.add(key);
              unique.push(row);
              if (unique.length >= 10) break;
            }
            return unique.reverse();
          })().map((row) => (
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
          {!displayItems.length && !loading ? (
            <div className="text-white/60 text-sm">Aucun pick enregistré.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
