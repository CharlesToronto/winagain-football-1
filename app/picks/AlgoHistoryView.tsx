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
  competition_country?: string | null;
  team_id?: number | null;
  home_name: string | null;
  away_name: string | null;
  pick: string;
  market: string | null;
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
    { key: "1x2", label: "1X2" },
    { key: "btts", label: "BTTS" },
    { key: "dnb", label: "DNB" },
    { key: "team_total", label: "Team Total" },
  ] as const;

const ALL_DAYS = 36500;
const MIN_COMBO_ODDS = 1.75;
const MAX_COMBO_ODDS = 3;
const MAX_COMBO_CANDIDATES = Number.POSITIVE_INFINITY;
const MAX_COMBOS = Number.POSITIVE_INFINITY;
const BASE_BANKROLL = 1000;
const STAKE = 10;
const MIN_ODDS_FILTER = 1.18;
const DISCOURAGED_COMPETITIONS = new Set([
  "Israel|||Liga Leumit",
  "Scotland|||Football League - Highland League",
  "Scotland|||League One",
  "Belgium|||Challenger Pro League",
  "Hungary|||NB II",
  "Italy|||Serie C - Girone A",
]);
const COMBO_BLACKLIST = DISCOURAGED_COMPETITIONS;

type Combo = {
  legs: PickRow[];
  totalOdd: number;
  avgHitRate: number;
  status?: "hit" | "miss" | "pending";
  snapshotDate?: string;
};

export default function AlgoHistoryView({
  view = "singles",
}: {
  view?: "singles" | "combos";
}) {
  const [items, setItems] = useState<PickRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [showPickList, setShowPickList] = useState(false);
  const [showMarketExclusions, setShowMarketExclusions] = useState(false);
  const [excludedMarkets, setExcludedMarkets] = useState<string[]>([]);
  const [excludedLines, setExcludedLines] = useState<string[]>([]);
  const [excludedPickCodes, setExcludedPickCodes] = useState<string[]>([]);
  const algoVersion = "v3";
  const [criteria, setCriteria] = useState<"all" | "rose" | "yellow">("all");
  const [market, setMarket] = useState<
    "all" | "over_under" | "double_chance" | "1x2" | "btts" | "dnb" | "team_total"
  >("all");
  const [oddsFilter, setOddsFilter] = useState<"all" | "with_odds">("all");
  const days = ALL_DAYS;
  const historyUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("days", String(days));
    params.set("criteria", criteria);
    if (market !== "all") params.set("market", market);
    params.set("algo", algoVersion);
    params.set("v", String(refreshKey));
    return `/api/picks/history?${params.toString()}`;
  }, [criteria, market, days, refreshKey, algoVersion]);

  const refresh = () => setRefreshKey(Date.now());

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const fetchJson = async (url: string) => {
      const res = await fetch(url, { cache: "no-store" });
      const raw = await res.text();
      const cleaned = raw.replace(/^\uFEFF/, "").trim();
      let body: any = {};
      try {
        body = cleaned ? JSON.parse(cleaned) : {};
      } catch {
        throw new Error("Réponse JSON invalide.");
      }
      if (!res.ok) {
        throw new Error(body?.error || "Erreur chargement historique");
      }
      return body;
    };

    fetchJson(historyUrl)
      .then(async (data) => {
        if (!active) return;
        let items = Array.isArray(data?.items) ? data.items : [];
        if (market === "all" && items.length === 0) {
          const baseParams = new URLSearchParams();
          baseParams.set("days", String(days));
          baseParams.set("criteria", criteria);
          baseParams.set("algo", algoVersion);
          const fallbackMarkets = ["over_under", "double_chance", "1x2", "btts", "dnb", "team_total"];
          const results = await Promise.all(
            fallbackMarkets.map((m) => {
              const params = new URLSearchParams(baseParams);
              params.set("market", m);
              return fetchJson(`/api/picks/history?${params.toString()}`);
            })
          );
          const merged = new Map<string, any>();
          results.forEach((resBody) => {
            const list = Array.isArray(resBody?.items) ? resBody.items : [];
            list.forEach((row: any) => {
              if (row?.id) merged.set(String(row.id), row);
            });
          });
          items = Array.from(merged.values());
        }
        setItems(items);
        setLastFetchedAt(Date.now());
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

  useEffect(() => {
    setCriteria("all");
    setMarket("all");
    setOddsFilter("all");
    setExcludedMarkets([]);
    setExcludedLines([]);
    setExcludedPickCodes([]);
    // Use a unique key so /api/picks/history cannot be served from a stale cache.
    setRefreshKey(Date.now());
  }, [algoVersion]);

  useEffect(() => {
    let lastTrigger = 0;
    const triggerRefresh = () => {
      const now = Date.now();
      if (now - lastTrigger < 1500) return;
      lastTrigger = now;
      refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") triggerRefresh();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // When coming back via browser "Back" (bfcache), React state is restored
      // and effects may not refetch. Force a refresh in that case.
      if (event.persisted) triggerRefresh();
    };
    window.addEventListener("focus", triggerRefresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("focus", triggerRefresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  function extractPickLineLabel(pick: string) {
    const match = String(pick ?? "").match(/([0-9]+(?:[.,][0-9]+)?)/);
    if (!match) return null;
    const value = match[1].replace(",", ".");
    return value;
  }

  function extractPickCode(pick: string) {
    const trimmed = String(pick ?? "").trim().toUpperCase();
    if (trimmed === "1X" || trimmed === "X2" || trimmed === "12") return trimmed;
    return null;
  }

  const displayItems = useMemo(() => {
    let next = items;
    if (oddsFilter === "with_odds") {
      next = next.filter((row) => Number(row.odd) >= MIN_ODDS_FILTER);
    }
    if (excludedMarkets.length) {
      next = next.filter((row) => !excludedMarkets.includes(String(row.market ?? "")));
    }
    if (excludedLines.length || excludedPickCodes.length) {
      next = next.filter((row) => {
        const pick = String(row.pick ?? "");
        const line = extractPickLineLabel(pick);
        if (line && excludedLines.includes(line)) return false;
        const code = extractPickCode(pick);
        if (code && excludedPickCodes.includes(code)) return false;
        return true;
      });
    }
    if (algoVersion === "v3" && items.length > 0 && next.length === 0) {
      return items;
    }
    return next;
  }, [items, oddsFilter, excludedMarkets, excludedLines, excludedPickCodes, algoVersion]);

  const filteredStatsItems = useMemo(() => {
    return displayItems.filter((row) => {
      const country = row.competition_country ?? "";
      const name = row.competition_name ?? "";
      if (!country || !name) return true;
      return !DISCOURAGED_COMPETITIONS.has(`${country}|||${name}`);
    });
  }, [displayItems]);

  const displayItemsSorted = useMemo(() => {
    return [...displayItems].sort((a, b) => {
      const aDate = a.fixture_date_utc ? new Date(a.fixture_date_utc).getTime() : 0;
      const bDate = b.fixture_date_utc ? new Date(b.fixture_date_utc).getTime() : 0;
      return bDate - aDate;
    });
  }, [displayItems]);

  const resolved = useMemo(
    () => filteredStatsItems.filter((row) => row.status === "hit" || row.status === "miss"),
    [filteredStatsItems]
  );

  const downloadCsv = (scope: "all" | "hit" | "miss") => {
    const source =
      scope === "all"
        ? displayItems
        : resolved.filter((row) => row.status === scope);
    if (!source.length) return;

    const columns: Array<keyof PickRow> = [
      "id",
      "snapshot_date",
      "fixture_date_utc",
      "fixture_id",
      "league_id",
      "competition_name",
      "team_id",
      "home_name",
      "away_name",
      "pick",
      "market",
      "odd",
      "probability",
      "hit_rate",
      "meets_criteria",
      "status",
      "hit",
    ];

    const escapeCell = (value: any) => {
      const str = value == null ? "" : String(value);
      if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };

    const header = columns.join(",");
    const rows = source.map((row) =>
      columns.map((col) => escapeCell((row as any)[col])).join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateLabel = new Date().toISOString().slice(0, 10);
    const suffix = scope === "all" ? "tous" : scope === "hit" ? "gagnes" : "perdus";
    link.href = url;
    link.download = `picks_${suffix}_${dateLabel}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const analyzedMatches = useMemo(() => {
    const ids = new Set<number>();
    displayItems.forEach((row) => {
      const id = Number(row.fixture_id);
      if (Number.isFinite(id)) ids.add(id);
    });
    return ids.size;
  }, [displayItems]);

  const matchesWithoutOddsStats = useMemo(() => {
    const fixtureHasOdds = new Map<number, boolean>();
    displayItems.forEach((row) => {
      const fixtureId = Number(row.fixture_id);
      if (!Number.isFinite(fixtureId)) return;
      const odd = Number(row.odd);
      const hasOdds = Number.isFinite(odd) && odd > 1;
      fixtureHasOdds.set(fixtureId, (fixtureHasOdds.get(fixtureId) ?? false) || hasOdds);
    });
    const totalMatches = fixtureHasOdds.size;
    let matchesWithoutOdds = 0;
    fixtureHasOdds.forEach((hasOdds) => {
      if (!hasOdds) matchesWithoutOdds += 1;
    });
    const ratioPct = totalMatches ? (matchesWithoutOdds / totalMatches) * 100 : 0;
    return { matchesWithoutOdds, totalMatches, ratioPct };
  }, [displayItems]);

  const availableMarkets = useMemo(() => {
    const unique = new Set<string>();
    items.forEach((row) => {
      const key = String(row.market ?? "").trim();
      if (key) unique.add(key);
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const marketLabel = (value: string) => {
    if (value === "over_under") return "Over / Under";
    if (value === "double_chance") return "Double Chance";
    if (value === "1x2") return "1X2";
    if (value === "btts") return "BTTS";
    if (value === "dnb") return "DNB";
    if (value === "team_total") return "Team Total";
    if (value === "other") return "Autre";
    return value;
  };

  const toggleMarketExclusion = (value: string) => {
    setExcludedMarkets((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  };

  const availableLines = useMemo(() => {
    const unique = new Set<string>();
    items.forEach((row) => {
      const line = extractPickLineLabel(String(row.pick ?? ""));
      if (line) unique.add(line);
    });
    const allowed = new Set(["1.5", "2.5", "3.5", "4.5"]);
    return Array.from(unique)
      .filter((value) => allowed.has(value))
      .sort((a, b) => Number(a) - Number(b));
  }, [items]);

  const availablePickCodes = useMemo(() => {
    const unique = new Set<string>();
    items.forEach((row) => {
      const code = extractPickCode(String(row.pick ?? ""));
      if (code) unique.add(code);
    });
    return Array.from(unique).sort();
  }, [items]);

  const toggleLineExclusion = (value: string) => {
    setExcludedLines((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  };

  const togglePickCodeExclusion = (value: string) => {
    setExcludedPickCodes((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  };

  const stats = useMemo(() => {
    const totalDisplay = displayItems.length;
    const resolvedAll = displayItems.filter(
      (row) => row.status === "hit" || row.status === "miss"
    );
    const totalAll = resolvedAll.length;
    const hitsAll = resolvedAll.filter((row) => row.status === "hit").length;
    const missesAll = resolvedAll.filter((row) => row.status === "miss").length;
    const hitRateAll = totalAll ? (hitsAll / totalAll) * 100 : 0;
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
    const finalCapital = points.length ? points[points.length - 1].y : BASE_BANKROLL;
    const roiPct = ((finalCapital - BASE_BANKROLL) / BASE_BANKROLL) * 100;
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
      totalAll,
      total,
      hitsAll,
      hits,
      missesAll,
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
      hitRateAll,
      hitRate,
      roiPct,
      points,
      topPick,
      pickEntries,
    };
  }, [resolved, displayItems]);

  const competitionStats = useMemo(() => {
    const totals = new Map<string, { total: number; hits: number }>();
    displayItems.forEach((row) => {
      const country = row.competition_country ?? "Inconnu";
      const name = row.competition_name ?? "Competition";
      const key = `${country}|||${name}`;
      const current = totals.get(key) ?? { total: 0, hits: 0 };
      current.total += 1;
      if (row.status === "hit") current.hits += 1;
      totals.set(key, current);
    });
    const result = Array.from(totals.entries()).map(([key, data]) => {
      const [country, name] = key.split("|||");
      const hitRate = data.total ? (data.hits / data.total) * 100 : 0;
      const share = displayItems.length ? (data.total / displayItems.length) * 100 : 0;
      return { country, name, total: data.total, hits: data.hits, hitRate, share };
    });
    return result.sort((a, b) => b.total - a.total);
  }, [displayItems]);

  const competitionSummary = useMemo(() => {
    const totalPicks = displayItems.length;
    const totalHits = displayItems.filter((row) => row.status === "hit").length;
    const hitRate = totalPicks ? (totalHits / totalPicks) * 100 : 0;
    const totalCompetitions = competitionStats.length;
    const avgPicks = totalCompetitions ? totalPicks / totalCompetitions : 0;
    return { totalPicks, totalHits, hitRate, totalCompetitions, avgPicks };
  }, [displayItems, competitionStats]);

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
      if (String(row.pick ?? "").trim().toUpperCase() === "12") return false;
      const odd = Number(row.odd);
      return Number.isFinite(odd) && odd > 1;
    });
    return filtered
      .sort((a, b) => (Number(b.probability) || 0) - (Number(a.probability) || 0))
      .slice(0, MAX_COMBO_CANDIDATES);
  }, [displayItems, latestSnapshot]);

  const buildComboCandidates = (rows: PickRow[]) => {
    const filtered = rows.filter((row) => {
      const country = row.competition_country ?? "";
      const name = row.competition_name ?? "";
      if (!country || !name) return false;
      if (COMBO_BLACKLIST.has(`${country}|||${name}`)) return false;
      if (String(row.pick ?? "").trim().toUpperCase() === "12") return false;
      const odd = Number(row.odd);
      return Number.isFinite(odd) && odd > 1;
    });
    const sorted = filtered.sort(
      (a, b) => (Number(b.probability) || 0) - (Number(a.probability) || 0)
    );
    if (Number.isFinite(MAX_COMBO_CANDIDATES) && MAX_COMBO_CANDIDATES > 0) {
      return sorted.slice(0, MAX_COMBO_CANDIDATES);
    }
    return sorted;
  };

  const buildCombosForCandidates = (candidates: PickRow[], legsCount = 2) => {
    const combosLocal: Combo[] = [];
    const n = candidates.length;
    const inOddRange = (value: number) => value >= MIN_COMBO_ODDS && value <= MAX_COMBO_ODDS;

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

    const hasDuplicateFixtureMarket = (legs: PickRow[]) => {
      const seen = new Set<string>();
      for (const leg of legs) {
        const fixtureId = Number(leg.fixture_id);
        const market = String(leg.market ?? "");
        if (!Number.isFinite(fixtureId) || !market) continue;
        const key = `${fixtureId}:${market}`;
        if (seen.has(key)) return true;
        seen.add(key);
      }
      return false;
    };

    const avgHitRate = (legs: PickRow[]) => {
      if (!legs.length) return 0;
      const total = legs.reduce((sum, leg) => sum + (Number(leg.hit_rate) || 0), 0);
      return total / legs.length;
    };

    if (legsCount === 2) {
      for (let i = 0; i < n - 1; i += 1) {
        const oddA = Number(candidates[i].odd);
        if (!Number.isFinite(oddA)) continue;
        for (let j = i + 1; j < n; j += 1) {
          const oddB = Number(candidates[j].odd);
          if (!Number.isFinite(oddB)) continue;
          const totalOdd = Number((oddA * oddB).toFixed(2));
          if (!inOddRange(totalOdd)) continue;
          const legs = [candidates[i], candidates[j]];
          if (hasDuplicateFixture(legs)) continue;
          if (hasDuplicateFixtureMarket(legs)) continue;
          if (hasDuplicateTeam(legs)) continue;
          combosLocal.push({
            legs,
            totalOdd,
            avgHitRate: avgHitRate(legs),
          });
        }
      }
    }

    return combosLocal.sort((a, b) => {
      if (b.avgHitRate !== a.avgHitRate) return b.avgHitRate - a.avgHitRate;
      return a.totalOdd - b.totalOdd;
    });
  };

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

    const rankCombos = (list: Combo[]) =>
      list.sort((a, b) => {
        if (b.avgHitRate !== a.avgHitRate) return b.avgHitRate - a.avgHitRate;
        return a.totalOdd - b.totalOdd;
      });

    const buildCombos = (legsCount: number) => {
      const combosLocal = buildCombosForCandidates(comboCandidates, legsCount);
      return rankCombos(combosLocal);
    };

    const selectedKeys = new Set<string>();
    const selectCombos = (list: Combo[]) => {
      for (const combo of list) {
        const legsKeys = combo.legs
          .map((leg) => {
            const market = String(leg.market ?? "");
            return `${leg.fixture_id}:${market || leg.pick}`;
          })
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

  const combosHistory = useMemo(() => {
    const grouped = new Map<string, PickRow[]>();
    displayItems.forEach((row) => {
      if (!row.snapshot_date) return;
      const list = grouped.get(row.snapshot_date) ?? [];
      list.push(row);
      grouped.set(row.snapshot_date, list);
    });

    const dates = Array.from(grouped.keys()).sort();
    const recentDates = dates.slice(-5);
    const historyCombos: Combo[] = [];
    recentDates.forEach((date) => {
      const rows = grouped.get(date) ?? [];
      const candidates = buildComboCandidates(rows);
      const dailyCombos = buildCombosForCandidates(candidates, 2);
      const selectedKeys = new Set<string>();
      const selectedCombos: Combo[] = [];
      for (const combo of dailyCombos) {
        const legsKeys = combo.legs
          .map((leg) => {
            const market = String(leg.market ?? "");
            return `${leg.fixture_id}:${market || leg.pick}`;
          })
          .filter(Boolean);
        if (legsKeys.some((key) => selectedKeys.has(key))) continue;
        legsKeys.forEach((key) => selectedKeys.add(key));
        selectedCombos.push(combo);
        if (selectedCombos.length >= MAX_COMBOS) break;
      }
      const limitedCombos = selectedCombos;
      limitedCombos.forEach((combo) => {
        const statuses = combo.legs.map((leg) => leg.status);
        const status = statuses.every((s) => s === "hit")
          ? "hit"
          : statuses.some((s) => s === "miss")
            ? "miss"
            : "pending";
        historyCombos.push({ ...combo, status, snapshotDate: date });
      });
    });
    return historyCombos;
  }, [displayItems]);

  const combosHistoryAllStats = useMemo(() => {
    const empty = {
      total: 0,
      resolved: 0,
      pending: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      roiPct: 0,
      avgOdd: 0,
    };
    if (!displayItems.length) return empty;

    const grouped = new Map<string, PickRow[]>();
    displayItems.forEach((row) => {
      if (!row.snapshot_date) return;
      const list = grouped.get(row.snapshot_date) ?? [];
      list.push(row);
      grouped.set(row.snapshot_date, list);
    });

    const dates = Array.from(grouped.keys()).sort();
    const recentDates = dates.slice(-5);

    let total = 0;
    let hits = 0;
    let misses = 0;
    let sumOdd = 0;
    let sumHitProfit = 0;

    for (const date of recentDates) {
      const rows = grouped.get(date) ?? [];
      const candidates = buildComboCandidates(rows);
      const odds = candidates.map((row) => Number(row.odd));
      const statuses = candidates.map((row) => row.status);
      const n = candidates.length;
      if (n < 2) continue;

      for (let i = 0; i < n - 1; i += 1) {
        const oddA = odds[i];
        if (!Number.isFinite(oddA) || oddA <= 1) continue;
        for (let j = i + 1; j < n; j += 1) {
          const oddB = odds[j];
          if (!Number.isFinite(oddB) || oddB <= 1) continue;
          const totalOdd = oddA * oddB;
          if (totalOdd < MIN_COMBO_ODDS || totalOdd > MAX_COMBO_ODDS) continue;
          total += 1;
          sumOdd += totalOdd;

          const statusA = statuses[i];
          const statusB = statuses[j];
          if (statusA === "miss" || statusB === "miss") {
            misses += 1;
            continue;
          }
          if (statusA === "hit" && statusB === "hit") {
            hits += 1;
            sumHitProfit += totalOdd - 1;
          }
        }
      }
    }

    const resolved = hits + misses;
    const pending = Math.max(0, total - resolved);
    const hitRate = resolved ? (hits / resolved) * 100 : 0;
    const avgOdd = total ? sumOdd / total : 0;
    const profit = STAKE * (sumHitProfit - misses);
    const roiPct = BASE_BANKROLL ? (profit / BASE_BANKROLL) * 100 : 0;
    return {
      total,
      resolved,
      pending,
      hits,
      misses,
      hitRate,
      roiPct,
      avgOdd,
    };
  }, [displayItems]);

  const combosHistoryStats = useMemo(() => {
    if (!combosHistory.length) {
      return {
        total: 0,
        hits: 0,
        misses: 0,
        hitRate: 0,
        roiPct: 0,
        avgOdd: 0,
        points: [],
      };
    }
    const avgOdd =
      combosHistory.length
        ? combosHistory.reduce((sum, combo) => sum + (combo.totalOdd || 0), 0) /
          combosHistory.length
        : 0;
    const resolved = combosHistory.filter((c) => c.status === "hit" || c.status === "miss");
    const hits = resolved.filter((c) => c.status === "hit").length;
    const misses = resolved.filter((c) => c.status === "miss").length;
    const hitRate = resolved.length ? (hits / resolved.length) * 100 : 0;
    let capital = BASE_BANKROLL;
    const points = resolved.map((combo, idx) => {
      if (combo.status === "hit") {
        capital += STAKE * (combo.totalOdd - 1);
      } else {
        capital -= STAKE;
      }
      return { x: idx, y: Number(capital.toFixed(2)) };
    });
    const finalCapital = points.length ? points[points.length - 1].y : BASE_BANKROLL;
    const roiPct = ((finalCapital - BASE_BANKROLL) / BASE_BANKROLL) * 100;
    return {
      total: combosHistory.length,
      hits,
      misses,
      hitRate,
      roiPct,
      avgOdd,
      points,
    };
  }, [combosHistory]);

  return (
    <div className="min-h-screen w-full p-6 text-white space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">
          {view === "combos" ? "Combinés" : "Historique Algo"}
        </h1>
        <p className="text-sm text-white/60">
          {view === "combos"
            ? "Historique et performance des combinés automatiques."
            : "Suivi automatique des picks, odds et résultats."}
        </p>
        <p className="text-xs text-white/50 mt-1">
          {displayItems.length} pick(s) chargés
          {view === "combos" ? ` • ${combosHistoryStats.total} combiné(s)` : ""}
          {lastFetchedAt ? (
            <span className="text-white/35">
              {" "}
              • MAJ: {new Date(lastFetchedAt).toLocaleString("fr-FR")}
            </span>
          ) : null}
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
          <span className="px-3 py-1 rounded-lg text-sm bg-white/10 text-white/70">
            Tous les jours
          </span>
        </div>
        <div className="ml-auto" />
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className={`px-3 py-1 rounded-lg text-sm transition ${
            loading
              ? "bg-white/10 text-white/40 cursor-not-allowed"
              : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
          title="Rafraîchir la liste (utile après avoir résolu des picks)"
        >
          Rafraîchir
        </button>
      </div>

      {availableMarkets.length || availableLines.length || availablePickCodes.length ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-white/60">
              Exclure marchés
              {excludedMarkets.length ? ` (${excludedMarkets.length})` : ""}
            </div>
            <button
              type="button"
              onClick={() => {
                setExcludedMarkets([]);
                setExcludedLines([]);
                setExcludedPickCodes([]);
              }}
              className="text-xs text-white/60 hover:text-white"
            >
              Tout inclure
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-sm text-white/70">
            {availableMarkets.map((value) => (
              <label key={`exclude-${value}`} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={excludedMarkets.includes(value)}
                  onChange={() => toggleMarketExclusion(value)}
                  className="accent-rose-400"
                />
                <span>{marketLabel(value)}</span>
              </label>
            ))}
          </div>
          {availableLines.length ? (
            <div className="mt-3">
              <div className="text-xs text-white/50">Lignes Over/Under</div>
              <div className="mt-2 flex flex-wrap gap-3 text-sm text-white/70">
                {availableLines.map((value) => (
                  <label key={`exclude-line-${value}`} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={excludedLines.includes(value)}
                      onChange={() => toggleLineExclusion(value)}
                      className="accent-rose-400"
                    />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {availablePickCodes.length ? (
            <div className="mt-3">
              <div className="text-xs text-white/50">Double chance</div>
              <div className="mt-2 flex flex-wrap gap-3 text-sm text-white/70">
                {availablePickCodes.map((value) => (
                  <label key={`exclude-code-${value}`} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={excludedPickCodes.includes(value)}
                      onChange={() => togglePickCodeExclusion(value)}
                      className="accent-rose-400"
                    />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {view === "singles" ? (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-white/60">
                Picks résolus <span className="text-white/40">(hors blacklist)</span>
              </div>
              <div className="text-2xl font-semibold">
                {stats.total}
                <span className="text-sm text-white/40 ml-2">/ {stats.totalDisplay}</span>
              </div>
              <div className="mt-1 text-[11px] text-white/45">
                Total résolus (incl.): {stats.totalAll} •{" "}
                <span className="text-emerald-200">{stats.hitsAll}</span>{" "}
                <span className="text-white/35">/</span>{" "}
                <span className="text-rose-200">{stats.missesAll}</span>
              </div>
            </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Hits / Miss</div>
          <div className="text-2xl font-semibold">
            <span className="text-emerald-300">{stats.hits}</span>
            <span className="text-white/50"> / </span>
            <span className="text-rose-300">{stats.misses}</span>
          </div>
          <div className="mt-1 text-[11px] text-white/45">
            Total (incl.):{" "}
            <span className="text-emerald-200">{stats.hitsAll}</span>{" "}
            <span className="text-white/35">/</span>{" "}
            <span className="text-rose-200">{stats.missesAll}</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Taux de réussite</div>
          <div className="text-2xl font-semibold text-emerald-200">
            {stats.hitRate.toFixed(1)}%
          </div>
          <div className="mt-1 text-[11px] text-white/45">
            Total (incl.): {stats.hitRateAll.toFixed(1)}%
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 self-start">
          <div className="text-[11px] text-white/60">ROI</div>
          <div
            className={`text-lg font-semibold ${
              stats.roiPct >= 0 ? "text-emerald-200" : "text-rose-300"
            }`}
          >
            {stats.roiPct.toFixed(1)}%
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Cote moyenne (tous picks)</div>
          <div className="text-2xl font-semibold">{stats.avgOddAll.toFixed(2)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Matchs analysés</div>
          <div className="text-2xl font-semibold">{analyzedMatches}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 md:col-span-2 xl:col-span-2">
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
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 md:col-span-2 xl:col-span-2">
          <div className="text-xs text-white/60">Pick le plus sélectionné</div>
          {stats.pickEntries.length ? (
            <div className="mt-2">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-1 text-[10px] uppercase tracking-wide text-white/40">
                <span>Pick</span>
                <span className="text-right">Part</span>
                <span className="text-right">Hit</span>
              </div>
              <div className="mt-1 max-h-40 overflow-y-auto pr-1 divide-y divide-white/10">
                {stats.pickEntries.map((entry) => (
                  <div
                    key={`pick-${entry.pick}`}
                    className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 py-2 text-[11px] text-white/70"
                  >
                    <span className="truncate">{entry.pick}</span>
                    <span className="text-right tabular-nums text-white/60">
                      {entry.share.toFixed(1)}%
                    </span>
                    <span className="text-right tabular-nums text-orange-300">
                      {entry.hitRate.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-sm text-white/60">Aucune donnée.</div>
          )}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 md:col-span-2 xl:col-span-2">
          <div className="text-xs text-white/60">Matchs sans cote</div>
          <div className="text-2xl font-semibold">
            {matchesWithoutOddsStats.matchesWithoutOdds}
            <span className="text-sm text-white/40 ml-2">/ {matchesWithoutOddsStats.totalMatches}</span>
          </div>
          <div className="mt-1 text-[11px] text-white/45">
            Ratio: {matchesWithoutOddsStats.ratioPct.toFixed(1)}%
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 md:col-span-2 xl:col-span-4">
          <div className="text-xs text-white/60">Championnats (au moins 1 pick)</div>
          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-black/20">
            <div className="grid grid-cols-[1.4fr_90px_90px_90px_90px] gap-3 px-3 py-2 text-[10px] uppercase tracking-wide text-white/40">
              <span>Championnat</span>
              <span className="text-right">Hits</span>
              <span className="text-right">Picks</span>
              <span className="text-right">Hit rate</span>
              <span className="text-right">Part</span>
            </div>
            <div className="divide-y divide-white/10 text-[12px] text-white/70">
              {competitionStats.length ? (
                <>
                  <div className="grid grid-cols-[1.4fr_90px_90px_90px_90px] items-center gap-3 px-3 py-2 text-white/80">
                    <span className="truncate font-semibold">TOTAL / MOYENNE</span>
                    <span className="text-right tabular-nums text-emerald-200">
                      {competitionSummary.totalHits}
                      <span className="text-white/40"> / {competitionSummary.totalPicks}</span>
                    </span>
                    <span className="text-right tabular-nums">
                      {competitionSummary.totalPicks}
                    </span>
                    <span className="text-right tabular-nums text-emerald-200">
                      {competitionSummary.hitRate.toFixed(1)}%
                    </span>
                    <span className="text-right tabular-nums text-white/60">
                      {competitionSummary.avgPicks.toFixed(1)}
                    </span>
                  </div>
                  {competitionStats.map((row) => {
                    const isDiscouraged = DISCOURAGED_COMPETITIONS.has(
                      `${row.country}|||${row.name}`
                    );
                    return (
                    <div
                      key={`${row.country}-${row.name}`}
                      className={`grid grid-cols-[1.4fr_90px_90px_90px_90px] items-center gap-3 px-3 py-2 ${
                        isDiscouraged ? "text-rose-300" : ""
                      }`}
                    >
                      <span className="truncate">
                        {row.country} - {row.name}
                      </span>
                      <span className="text-right tabular-nums text-emerald-200">
                        {row.hits}
                        <span className="text-white/40"> / {row.total}</span>
                      </span>
                      <span className="text-right tabular-nums">{row.total}</span>
                      <span className="text-right tabular-nums text-emerald-200">
                        {row.hitRate.toFixed(1)}%
                      </span>
                      <span className="text-right tabular-nums text-white/60">
                        {row.share.toFixed(1)}%
                      </span>
                    </div>
                    );
                  })}
                </>
              ) : (
                <div className="px-3 py-3 text-sm text-white/50">Aucune donnée.</div>
              )}
            </div>
          </div>
        </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs text-white/60">Exporter CSV :</div>
            <button
              type="button"
              onClick={() => downloadCsv("all")}
              className="px-3 py-1 rounded-lg text-xs bg-white/10 text-white/70 hover:bg-white/20"
            >
              Tout
            </button>
            <button
              type="button"
              onClick={() => downloadCsv("hit")}
              className="px-3 py-1 rounded-lg text-xs bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
            >
              Gagnés
            </button>
            <button
              type="button"
              onClick={() => downloadCsv("miss")}
              className="px-3 py-1 rounded-lg text-xs bg-rose-500/20 text-rose-200 hover:bg-rose-500/30"
            >
              Perdus
            </button>
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
            <div className="flex items-center justify-between">
              <div className="text-sm text-white/70">Liste complète des picks (filtrés)</div>
              <button
                type="button"
                onClick={() => setShowPickList((prev) => !prev)}
                className="px-3 py-1 rounded-lg text-xs bg-white/10 text-white/70 hover:bg-white/20"
              >
                {showPickList ? "Fermer" : "Afficher"}
              </button>
            </div>
            {showPickList ? (
              <div className="mt-3 max-h-[70vh] overflow-y-auto rounded-lg border border-white/10 bg-black/20">
                <div className="grid grid-cols-[120px_1.4fr_1fr_80px_90px_70px] gap-3 px-3 py-2 text-[10px] uppercase tracking-wide text-white/40">
                  <span>Date</span>
                  <span>Match</span>
                  <span>Pick</span>
                  <span>Odds</span>
                  <span>Marché</span>
                  <span>Statut</span>
                </div>
                <div className="divide-y divide-white/10 text-[12px] text-white/70">
                  {displayItemsSorted.length ? (
                    displayItemsSorted.map((row) => (
                      <div
                        key={`pick-list-${row.id}`}
                        className="grid grid-cols-[120px_1.4fr_1fr_80px_90px_70px] items-center gap-3 px-3 py-2"
                      >
                        <span className="text-white/60">{row.snapshot_date}</span>
                        <span className="truncate">
                          {row.home_name ?? "Home"} vs {row.away_name ?? "Away"}
                        </span>
                        <span className="truncate">{row.pick}</span>
                        <span className="tabular-nums">{row.odd ?? "-"}</span>
                        <span className="text-white/60">{row.market ?? "-"}</span>
                        <span
                          className={
                            row.status === "hit"
                              ? "text-emerald-300"
                              : row.status === "miss"
                                ? "text-rose-300"
                                : "text-white/40"
                          }
                        >
                          {row.status ?? "pending"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-3 text-sm text-white/50">Aucune donnée.</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {view === "combos" ? (
        <>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <div className="text-sm font-semibold">Combinés automatiques</div>
                <div className="text-xs text-white/60">
                  Fourchette {MIN_COMBO_ODDS.toFixed(2)} – {MAX_COMBO_ODDS.toFixed(2)} • 2 matchs
                  prioritaires
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Historique combinés</div>
          <div className="text-2xl font-semibold">
            {combosHistoryStats.hits}
            <span className="text-sm text-white/40 ml-2">/ {combosHistoryStats.total}</span>
          </div>
          <div className="mt-2 text-xs text-white/60">
            Hits / Total • {combosHistoryStats.hitRate.toFixed(1)}%
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">ROI combinés</div>
          <div
            className={`text-2xl font-semibold ${
              combosHistoryStats.roiPct >= 0 ? "text-emerald-200" : "text-rose-300"
            }`}
          >
            {combosHistoryStats.roiPct.toFixed(1)}%
          </div>
          <div className="mt-2 text-xs text-white/60">
            Base {BASE_BANKROLL}$ • Mise {STAKE}$
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Cote moyenne (combinés)</div>
          <div className="text-2xl font-semibold">
            {combosHistoryStats.avgOdd.toFixed(2)}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Miss</div>
          <div className="text-2xl font-semibold text-rose-300">
            {combosHistoryStats.misses}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Simulation tous combinés (sans règles)</div>
          <div className="text-2xl font-semibold">
            <span className="text-emerald-300">{combosHistoryAllStats.hits}</span>
            <span className="text-white/50"> / </span>
            <span className="text-rose-300">{combosHistoryAllStats.misses}</span>
          </div>
          <div className="mt-2 text-xs text-white/60">
            Résolus: {combosHistoryAllStats.resolved} / {combosHistoryAllStats.total} •{" "}
            {combosHistoryAllStats.hitRate.toFixed(1)}%
          </div>
          <div className="mt-1 text-[11px] text-white/45">
            Cote moy: {combosHistoryAllStats.avgOdd.toFixed(2)} • ROI:{" "}
            <span
              className={
                combosHistoryAllStats.roiPct >= 0 ? "text-emerald-200" : "text-rose-200"
              }
            >
              {combosHistoryAllStats.roiPct.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      {combosHistoryStats.points.length ? (
        <PicksChart
          points={combosHistoryStats.points}
          label="Évolution capital (Combinés)"
          subLabel={`(${BASE_BANKROLL}$ base • ${STAKE}$ / mise)`}
        />
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white/70 text-sm">
          Pas assez de combinés résolus pour la courbe.
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-white/70">Sélection combinés (historique)</div>
        </div>
        <div className="mt-3 max-h-[60vh] overflow-y-auto rounded-lg border border-white/10 bg-black/20">
          <div className="grid grid-cols-[110px_1fr_90px_70px] gap-3 px-3 py-2 text-[10px] uppercase tracking-wide text-white/40">
            <span>Date</span>
            <span>Sélection</span>
            <span>Cote</span>
            <span>Statut</span>
          </div>
          <div className="divide-y divide-white/10 text-[12px] text-white/70">
            {combosHistory.length ? (
              combosHistory.map((combo, idx) => (
                <div
                  key={`combo-history-${combo.snapshotDate}-${idx}`}
                  className="grid grid-cols-[110px_1fr_90px_70px] items-start gap-3 px-3 py-2"
                >
                  <span className="text-white/60">{combo.snapshotDate}</span>
                  <div className="space-y-1">
                    {combo.legs.map((leg) => (
                      <div
                        key={leg.id}
                        className={`truncate ${
                          leg.status === "miss" ? "text-rose-300" : "text-white/70"
                        }`}
                      >
                        {(leg.competition_country ?? "N/A")}:{" "}
                        {leg.home_name ?? "Home"} vs {leg.away_name ?? "Away"} • {leg.pick} •{" "}
                        {leg.odd ?? "-"}
                      </div>
                    ))}
                  </div>
                  <span className="tabular-nums">{combo.totalOdd.toFixed(2)}</span>
                  <span
                    className={
                      combo.status === "hit"
                        ? "text-emerald-300"
                        : combo.status === "miss"
                          ? "text-rose-300"
                          : "text-white/40"
                    }
                  >
                    {combo.status ?? "pending"}
                  </span>
                </div>
              ))
            ) : (
              <div className="px-3 py-3 text-sm text-white/50">Aucune donnée.</div>
            )}
          </div>
        </div>
      </div>

        </>
      ) : null}

      {view === "singles" ? (
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
      ) : null}
    </div>
  );
}
