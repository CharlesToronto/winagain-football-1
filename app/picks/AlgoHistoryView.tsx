"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import PicksChart from "./components/PicksChart";

type PickRow = {
  id: string;
  snapshot_date: string;
  fixture_date_utc: string | null;
  fixture_id: number;
  home_team_id?: number | null;
  away_team_id?: number | null;
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
  picks_count?: number | null;
  evaluated_count?: number | null;
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

const algoOptions = [
  { key: "v1", label: "Algo 1" },
  { key: "v2", label: "Algo 2" },
  { key: "v3", label: "Algo 3" },
] as const;

const competitionSortOptions = [
  { key: "hits", label: "Hits" },
  { key: "hit_rate", label: "Hit rate" },
  { key: "avg_odd", label: "Cote moy" },
] as const;

type CompetitionSortKey = (typeof competitionSortOptions)[number]["key"];

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
const MAX_COMBO_CANDIDATES = Number.POSITIVE_INFINITY;
const MAX_COMBOS = 3;
const MAX_COMBOS_COMPARE = 5;
const COMBO_HISTORY_SNAPSHOTS = 30;
const BASE_BANKROLL = 1000;
const SINGLES_STAKE = 10;
const COMBOS_STAKE = 100;
const MIN_ODDS_FILTER = 1.18;
const DISCOURAGED_COMPETITIONS = new Set([
  "Bulgaria|||First League",
  "Belgium|||Jupiler Pro League",
  "Greece|||Super League 1",
  "Hungary|||NB I",
  "Scotland|||Football League - Highland League",
  "Scotland|||League One",
  "Belgium|||Challenger Pro League",
  "Hungary|||NB II",
  "Italy|||Serie C - Girone A",
  "Italy|||Serie B",
  "Israel|||Liga Leumit",
  "Mexico|||Liga Premier Serie A",
  "Poland|||I Liga",
  "Azerbaijan|||Birinci Dasta",
  "Romania|||Liga I",
  "Serbia|||Super Liga",
  "Slovakia|||Super Liga",
]);

type Combo = {
  legs: PickRow[];
  totalOdd: number;
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
  const [showLatestPicks, setShowLatestPicks] = useState(false);
  const [showMoreSinglesStats, setShowMoreSinglesStats] = useState(false);
  const singlesInsightsCarouselRef = useRef<HTMLDivElement | null>(null);
  const [singlesInsightsCarouselIndex, setSinglesInsightsCarouselIndex] = useState(0);
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);
  const filtersCardRef = useRef<HTMLDivElement | null>(null);
  const [showMarketExclusions, setShowMarketExclusions] = useState(false);
  const [excludedMarkets, setExcludedMarkets] = useState<string[]>([]);
  const [excludedLines, setExcludedLines] = useState<string[]>([]);
  const [excludedPickCodes, setExcludedPickCodes] = useState<string[]>([]);
  const [algoVersion, setAlgoVersion] = useState<"v1" | "v2" | "v3">("v3");
  const pathname = usePathname();
  const [criteria, setCriteria] = useState<"all" | "rose" | "yellow">("all");
  const [market, setMarket] = useState<
    "all" | "over_under" | "double_chance" | "1x2" | "btts" | "dnb" | "team_total"
  >("all");
  const [competitionSortKey, setCompetitionSortKey] = useState<CompetitionSortKey>("hits");
  const [oddsFilter, setOddsFilter] = useState<"all" | "with_odds">("all");
  const [combosTab, setCombosTab] = useState<"history" | "compare">("history");
  const [combosCompareMode, setCombosCompareMode] = useState<"max5" | "legs7" | "legs9">("max5");
  const [showComboHistoryDebug, setShowComboHistoryDebug] = useState(false);
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

  const exportUrlBase = useMemo(() => {
    const params = new URLSearchParams();
    params.set("algo", algoVersion);
    params.set("days", String(days));
    params.set("criteria", criteria);
    if (market !== "all") params.set("market", market);
    params.set("include_team_stats", "1");
    return `/api/picks/export?${params.toString()}`;
  }, [algoVersion, days, criteria, market]);

  const downloadFullExport = (format: "csv" | "json") => {
    const url = `${exportUrlBase}&format=${format}`;
    const link = document.createElement("a");
    const dateLabel = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `picks_${algoVersion}_${dateLabel}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const refresh = () => setRefreshKey(Date.now());

  useEffect(() => {
    const expectedPath = view === "combos" ? "/combos" : "/picks";
    if (pathname !== expectedPath) return;
    if (!lastFetchedAt) return;
    if (Date.now() - lastFetchedAt < 1500) return;
    refresh();
  }, [pathname, view, lastFetchedAt]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const fetchJson = async (url: string) => {
      const res = await fetch(url, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
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
    const onPageShow = () => {
      // When coming back to this page (including after opening an /api/* URL),
      // React state may be restored without refetching. Always refresh.
      triggerRefresh();
    };
    window.addEventListener("focus", triggerRefresh);
    window.addEventListener("popstate", triggerRefresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("focus", triggerRefresh);
      window.removeEventListener("popstate", triggerRefresh);
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

  function normalizePickKey(pick: string | null | undefined) {
    return String(pick ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");
  }

  function comboLegReuseKey(leg: PickRow) {
    return `${leg.fixture_id}:${normalizePickKey(leg.pick)}`;
  }

  function hash32(value: string) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function formatSigned(value: number, digits = 1, suffix = "") {
    if (!Number.isFinite(value)) return "-";
    const normalized = Object.is(value, -0) ? 0 : value;
    const sign = normalized >= 0 ? "+" : "";
    return `${sign}${normalized.toFixed(digits)}${suffix}`;
  }

  function comboKey(combo: Combo) {
    return combo.legs.map(comboLegReuseKey).sort().join("|");
  }

  function comboScore(combo: Combo, seed: string) {
    return hash32(`${seed}|${comboKey(combo)}`);
  }

  function selectRandomCombos(
    list: Combo[],
    seed: string,
    max: number,
    usedLegsExternal?: Set<string>
  ) {
    const limit = Number(max);
    if (!Number.isFinite(limit) || limit <= 0) return [];
    if (!Array.isArray(list) || list.length === 0) return [];

    const seeded = [...list].sort((a, b) => {
      const scoreA = hash32(`${seed}|${comboKey(a)}`);
      const scoreB = hash32(`${seed}|${comboKey(b)}`);
      if (scoreA !== scoreB) return scoreA - scoreB;
      const keyA = comboKey(a);
      const keyB = comboKey(b);
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    });

    const selected: Combo[] = [];
    const usedLegs = usedLegsExternal ?? new Set<string>();
    for (const combo of seeded) {
      const legsKeys = combo.legs.map(comboLegReuseKey);
      if (legsKeys.some((key) => usedLegs.has(key))) continue;
      legsKeys.forEach((key) => usedLegs.add(key));
      selected.push(combo);
      if (selected.length >= limit) break;
    }
    return selected;
  }

  function mulberry32(seed: number) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildRandomTriplesForCandidates(
    candidates: PickRow[],
    seed: string,
    maxSamples: number
  ) {
    const n = candidates.length;
    if (n < 3) return [];
    const maxWanted = Math.max(0, Math.floor(Number(maxSamples) || 0));
    if (!maxWanted) return [];

    const rng = mulberry32(hash32(seed));
    const combosLocal: Combo[] = [];
    const seen = new Set<string>();
    const maxAttempts = Math.min(50000, maxWanted * 60);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (combosLocal.length >= maxWanted) break;

      const i = Math.floor(rng() * n);
      let j = Math.floor(rng() * n);
      let k = Math.floor(rng() * n);
      if (j === i) j = (j + 1) % n;
      if (k === i || k === j) k = (k + 2) % n;
      if (i === j || i === k || j === k) continue;

      const legA = candidates[i];
      const legB = candidates[j];
      const legC = candidates[k];
      const fixtureA = legA.fixture_id;
      const fixtureB = legB.fixture_id;
      const fixtureC = legC.fixture_id;
      if (fixtureA === fixtureB || fixtureA === fixtureC || fixtureB === fixtureC) continue;

      const oddA = Number(legA.odd);
      const oddB = Number(legB.odd);
      const oddC = Number(legC.odd);
      if (!Number.isFinite(oddA) || oddA <= 1) continue;
      if (!Number.isFinite(oddB) || oddB <= 1) continue;
      if (!Number.isFinite(oddC) || oddC <= 1) continue;

      const totalOdd = Number((oddA * oddB * oddC).toFixed(2));
      if (totalOdd < MIN_COMBO_ODDS) continue;

      const legs = [legA, legB, legC];
      const key = legs.map(comboLegReuseKey).sort().join("|");
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      combosLocal.push({ legs, totalOdd });
    }

    return combosLocal;
  }

  function buildSelectedCombosForCandidates(
    candidates: PickRow[],
    seed: string,
    maxCombos = MAX_COMBOS
  ) {
    const limit = Math.max(0, Math.floor(Number(maxCombos) || 0));
    if (!limit) return [];
    const usedLegs = new Set<string>();

    const doubles = buildCombosForCandidates(candidates, 2);
    const selectedDoubles = selectRandomCombos(doubles, `${seed}|2`, limit, usedLegs);
    if (selectedDoubles.length >= limit) return selectedDoubles;

    const remaining = limit - selectedDoubles.length;
    const triplesCandidates = buildRandomTriplesForCandidates(candidates, `${seed}|3`, 2500);
    const selectedTriples = selectRandomCombos(
      triplesCandidates,
      `${seed}|3`,
      remaining,
      usedLegs
    );

    return [...selectedDoubles, ...selectedTriples];
  }

  function buildRandomCombosOfSizeForCandidates(
    candidates: PickRow[],
    seed: string,
    legsCount: number,
    maxSamples: number
  ) {
    const legsTarget = Math.max(0, Math.floor(Number(legsCount) || 0));
    if (legsTarget < 2) return [];

    const maxWanted = Math.max(0, Math.floor(Number(maxSamples) || 0));
    if (!maxWanted) return [];

    const byFixture = new Map<number, PickRow[]>();
    candidates.forEach((row) => {
      const fixtureId = Number(row.fixture_id);
      if (!Number.isFinite(fixtureId)) return;
      const odd = Number(row.odd);
      if (!Number.isFinite(odd) || odd <= 1) return;
      const list = byFixture.get(fixtureId) ?? [];
      list.push(row);
      byFixture.set(fixtureId, list);
    });

    const fixtures = Array.from(byFixture.values());
    if (fixtures.length < legsTarget) return [];

    const rng = mulberry32(hash32(seed));
    const combosLocal: Combo[] = [];
    const seen = new Set<string>();
    const maxAttempts = Math.min(100000, maxWanted * 80);
    const fixturesCount = fixtures.length;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (combosLocal.length >= maxWanted) break;

      const fixtureIndexes = new Set<number>();
      let safety = 0;
      while (fixtureIndexes.size < legsTarget && safety < legsTarget * 30) {
        fixtureIndexes.add(Math.floor(rng() * fixturesCount));
        safety += 1;
      }
      if (fixtureIndexes.size < legsTarget) continue;

      const legs: PickRow[] = [];
      let totalOdd = 1;
      fixtureIndexes.forEach((index) => {
        const options = fixtures[index];
        const leg = options[Math.floor(rng() * options.length)];
        legs.push(leg);
        totalOdd *= Number(leg.odd);
      });
      if (!Number.isFinite(totalOdd)) continue;

      if (legs.length !== legsTarget) continue;

      const totalOddRounded = Number(totalOdd.toFixed(2));
      if (totalOddRounded < MIN_COMBO_ODDS) continue;

      const key = legs.map(comboLegReuseKey).sort().join("|");
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      combosLocal.push({ legs, totalOdd: totalOddRounded });
    }

    return combosLocal;
  }

  function buildSelectedCombosFixedLegsForCandidates(
    candidates: PickRow[],
    seed: string,
    legsCount: number,
    maxCombos: number
  ) {
    const limit = Math.max(0, Math.floor(Number(maxCombos) || 0));
    if (!limit) return [];

    const usedLegs = new Set<string>();
    const combosCandidates = buildRandomCombosOfSizeForCandidates(
      candidates,
      `${seed}|L${legsCount}`,
      legsCount,
      4000
    );
    return selectRandomCombos(combosCandidates, `${seed}|L${legsCount}`, limit, usedLegs);
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

  const hasMarketExclusions =
    availableMarkets.length > 0 || availableLines.length > 0 || availablePickCodes.length > 0;

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
    const points: { x: number; y: number }[] = [];
    if (resolved.length) {
      points.push({ x: 0, y: Number(BASE_BANKROLL.toFixed(2)) });
      resolved.forEach((row, idx) => {
        const odd = Number(row.odd);
        const oddUsed = Number.isFinite(odd) && odd > 1 ? odd : avgOddAll;
        if (Number.isFinite(oddUsed) && oddUsed > 1) {
          capital += row.status === "hit" ? SINGLES_STAKE * (oddUsed - 1) : -SINGLES_STAKE;
        }
        points.push({ x: idx + 1, y: Number(capital.toFixed(2)) });
      });
    }
    let peakCapital = BASE_BANKROLL;
    let maxDrawdownAbs = 0;
    let maxDrawdownPct = 0;
    points.forEach((point) => {
      if (point.y > peakCapital) peakCapital = point.y;
      const drawdown = peakCapital - point.y;
      if (drawdown > maxDrawdownAbs) {
        maxDrawdownAbs = drawdown;
        maxDrawdownPct = peakCapital ? (drawdown / peakCapital) * 100 : 0;
      }
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
      maxDrawdownAbs,
      maxDrawdownPct,
      topPick,
      pickEntries,
    };
  }, [resolved, displayItems]);

  const competitionStats = useMemo(() => {
    const totals = new Map<
      string,
      { total: number; hits: number; oddsSum: number; oddsCount: number }
    >();
    let resolvedTotal = 0;
    displayItems.forEach((row) => {
      if (row.status !== "hit" && row.status !== "miss") return;
      resolvedTotal += 1;
      const country = row.competition_country ?? "Inconnu";
      const name = row.competition_name ?? "Competition";
      const key = `${country}|||${name}`;
      const current = totals.get(key) ?? { total: 0, hits: 0, oddsSum: 0, oddsCount: 0 };
      current.total += 1;
      if (row.status === "hit") current.hits += 1;
      const odd = Number(row.odd);
      if (Number.isFinite(odd) && odd > 1) {
        current.oddsSum += odd;
        current.oddsCount += 1;
      }
      totals.set(key, current);
    });
    const result = Array.from(totals.entries()).map(([key, data]) => {
      const [country, name] = key.split("|||");
      const hitRate = data.total ? (data.hits / data.total) * 100 : 0;
      const share = resolvedTotal ? (data.total / resolvedTotal) * 100 : 0;
      const avgOdd = data.oddsCount ? data.oddsSum / data.oddsCount : 0;
      return { country, name, total: data.total, hits: data.hits, hitRate, share, avgOdd };
    });
    return result.sort((a, b) => b.total - a.total);
  }, [displayItems]);

  const competitionStatsSorted = useMemo(() => {
    const rows = [...competitionStats];
    if (competitionSortKey === "hits") {
      rows.sort((a, b) => b.hits - a.hits || b.hitRate - a.hitRate || b.total - a.total);
      return rows;
    }
    if (competitionSortKey === "hit_rate") {
      rows.sort((a, b) => b.hitRate - a.hitRate || b.hits - a.hits || b.total - a.total);
      return rows;
    }
    rows.sort((a, b) => b.avgOdd - a.avgOdd || b.hits - a.hits || b.total - a.total);
    return rows;
  }, [competitionStats, competitionSortKey]);

  const competitionHitRateByKey = useMemo(() => {
    const map = new Map<string, number>();
    competitionStats.forEach((row) => {
      map.set(`${row.country}|||${row.name}`, row.hitRate);
    });
    return map;
  }, [competitionStats]);

  const activeCriteriaLabel = useMemo(
    () => criteriaOptions.find((option) => option.key === criteria)?.label ?? criteria,
    [criteria]
  );
  const activeOddsFilterLabel = useMemo(
    () => oddsFilterOptions.find((option) => option.key === oddsFilter)?.label ?? oddsFilter,
    [oddsFilter]
  );
  const activeAlgoLabel = useMemo(
    () => algoOptions.find((option) => option.key === algoVersion)?.label ?? algoVersion,
    [algoVersion]
  );
	  const activeMarketLabel = useMemo(
	    () => marketOptions.find((option) => option.key === market)?.label ?? market,
	    [market]
	  );

	  const activeCriteriaChipLabel = useMemo(() => {
	    if (criteria === "rose") return "Rose";
	    if (criteria === "yellow") return "Jaune";
	    return "Tous";
	  }, [criteria]);

	  const activeOddsChipLabel = useMemo(() => {
	    if (oddsFilter === "with_odds") return "Odds ≥ 1.18";
	    return "Tous picks";
	  }, [oddsFilter]);

	  const activeMarketChipLabel = useMemo(() => {
	    const map: Record<string, string> = {
	      all: "Tous marchés",
	      over_under: "O/U",
	      double_chance: "DC",
	      "1x2": "1X2",
	      btts: "BTTS",
	      dnb: "DNB",
	      team_total: "TT",
	    };
	    return map[market] ?? activeMarketLabel;
	  }, [market, activeMarketLabel]);

  const CompetitionSortControls = ({ className = "" }: { className?: string }) => (
    <div className={`mt-2 flex flex-wrap items-center gap-2 ${className}`}>
      <span className="text-[11px] uppercase tracking-wide text-white/40">Trier ligues:</span>
      {competitionSortOptions.map((option) => (
        <button
          key={`competition-sort-${option.key}`}
          type="button"
          onClick={() => setCompetitionSortKey(option.key)}
          className={`px-2.5 py-1 rounded-md text-[11px] sm:text-xs transition ${
            competitionSortKey === option.key
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  useEffect(() => {
    if (!showFiltersPanel) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowFiltersPanel(false);
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const container = filtersCardRef.current;
      if (!container) return;
      if (!container.contains(target)) setShowFiltersPanel(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [showFiltersPanel]);

  const competitionSummary = useMemo(() => {
    const resolvedRows = displayItems.filter((row) => row.status === "hit" || row.status === "miss");
    const totalPicks = resolvedRows.length;
    const totalHits = resolvedRows.filter((row) => row.status === "hit").length;
    const hitRate = totalPicks ? (totalHits / totalPicks) * 100 : 0;
    const totalCompetitions = competitionStats.length;
    const avgPicks = totalCompetitions ? totalPicks / totalCompetitions : 0;
    const odds = resolvedRows
      .map((row) => Number(row.odd))
      .filter((val) => Number.isFinite(val) && val > 1);
    const avgOdd = odds.length ? odds.reduce((sum, val) => sum + val, 0) / odds.length : 0;
    return { totalPicks, totalHits, hitRate, totalCompetitions, avgPicks, avgOdd };
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
      return true;
    });
    return buildComboCandidates(filtered);
  }, [displayItems, latestSnapshot]);

  function buildComboCandidates(rows: PickRow[]) {
    const filtered = rows.filter((row) => {
      const country = row.competition_country ?? "";
      const name = row.competition_name ?? "";
      if (country && name && DISCOURAGED_COMPETITIONS.has(`${country}|||${name}`)) {
        return false;
      }
      const odd = Number(row.odd);
      return Number.isFinite(odd) && odd > 1;
    });
    if (!filtered.length) return [];
    if (Number.isFinite(MAX_COMBO_CANDIDATES) && MAX_COMBO_CANDIDATES > 0) {
      return filtered.slice(0, MAX_COMBO_CANDIDATES);
    }
    return filtered;
  }

  const buildCombosForCandidates = (candidates: PickRow[], legsCount = 2) => {
    const combosLocal: Combo[] = [];
    const n = candidates.length;
    const inOddRange = (value: number) => value >= MIN_COMBO_ODDS;

    if (legsCount === 2) {
      for (let i = 0; i < n - 1; i += 1) {
        const legA = candidates[i];
        const oddA = Number(legA.odd);
        if (!Number.isFinite(oddA)) continue;
        for (let j = i + 1; j < n; j += 1) {
          const legB = candidates[j];
          if (legA.fixture_id === legB.fixture_id) continue; // bookmaker: no same match inside a combo
          const oddB = Number(legB.odd);
          if (!Number.isFinite(oddB)) continue;
          const totalOdd = Number((oddA * oddB).toFixed(2));
          if (!inOddRange(totalOdd)) continue;
          const legs = [legA, legB];
          combosLocal.push({
            legs,
            totalOdd,
          });
        }
      }
    }
    return combosLocal;
  };

  const combos = useMemo(() => {
    return buildSelectedCombosForCandidates(comboCandidates, `current|${latestSnapshot}`);
  }, [comboCandidates, latestSnapshot]);

  const combosHistory = useMemo(() => {
    const grouped = new Map<string, PickRow[]>();
    displayItems.forEach((row) => {
      if (!row.snapshot_date) return;
      const list = grouped.get(row.snapshot_date) ?? [];
      list.push(row);
      grouped.set(row.snapshot_date, list);
    });

    const dates = Array.from(grouped.keys()).sort();
    const recentDates = dates.slice(-COMBO_HISTORY_SNAPSHOTS);
    const historyCombos: Combo[] = [];
    recentDates.forEach((date) => {
      const rows = grouped.get(date) ?? [];
      const resolvedRows = rows.filter((row) => row.status === "hit" || row.status === "miss");
      const candidates = buildComboCandidates(resolvedRows);
      const selectedCombos = buildSelectedCombosForCandidates(candidates, `history|${date}`);
      selectedCombos.forEach((combo) => {
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

  const combosHistoryMax5 = useMemo(() => {
    if (view !== "combos" || combosTab !== "compare" || combosCompareMode !== "max5") return [];

    const grouped = new Map<string, PickRow[]>();
    displayItems.forEach((row) => {
      if (!row.snapshot_date) return;
      const list = grouped.get(row.snapshot_date) ?? [];
      list.push(row);
      grouped.set(row.snapshot_date, list);
    });

    const dates = Array.from(grouped.keys()).sort();
    const recentDates = dates.slice(-COMBO_HISTORY_SNAPSHOTS);
    const historyCombos: Combo[] = [];
    recentDates.forEach((date) => {
      const rows = grouped.get(date) ?? [];
      const resolvedRows = rows.filter((row) => row.status === "hit" || row.status === "miss");
      const candidates = buildComboCandidates(resolvedRows);
      const selectedCombos = buildSelectedCombosForCandidates(
        candidates,
        `history|${date}`,
        MAX_COMBOS_COMPARE
      );
      selectedCombos.forEach((combo) => {
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
  }, [displayItems, combosTab, combosCompareMode, view]);

  const combosHistoryLeg7 = useMemo(() => {
    if (view !== "combos" || combosTab !== "compare" || combosCompareMode !== "legs7") return [];

    const grouped = new Map<string, PickRow[]>();
    displayItems.forEach((row) => {
      if (!row.snapshot_date) return;
      const list = grouped.get(row.snapshot_date) ?? [];
      list.push(row);
      grouped.set(row.snapshot_date, list);
    });

    const dates = Array.from(grouped.keys()).sort();
    const recentDates = dates.slice(-COMBO_HISTORY_SNAPSHOTS);
    const historyCombos: Combo[] = [];
    recentDates.forEach((date) => {
      const rows = grouped.get(date) ?? [];
      const resolvedRows = rows.filter((row) => row.status === "hit" || row.status === "miss");
      const candidates = buildComboCandidates(resolvedRows);
      const selectedCombos = buildSelectedCombosFixedLegsForCandidates(
        candidates,
        `history|${date}`,
        7,
        MAX_COMBOS
      );
      selectedCombos.forEach((combo) => {
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
  }, [displayItems, combosTab, combosCompareMode, view]);

  const combosHistoryLeg9 = useMemo(() => {
    if (view !== "combos" || combosTab !== "compare" || combosCompareMode !== "legs9") return [];

    const grouped = new Map<string, PickRow[]>();
    displayItems.forEach((row) => {
      if (!row.snapshot_date) return;
      const list = grouped.get(row.snapshot_date) ?? [];
      list.push(row);
      grouped.set(row.snapshot_date, list);
    });

    const dates = Array.from(grouped.keys()).sort();
    const recentDates = dates.slice(-COMBO_HISTORY_SNAPSHOTS);
    const historyCombos: Combo[] = [];
    recentDates.forEach((date) => {
      const rows = grouped.get(date) ?? [];
      const resolvedRows = rows.filter((row) => row.status === "hit" || row.status === "miss");
      const candidates = buildComboCandidates(resolvedRows);
      const selectedCombos = buildSelectedCombosFixedLegsForCandidates(
        candidates,
        `history|${date}`,
        9,
        MAX_COMBOS
      );
      selectedCombos.forEach((combo) => {
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
  }, [displayItems, combosTab, combosCompareMode, view]);

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
    const recentDates = dates.slice(-COMBO_HISTORY_SNAPSHOTS);

    let total = 0;
    let hits = 0;
    let misses = 0;
    let sumOdd = 0;
    let sumHitProfit = 0;

    for (const date of recentDates) {
      const rows = grouped.get(date) ?? [];
      const resolvedRows = rows.filter((row) => row.status === "hit" || row.status === "miss");
      const candidates = buildComboCandidates(resolvedRows);
      const odds = candidates.map((row) => Number(row.odd));
      const statuses = candidates.map((row) => row.status);
      const fixtureIds = candidates.map((row) => row.fixture_id);
      const n = candidates.length;
      if (n < 2) continue;

      for (let i = 0; i < n - 1; i += 1) {
        const oddA = odds[i];
        if (!Number.isFinite(oddA) || oddA <= 1) continue;
        for (let j = i + 1; j < n; j += 1) {
          if (fixtureIds[i] === fixtureIds[j]) continue; // bookmaker: no same match inside a combo
          const oddB = odds[j];
          if (!Number.isFinite(oddB) || oddB <= 1) continue;
          const totalOdd = oddA * oddB;
          if (totalOdd < MIN_COMBO_ODDS) continue;
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
    const profit = COMBOS_STAKE * (sumHitProfit - misses);
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

  const combosHistorySnapshotsStats = useMemo(() => {
    const empty = {
      snapshots: 0,
      totalCandidates: 0,
      uniqueFixtures: 0,
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
    const recentDates = dates.slice(-COMBO_HISTORY_SNAPSHOTS);
    let totalCandidates = 0;
    const fixtureIds = new Set<number>();

    for (const date of recentDates) {
      const rows = grouped.get(date) ?? [];
      const resolvedRows = rows.filter((row) => row.status === "hit" || row.status === "miss");
      const candidates = buildComboCandidates(resolvedRows);
      totalCandidates += candidates.length;
      candidates.forEach((row) => {
        const fixtureId = Number(row.fixture_id);
        if (Number.isFinite(fixtureId)) fixtureIds.add(fixtureId);
      });
    }

    return {
      snapshots: recentDates.length,
      totalCandidates,
      uniqueFixtures: fixtureIds.size,
    };
  }, [displayItems]);

  function computeCombosHistoryStatsForList(list: Combo[]) {
    const empty = {
      total: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      roiPct: 0,
      finalCapital: BASE_BANKROLL,
      profit: 0,
      avgOdd: 0,
      points: [],
      totalLegs: 0,
      roseLegs: 0,
      yellowLegs: 0,
      roseLegsPct: 0,
      yellowLegsPct: 0,
      uniqueFixtures: 0,
      avgLegsPerCombo: 0,
      maxDrawdownValue: 0,
      maxDrawdownPct: 0,
    };
    if (!list.length) return empty;

    const totalLegs = list.reduce((sum, combo) => sum + (combo.legs?.length ?? 0), 0);
    const fixtureIds = new Set<number>();
    let roseLegs = 0;
    let yellowLegs = 0;
    list.forEach((combo) => {
      combo.legs.forEach((leg) => {
        const fixtureId = Number(leg.fixture_id);
        if (Number.isFinite(fixtureId)) fixtureIds.add(fixtureId);
        if (leg.meets_criteria === true) roseLegs += 1;
        else yellowLegs += 1;
      });
    });
    const avgLegsPerCombo = list.length ? totalLegs / list.length : 0;
    const roseLegsPct = totalLegs ? (roseLegs / totalLegs) * 100 : 0;
    const yellowLegsPct = totalLegs ? (yellowLegs / totalLegs) * 100 : 0;

    const avgOdd = list.length
      ? list.reduce((sum, combo) => sum + (combo.totalOdd || 0), 0) / list.length
      : 0;
    const resolved = list.filter((c) => c.status === "hit" || c.status === "miss");
    const hits = resolved.filter((c) => c.status === "hit").length;
    const misses = resolved.filter((c) => c.status === "miss").length;
    const hitRate = resolved.length ? (hits / resolved.length) * 100 : 0;

    let capital = BASE_BANKROLL;
    const points: { x: number; y: number }[] = [];
    if (resolved.length) {
      points.push({ x: 0, y: Number(BASE_BANKROLL.toFixed(2)) });
      resolved.forEach((combo, idx) => {
        if (combo.status === "hit") {
          capital += COMBOS_STAKE * (combo.totalOdd - 1);
        } else {
          capital -= COMBOS_STAKE;
        }
        points.push({ x: idx + 1, y: Number(capital.toFixed(2)) });
      });
    }
    const finalCapital = points.length ? points[points.length - 1].y : BASE_BANKROLL;
    const profit = finalCapital - BASE_BANKROLL;
    const roiPct = ((finalCapital - BASE_BANKROLL) / BASE_BANKROLL) * 100;

    let peak = BASE_BANKROLL;
    let maxDrawdownValue = 0;
    let maxDrawdownPct = 0;
    points.forEach((point) => {
      peak = Math.max(peak, point.y);
      const drawdownValue = Math.max(0, peak - point.y);
      if (drawdownValue > maxDrawdownValue) {
        maxDrawdownValue = drawdownValue;
        maxDrawdownPct = peak ? (drawdownValue / peak) * 100 : 0;
      }
    });

    return {
      total: list.length,
      hits,
      misses,
      hitRate,
      roiPct,
      finalCapital,
      profit,
      avgOdd,
      points,
      totalLegs,
      roseLegs,
      yellowLegs,
      roseLegsPct,
      yellowLegsPct,
      uniqueFixtures: fixtureIds.size,
      avgLegsPerCombo,
      maxDrawdownValue,
      maxDrawdownPct,
    };
  }

  const combosHistoryStats = useMemo(
    () => computeCombosHistoryStatsForList(combosHistory),
    [combosHistory]
  );

  const combosHistoryStatsMax5 = useMemo(
    () => computeCombosHistoryStatsForList(combosHistoryMax5),
    [combosHistoryMax5]
  );

  const combosHistoryStatsLeg7 = useMemo(
    () => computeCombosHistoryStatsForList(combosHistoryLeg7),
    [combosHistoryLeg7]
  );

  const combosHistoryStatsLeg9 = useMemo(
    () => computeCombosHistoryStatsForList(combosHistoryLeg9),
    [combosHistoryLeg9]
  );

  const compareBaselineLabel = `2–3 matchs • max ${MAX_COMBOS}`;
  const compareVariant = (() => {
    if (combosCompareMode === "max5") {
      return {
        label: `2–3 matchs • max ${MAX_COMBOS_COMPARE}`,
        shortLabel: `Max ${MAX_COMBOS_COMPARE}`,
        stats: combosHistoryStatsMax5,
        header: "Max combinés / snapshot",
      };
    }
    if (combosCompareMode === "legs7") {
      return {
        label: `7 matchs • max ${MAX_COMBOS}`,
        shortLabel: "7 matchs",
        stats: combosHistoryStatsLeg7,
        header: "Taille combiné",
      };
    }
    return {
      label: `9 matchs • max ${MAX_COMBOS}`,
      shortLabel: "9 matchs",
      stats: combosHistoryStatsLeg9,
      header: "Taille combiné",
    };
  })();
  const compareVariantStats = compareVariant.stats;

  type CompactComboStatCardProps = {
    label: string;
    value: ReactNode;
    sub?: ReactNode;
    sub2?: ReactNode;
    valueClassName?: string;
    className?: string;
  };

  const CompactComboStatCard = ({
    label,
    value,
    sub,
    sub2,
    valueClassName = "text-white",
    className = "",
  }: CompactComboStatCardProps) => {
    return (
      <div className={`rounded-lg border border-white/10 bg-black/20 p-3 ${className}`}>
        <div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div>
        <div className={`mt-1 text-xl leading-none font-semibold tabular-nums ${valueClassName}`}>
          {value}
        </div>
        {sub ? <div className="mt-1 text-[11px] text-white/60">{sub}</div> : null}
        {sub2 ? <div className="mt-0.5 text-[10px] text-white/45">{sub2}</div> : null}
      </div>
    );
  };

  const OddsMinimumCard = ({ className = "" }: { className?: string }) => {
    const buckets = [
      { label: "≥ 1.30", pct: stats.odds130Pct, count: stats.odds130Count, hitRate: stats.odds130HitRate },
      { label: "≥ 1.25", pct: stats.odds125Pct, count: stats.odds125Count, hitRate: stats.odds125HitRate },
      { label: "≥ 1.18", pct: stats.odds118Pct, count: stats.odds118Count, hitRate: stats.odds118HitRate },
      { label: "< 1.18", pct: stats.oddsUnder118Pct, count: stats.oddsUnder118Count, hitRate: stats.oddsUnder118HitRate },
    ];
    return (
      <div className={`rounded-xl border border-white/10 bg-white/5 p-3 ${className}`}>
        <div className="text-xs text-white/60">Odds minimum</div>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {buckets.map((bucket) => (
            <div
              key={bucket.label}
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/70">{bucket.label}</span>
                <span className="text-emerald-200 tabular-nums font-semibold">
                  {bucket.hitRate.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-white/55">
                <span className="tabular-nums">Part {bucket.pct.toFixed(1)}%</span>
                <span className="tabular-nums">{bucket.count} picks</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const MoreSinglesStatsCard = ({ className = "" }: { className?: string }) => {
    return (
      <>
	        <div className="sm:hidden flex items-center justify-center gap-2">
	          <button
	            type="button"
	            onClick={() => setShowMoreSinglesStats((prev) => !prev)}
	            className={`px-4 py-2 rounded-lg text-sm border text-sky-100 bg-white/5 hover:bg-white/10 transition ${
	              showMoreSinglesStats ? "border-orange-400/90" : "border-sky-400/70"
	            }`}
	          >
	            {showMoreSinglesStats ? "Show less" : "Show more"}
	          </button>
	          {hasMarketExclusions ? (
            <button
              type="button"
	              onClick={() => setShowMarketExclusions((prev) => !prev)}
	              aria-pressed={showMarketExclusions}
	              title="Exclure marchés"
	              className={`px-4 py-2 rounded-lg text-sm border text-sky-100 transition ${
	                showMarketExclusions
	                  ? "border-orange-400/90 bg-sky-500/15 hover:bg-sky-500/20"
	                  : "border-sky-400/70 bg-white/5 hover:bg-white/10"
	              }`}
	            >
	              Marchés
            </button>
          ) : null}
        </div>

        {!showMoreSinglesStats ? (
          <div className={`hidden sm:block rounded-xl border border-white/10 bg-white/5 p-3 ${className}`}>
            <div className="flex items-center justify-center h-12">
              <button
                type="button"
                onClick={() => setShowMoreSinglesStats(true)}
                className="px-4 py-2 rounded-lg text-sm bg-white/10 text-white/80 hover:bg-white/20"
              >
                Show more
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="hidden sm:flex items-center justify-center">
              <button
                type="button"
                onClick={() => setShowMoreSinglesStats(false)}
                className="px-3 py-1 rounded-lg text-xs bg-white/10 text-white/70 hover:bg-white/20"
              >
                Show less
              </button>
            </div>

            <div className={`rounded-xl border border-white/10 bg-white/5 p-3 ${className}`}>
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
		            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
		              <div className="text-[10px] uppercase tracking-wide text-white/40">Drawdown max</div>
		              <div className="mt-1 text-lg font-semibold text-rose-300 tabular-nums">
	                {stats.maxDrawdownPct.toFixed(1)}%
	              </div>
              <div className="text-[11px] text-white/50 tabular-nums">
                {stats.maxDrawdownAbs.toFixed(2)}$
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-white/40">
                Cote moyenne
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {stats.avgOddAll.toFixed(2)}
              </div>
              <div className="text-[11px] text-white/50">Tous picks</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-white/40">
                Matchs analysés
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{analyzedMatches}</div>
              <div className="text-[11px] text-white/50">Base historique</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-white/40">
                Matchs sans cote
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {matchesWithoutOddsStats.matchesWithoutOdds}
                <span className="text-white/40 text-sm">
                  {" "}
                  / {matchesWithoutOddsStats.totalMatches}
                </span>
              </div>
              <div className="text-[11px] text-white/50 tabular-nums">
                {matchesWithoutOddsStats.ratioPct.toFixed(1)}%
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs text-white/60">Pick le plus sélectionné</div>
            {stats.pickEntries.length ? (
              <div className="mt-2">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-1 text-[10px] uppercase tracking-wide text-white/40">
                  <span>Pick</span>
                  <span className="text-right">Part</span>
                  <span className="text-right">Hit</span>
                </div>
                <div className="mt-1 max-h-28 overflow-y-auto pr-1 divide-y divide-white/10">
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
	        </div>
	      </div>
          </>
        )}
      </>
    );
	  };

  const CompetitionsCard = ({ className = "" }: { className?: string }) => (
    <div className={`rounded-xl border border-white/10 bg-white/5 p-3 ${className}`}>
      <div className="text-xs text-white/60">Championnats (au moins 1 pick)</div>
      <CompetitionSortControls />
      <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-black/20">
        <div className="hidden sm:block">
          <div className="grid grid-cols-[1.4fr_80px_90px_90px_90px_90px] gap-3 px-3 py-2 text-[10px] uppercase tracking-wide text-white/40">
            <span>Championnat</span>
            <span className="text-right">Cote moy</span>
            <span className="text-right">Hits</span>
            <span className="text-right">Picks</span>
            <span className="text-right">Hit rate</span>
            <span className="text-right">Part</span>
          </div>
          <div className="divide-y divide-white/10 text-[12px] text-white/70">
            {competitionStatsSorted.length ? (
              <>
                <div className="grid grid-cols-[1.4fr_80px_90px_90px_90px_90px] items-center gap-3 px-3 py-2 text-white/80">
                  <span className="truncate font-semibold">TOTAL / MOYENNE</span>
                  <span className="text-right tabular-nums">
                    {competitionSummary.avgOdd ? competitionSummary.avgOdd.toFixed(2) : "-"}
                  </span>
                  <span className="text-right tabular-nums text-emerald-200">
                    {competitionSummary.totalHits}
                    <span className="text-white/40"> / {competitionSummary.totalPicks}</span>
                  </span>
                  <span className="text-right tabular-nums">{competitionSummary.totalPicks}</span>
                  <span className="text-right tabular-nums text-emerald-200">
                    {competitionSummary.hitRate.toFixed(1)}%
                  </span>
                  <span className="text-right tabular-nums text-white/60">
                    {competitionSummary.avgPicks.toFixed(1)}
                  </span>
                </div>
                {competitionStatsSorted.map((row) => {
                  const isDiscouraged = DISCOURAGED_COMPETITIONS.has(
                    `${row.country}|||${row.name}`
                  );
                  return (
                    <div
                      key={`${row.country}-${row.name}`}
                      className={`grid grid-cols-[1.4fr_80px_90px_90px_90px_90px] items-center gap-3 px-3 py-2 ${
                        isDiscouraged ? "text-rose-300" : "text-white/70"
                      }`}
                    >
                      <span className="truncate">
                        {row.country} - {row.name}
                      </span>
                      <span
                        className={`text-right tabular-nums ${
                          isDiscouraged ? "text-rose-300" : "text-white/70"
                        }`}
                      >
                        {row.avgOdd ? row.avgOdd.toFixed(2) : "-"}
                      </span>
                      <span
                        className={`text-right tabular-nums ${
                          isDiscouraged ? "text-rose-300" : "text-emerald-200"
                        }`}
                      >
                        {row.hits}
                        <span className={isDiscouraged ? "text-rose-200" : "text-white/40"}>
                          {" "}
                          / {row.total}
                        </span>
                      </span>
                      <span className="text-right tabular-nums">{row.total}</span>
                      <span
                        className={`text-right tabular-nums ${
                          isDiscouraged ? "text-rose-300" : "text-emerald-200"
                        }`}
                      >
                        {row.hitRate.toFixed(1)}%
                      </span>
                      <span
                        className={`text-right tabular-nums ${
                          isDiscouraged ? "text-rose-300" : "text-white/60"
                        }`}
                      >
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

        <div className="sm:hidden divide-y divide-white/10 text-[12px] text-white/70">
          {competitionStatsSorted.length ? (
            <>
              <div className="px-3 py-2 text-white/80">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-semibold">TOTAL / MOYENNE</span>
                  <span className="tabular-nums font-semibold text-emerald-200">
                    {competitionSummary.hitRate.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/55">
                  <span className="tabular-nums">
                    Cote {competitionSummary.avgOdd ? competitionSummary.avgOdd.toFixed(2) : "-"}
                  </span>
                  <span className="tabular-nums">
                    Hits {competitionSummary.totalHits}/{competitionSummary.totalPicks}
                  </span>
                  <span className="tabular-nums">Picks {competitionSummary.totalPicks}</span>
                </div>
              </div>
              {competitionStatsSorted.map((row) => {
                const isDiscouraged = DISCOURAGED_COMPETITIONS.has(`${row.country}|||${row.name}`);
                return (
                  <div
                    key={`${row.country}-${row.name}`}
                    className={`px-3 py-2 ${
                      isDiscouraged ? "bg-rose-500/10 text-rose-300" : "text-white/70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={`truncate font-medium ${
                          isDiscouraged ? "text-rose-200" : "text-white/80"
                        }`}
                      >
                        {row.country} - {row.name}
                      </span>
                      <span
                        className={`tabular-nums font-semibold ${
                          isDiscouraged ? "text-rose-200" : "text-emerald-200"
                        }`}
                      >
                        {row.hitRate.toFixed(1)}%
                      </span>
                    </div>
                    <div
                      className={`mt-1 flex items-center justify-between gap-3 text-[11px] ${
                        isDiscouraged ? "text-rose-200" : "text-white/55"
                      }`}
                    >
                      <span className="tabular-nums">Cote {row.avgOdd ? row.avgOdd.toFixed(2) : "-"}</span>
                      <span className="tabular-nums">
                        {row.hits}/{row.total} • {row.share.toFixed(1)}%
                      </span>
                    </div>
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
  );

  const syncSinglesInsightsCarouselIndex = () => {
    const container = singlesInsightsCarouselRef.current;
    if (!container) return;
    const slides = Array.from(
      container.querySelectorAll("[data-singles-insights-slide]")
    ) as HTMLElement[];
    if (!slides.length) return;

    const left = container.scrollLeft;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    slides.forEach((slide, idx) => {
      const distance = Math.abs(slide.offsetLeft - left);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = idx;
      }
    });

    setSinglesInsightsCarouselIndex((prev) => (prev === bestIndex ? prev : bestIndex));
  };

  const scrollSinglesInsightsCarouselTo = (index: number) => {
    const container = singlesInsightsCarouselRef.current;
    if (!container) return;
    const slides = Array.from(
      container.querySelectorAll("[data-singles-insights-slide]")
    ) as HTMLElement[];
    const target = slides[index];
    if (!target) return;
    container.scrollTo({ left: target.offsetLeft, behavior: "smooth" });
  };

  const MarketExclusionsCard = ({ className = "" }: { className?: string }) => {
    if (!availableMarkets.length && !availableLines.length && !availablePickCodes.length) {
      return null;
    }

    return (
      <div className={`rounded-xl border border-white/10 bg-white/5 p-3 ${className}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-white/60">
            Exclure marchés{excludedMarkets.length ? ` (${excludedMarkets.length})` : ""}
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
    );
  };

  return (
    <div className="min-h-screen w-full px-3 py-4 sm:p-6 text-white space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">
          {view === "combos" ? "Combinés" : "Historique Algo"}
        </h1>
        {view === "combos" ? (
          <p className="text-sm text-white/60">
            Historique et performance des combinés automatiques.
          </p>
        ) : null}
        <p className="text-xs text-white/50 mt-1">
          {displayItems.length} pick(s) chargés
          {view === "combos"
            ? ` • ${combosHistoryStats.total} combiné(s) • ${combosHistoryStats.totalLegs} match(s)`
            : ""}
          {lastFetchedAt ? (
            <span className="text-white/35">
              {" "}
              • MAJ: {new Date(lastFetchedAt).toLocaleString("fr-FR")}
            </span>
          ) : null}
        </p>
      </div>

	      <div
	        ref={filtersCardRef}
	        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2"
	      >
	        <div className="flex items-start sm:items-center gap-3">
	          <div className="min-w-0 flex-1">
		            <div className="hidden sm:block text-sm text-white/70">
		              <span className="text-white/40">Filtres :</span>{" "}
		              <span className="text-white/80">{activeCriteriaLabel}</span>
		              <span className="text-white/35"> • </span>
		              <span className="text-white/80">{activeOddsFilterLabel}</span>
		              <span className="text-white/35"> • </span>
		              <span className="text-white/80">{activeMarketLabel}</span>
		              {view === "singles" ? (
		                <>
		                  <span className="text-white/35"> • </span>
		                  <span className="text-white/80">{activeAlgoLabel}</span>
		                </>
		              ) : null}
		              <span className="text-white/35"> • </span>
		              <span className="text-white/60">Tous les jours</span>
		            </div>
	            <div className="sm:hidden">
	              <div className="text-[10px] uppercase tracking-wide text-white/45">
	                Filtres
	              </div>
	              <div className="mt-1 flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
	                <span
	                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] whitespace-nowrap ${
	                    criteria === "all"
	                      ? "border-white/10 bg-black/20 text-white/70"
	                      : "border-sky-300/40 bg-sky-500/15 text-sky-100"
	                  }`}
	                >
	                  {activeCriteriaChipLabel}
	                </span>
	                <span
	                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] whitespace-nowrap ${
	                    oddsFilter === "all"
	                      ? "border-white/10 bg-black/20 text-white/70"
	                      : "border-sky-300/40 bg-sky-500/15 text-sky-100"
	                  }`}
	                >
	                  {activeOddsChipLabel}
	                </span>
	                <span
	                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] whitespace-nowrap ${
	                    market === "all"
	                      ? "border-white/10 bg-black/20 text-white/70"
	                      : "border-sky-300/40 bg-sky-500/15 text-sky-100"
	                  }`}
	                >
	                  {activeMarketChipLabel}
	                </span>
	              </div>
	            </div>
	          </div>
	          <div className="flex items-center gap-2 shrink-0">
	            <button
	              type="button"
	              onClick={() => downloadFullExport("csv")}
	              className="px-2.5 py-1 rounded-lg text-xs sm:px-3 sm:text-sm bg-white/10 text-white/80 hover:bg-white/20 transition"
	              title="Télécharger tous les picks avec historique team_stats (CSV)"
	            >
	              Export CSV
	            </button>
	            <button
	              type="button"
	              onClick={() => downloadFullExport("json")}
	              className="px-2.5 py-1 rounded-lg text-xs sm:px-3 sm:text-sm bg-white/10 text-white/80 hover:bg-white/20 transition"
	              title="Télécharger tous les picks avec historique team_stats (JSON)"
	            >
	              Export JSON
	            </button>
	            <button
	              type="button"
	              onClick={() => setShowFiltersPanel((value) => !value)}
	              aria-expanded={showFiltersPanel}
	              aria-controls="filters-panel"
	              className="px-2.5 py-1 rounded-lg text-xs sm:px-3 sm:text-sm bg-white/10 text-white/80 hover:bg-white/20 transition"
	            >
	              {showFiltersPanel ? "Fermer" : "Filtres"}
	            </button>
	            <button
	              type="button"
	              onClick={refresh}
	              disabled={loading}
	              className={`px-2.5 py-1 rounded-lg text-xs sm:px-3 sm:text-sm transition ${
	                loading
	                  ? "bg-white/10 text-white/40 cursor-not-allowed"
	                  : "bg-white/10 text-white/70 hover:bg-white/20"
	              }`}
	              title="Rafraîchir la liste (utile après avoir résolu des picks)"
	              aria-label="Rafraîchir"
	            >
	              <span className="sm:hidden" aria-hidden>
	                ⟳
	              </span>
	              <span className="hidden sm:inline">Rafraîchir</span>
	            </button>
	          </div>
		        </div>

            {view === "singles" ? (
              <div className="mt-2 border-t border-white/10 pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-white/40">Algorithme</span>
                  {algoOptions.map((option) => (
                    <button
                      key={`algo-switch-${option.key}`}
                      type="button"
                      onClick={() => setAlgoVersion(option.key)}
                      className={`px-3 py-1 rounded-lg text-xs sm:text-sm transition ${
                        algoVersion === option.key
                          ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                          : "bg-white/10 text-white/70 hover:bg-white/20"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

	        {showFiltersPanel ? (
	          <div id="filters-panel" className="mt-3 border-t border-white/10 pt-3">
	            <div className={`grid grid-cols-1 gap-4 ${view === "singles" ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
	              <div>
	                <div className="text-xs uppercase tracking-wide text-white/40">Critère</div>
	                <div className="mt-2 flex flex-wrap gap-2">
                  {criteriaOptions.map((option) => (
                    <button
                      key={`panel-criteria-${option.key}`}
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
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-white/40">Odds</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {oddsFilterOptions.map((option) => (
                    <button
                      key={`panel-odds-${option.key}`}
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
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-white/40">Marché</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {marketOptions.map((option) => (
                    <button
                      key={`panel-market-${option.key}`}
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
	              </div>

                {view === "singles" ? (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-white/40">Algorithme</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {algoOptions.map((option) => (
                        <button
                          key={`panel-algo-${option.key}`}
                          type="button"
                          onClick={() => setAlgoVersion(option.key)}
                          className={`px-3 py-1 rounded-lg text-sm transition ${
                            algoVersion === option.key
                              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                              : "bg-white/10 text-white/70 hover:bg-white/20"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
	            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setCriteria("all");
                  setOddsFilter("all");
                  setMarket("all");
                }}
                className="text-sm text-white/60 hover:text-white"
              >
                Réinitialiser
              </button>
              <button
                type="button"
                onClick={() => setShowFiltersPanel(false)}
                className="px-4 py-2 rounded-lg text-sm bg-white/10 text-white/80 hover:bg-white/20"
              >
                OK
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {view !== "singles" ? <MarketExclusionsCard /> : null}

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {view === "singles" ? (
        <>
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 items-start">
		              <div className="rounded-xl border-0 bg-gradient-to-br from-indigo-900 via-blue-800 to-sky-600 p-2 sm:p-3 text-white shadow-md shadow-sky-500/25 sm:border-2 sm:border-sky-400 sm:bg-none sm:bg-white/5 sm:shadow-none">
	                <div className="text-[11px] sm:text-xs text-white/90 sm:text-white/60 leading-tight">
	                  Picks résolus{" "}
                    <span className="text-white/40 hidden sm:inline">(hors blacklist)</span>
	                </div>
		                <div className="text-lg sm:text-2xl font-semibold leading-none">
	                  {stats.total}
                  <span className="text-xs sm:text-sm text-white/80 sm:text-white/40 ml-1.5">/ {stats.totalDisplay}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-white/45 hidden sm:block">
                  Total résolus (incl.): {stats.totalAll} •{" "}
                  <span className="text-emerald-200">{stats.hitsAll}</span>{" "}
                  <span className="text-white/35">/</span>{" "}
                  <span className="text-rose-200">{stats.missesAll}</span>
                </div>
              </div>

		              <div className="rounded-xl border-0 bg-gradient-to-br from-indigo-900 via-blue-800 to-sky-600 p-2 sm:p-3 text-white shadow-md shadow-sky-500/25 sm:border-2 sm:border-sky-400 sm:bg-none sm:bg-white/5 sm:shadow-none">
	                <div className="text-[11px] sm:text-xs text-white/90 sm:text-white/60 leading-tight">Taux de réussite</div>
		                <div className="text-lg sm:text-2xl font-semibold text-emerald-200 leading-none">
	                  {stats.hitRate.toFixed(1)}%
	                </div>
                <div className="mt-0.5 text-[11px] text-white/45 hidden sm:block">
                  Total (incl.): {stats.hitRateAll.toFixed(1)}%
                </div>
              </div>

		              <div className="rounded-xl border-0 bg-gradient-to-br from-indigo-900 via-blue-800 to-sky-600 p-2 sm:p-3 text-white shadow-md shadow-sky-500/25 sm:border-2 sm:border-sky-400 sm:bg-none sm:bg-white/5 sm:shadow-none">
	                <div className="text-[11px] sm:text-xs text-white/90 sm:text-white/60 leading-tight">Hits / Miss</div>
		                <div className="text-lg sm:text-2xl font-semibold leading-none">
	                  <span className="text-emerald-300">{stats.hits}</span>
	                  <span className="text-white/50"> / </span>
                  <span className="text-rose-300">{stats.misses}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-white/45 hidden sm:block">
                  Total (incl.):{" "}
                  <span className="text-emerald-200">{stats.hitsAll}</span>{" "}
                  <span className="text-white/35">/</span>{" "}
                  <span className="text-rose-200">{stats.missesAll}</span>
                </div>
              </div>

		              <div className="rounded-xl border-0 bg-gradient-to-br from-indigo-900 via-blue-800 to-sky-600 p-2 sm:p-3 text-white shadow-md shadow-sky-500/25 sm:border-2 sm:border-sky-400 sm:bg-none sm:bg-white/5 sm:shadow-none">
	                <div className="text-[11px] sm:text-xs text-white/90 sm:text-white/60 leading-tight">ROI</div>
	                <div
		                  className={`text-lg sm:text-2xl font-semibold leading-none ${
	                    stats.roiPct >= 0 ? "text-emerald-200" : "text-rose-300"
                  }`}
                >
                  {stats.roiPct.toFixed(1)}%
                </div>
		              </div>
			            </div>

			            <MoreSinglesStatsCard />

			            {showMarketExclusions ? <MarketExclusionsCard className="sm:hidden" /> : null}

					      <div className="hidden sm:block rounded-xl border border-white/10 bg-white/5 p-3">
						          <div className="text-xs text-white/60">Championnats (au moins 1 pick)</div>
                      <CompetitionSortControls />
						          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-black/20">
		                    <div className="hidden sm:block">
			              <div className="grid grid-cols-[1.4fr_80px_90px_90px_90px_90px] gap-3 px-3 py-2 text-[10px] uppercase tracking-wide text-white/40">
			                <span>Championnat</span>
			                <span className="text-right">Cote moy</span>
			                <span className="text-right">Hits</span>
			                <span className="text-right">Picks</span>
			                <span className="text-right">Hit rate</span>
			                <span className="text-right">Part</span>
			              </div>
			              <div className="divide-y divide-white/10 text-[12px] text-white/70">
				                {competitionStatsSorted.length ? (
			                  <>
			                    <div className="grid grid-cols-[1.4fr_80px_90px_90px_90px_90px] items-center gap-3 px-3 py-2 text-white/80">
			                      <span className="truncate font-semibold">TOTAL / MOYENNE</span>
			                      <span className="text-right tabular-nums">
			                        {competitionSummary.avgOdd ? competitionSummary.avgOdd.toFixed(2) : "-"}
			                      </span>
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
				                    {competitionStatsSorted.map((row) => {
			                      const isDiscouraged = DISCOURAGED_COMPETITIONS.has(
			                        `${row.country}|||${row.name}`
			                      );
			                      return (
			                        <div
			                          key={`${row.country}-${row.name}`}
			                          className={`grid grid-cols-[1.4fr_80px_90px_90px_90px_90px] items-center gap-3 px-3 py-2 ${
			                            isDiscouraged ? "text-rose-300" : "text-white/70"
			                          }`}
			                        >
			                          <span className="truncate">
			                            {row.country} - {row.name}
			                          </span>
			                          <span
			                            className={`text-right tabular-nums ${
			                              isDiscouraged ? "text-rose-300" : "text-white/70"
			                            }`}
			                          >
			                            {row.avgOdd ? row.avgOdd.toFixed(2) : "-"}
			                          </span>
			                          <span
			                            className={`text-right tabular-nums ${
			                              isDiscouraged ? "text-rose-300" : "text-emerald-200"
			                            }`}
			                          >
			                            {row.hits}
			                            <span className={isDiscouraged ? "text-rose-200" : "text-white/40"}>
			                              {" "}
			                              / {row.total}
			                            </span>
			                          </span>
			                          <span className="text-right tabular-nums">{row.total}</span>
			                          <span
			                            className={`text-right tabular-nums ${
			                              isDiscouraged ? "text-rose-300" : "text-emerald-200"
			                            }`}
			                          >
			                            {row.hitRate.toFixed(1)}%
			                          </span>
			                          <span
			                            className={`text-right tabular-nums ${
			                              isDiscouraged ? "text-rose-300" : "text-white/60"
			                            }`}
			                          >
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
                    <div className="sm:hidden divide-y divide-white/10 text-[12px] text-white/70">
		                      {competitionStatsSorted.length ? (
                        <>
                          <div className="px-3 py-2 text-white/80">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate font-semibold">TOTAL / MOYENNE</span>
                              <span className="tabular-nums font-semibold text-emerald-200">
                                {competitionSummary.hitRate.toFixed(1)}%
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/55">
                              <span className="tabular-nums">
                                Cote {competitionSummary.avgOdd ? competitionSummary.avgOdd.toFixed(2) : "-"}
                              </span>
                              <span className="tabular-nums">
                                Hits {competitionSummary.totalHits}/{competitionSummary.totalPicks}
                              </span>
                              <span className="tabular-nums">Picks {competitionSummary.totalPicks}</span>
                            </div>
                          </div>
                          {competitionStatsSorted.map((row) => {
                            const isDiscouraged = DISCOURAGED_COMPETITIONS.has(
                              `${row.country}|||${row.name}`
                            );
                            return (
                              <div
                                key={`${row.country}-${row.name}`}
                                className={`px-3 py-2 ${
                                  isDiscouraged ? "bg-rose-500/10 text-rose-300" : "text-white/70"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span
                                    className={`truncate font-medium ${
                                      isDiscouraged ? "text-rose-200" : "text-white/80"
                                    }`}
                                  >
                                    {row.country} - {row.name}
                                  </span>
                                  <span
                                    className={`tabular-nums font-semibold ${
                                      isDiscouraged ? "text-rose-200" : "text-emerald-200"
                                    }`}
                                  >
                                    {row.hitRate.toFixed(1)}%
                                  </span>
                                </div>
                                <div
                                  className={`mt-1 flex items-center justify-between gap-3 text-[11px] ${
                                    isDiscouraged ? "text-rose-200" : "text-white/55"
                                  }`}
                                >
                                  <span className="tabular-nums">
                                    Cote {row.avgOdd ? row.avgOdd.toFixed(2) : "-"}
                                  </span>
                                  <span className="tabular-nums">
                                    {row.hits}/{row.total} • {row.share.toFixed(1)}%
                                  </span>
                                </div>
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

			            <div
			              className={`grid grid-cols-1 gap-3 items-start ${
			                hasMarketExclusions ? "md:grid-cols-2" : ""
			              }`}
			            >
			              {hasMarketExclusions ? <MarketExclusionsCard className="hidden sm:block" /> : null}
			              <OddsMinimumCard className="hidden sm:block" />
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
	              subLabel={`(${BASE_BANKROLL}$ base • ${SINGLES_STAKE}$ / mise)`}
	            />
	          )}

	          <div className="sm:hidden">
	            <div className="flex items-center justify-center gap-2">
	              <button
	                type="button"
	                onClick={() => {
	                  scrollSinglesInsightsCarouselTo(0);
	                  setSinglesInsightsCarouselIndex(0);
	                }}
	                className="p-1"
	                aria-label="Voir championnats"
	              >
	                <span
	                  className={`block h-1.5 w-1.5 rounded-full transition ${
	                    singlesInsightsCarouselIndex === 0 ? "bg-white/80" : "bg-white/25"
	                  }`}
	                />
	              </button>
	              <button
	                type="button"
	                onClick={() => {
	                  scrollSinglesInsightsCarouselTo(1);
	                  setSinglesInsightsCarouselIndex(1);
	                }}
	                className="p-1"
	                aria-label="Voir odds minimum"
	              >
	                <span
	                  className={`block h-1.5 w-1.5 rounded-full transition ${
	                    singlesInsightsCarouselIndex === 1 ? "bg-white/80" : "bg-white/25"
	                  }`}
	                />
	              </button>
	            </div>
	            <div
	              ref={singlesInsightsCarouselRef}
	              onScroll={syncSinglesInsightsCarouselIndex}
	              className="mt-2 flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-1"
	            >
	              <div data-singles-insights-slide className="w-full shrink-0 snap-start">
	                <CompetitionsCard />
	              </div>
	              <div data-singles-insights-slide className="w-full shrink-0 snap-start">
	                <OddsMinimumCard />
	              </div>
	            </div>
	          </div>

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
                  Sélection aléatoire • Hors blacklist • Cote totale ≥ {MIN_COMBO_ODDS.toFixed(2)} •
                  2–3 matchs (3 si nécessaire) • max {MAX_COMBOS} combiné(s)
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
	                      {combo.legs.map((leg) => {
                          const leagueCountry = leg.competition_country ?? "Inconnu";
                          const leagueName = leg.competition_name ?? "Competition";
                          const leagueHitRate =
                            competitionHitRateByKey.get(`${leagueCountry}|||${leagueName}`) ?? null;
                          return (
	                        <div key={leg.id} className="flex items-center justify-between gap-3">
	                          <div className="min-w-0">
	                            <div className="truncate">
	                              {Number.isFinite(leg.home_team_id) && (leg.home_team_id ?? 0) > 0 ? (
	                                <Link
	                                  href={`/team/${leg.home_team_id}`}
	                                  className="text-cyan-200 hover:underline"
	                                >
	                                  {leg.home_name ?? "Home"}
	                                </Link>
	                              ) : (
	                                <>{leg.home_name ?? "Home"}</>
	                              )}{" "}
	                              vs{" "}
	                              {Number.isFinite(leg.away_team_id) && (leg.away_team_id ?? 0) > 0 ? (
	                                <Link
	                                  href={`/team/${leg.away_team_id}`}
	                                  className="text-cyan-200 hover:underline"
	                                >
	                                  {leg.away_name ?? "Away"}
	                                </Link>
	                              ) : (
	                                <>{leg.away_name ?? "Away"}</>
	                              )}
	                            </div>
	                            <div className="text-white/50">
	                              {leg.pick} • {leg.odd ?? "-"}
	                            </div>
	                            <div className="text-[11px] text-white/45 truncate">
                                  {leagueCountry} - {leagueName} • Hit{" "}
                                  {leagueHitRate == null ? "-" : `${leagueHitRate.toFixed(1)}%`}
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
	                      )})}
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

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCombosTab("history")}
              className={`px-3 py-1 rounded-lg text-sm transition ${
                combosTab === "history"
                  ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                  : "bg-white/10 text-white/70 hover:bg-white/20"
              }`}
            >
              Historique (max {MAX_COMBOS})
            </button>
            <button
              type="button"
              onClick={() => setCombosTab("compare")}
              className={`px-3 py-1 rounded-lg text-sm transition ${
                combosTab === "compare"
                  ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                  : "bg-white/10 text-white/70 hover:bg-white/20"
              }`}
            >
              Comparateur
            </button>
          </div>

	          {combosTab === "compare" ? (
	            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
	              <div className="flex flex-wrap items-start justify-between gap-2">
	                <div>
	                  <div className="text-sm font-semibold">Comparateur historique</div>
	                  <div className="text-xs text-white/60">
	                    Baseline: {compareBaselineLabel} • Test: {compareVariant.label} •{" "}
	                    {combosHistorySnapshotsStats.snapshots} snapshot(s) •{" "}
	                    {combosHistorySnapshotsStats.totalCandidates} match(s) candidat(s) • Mise{" "}
	                    {COMBOS_STAKE}$
	                  </div>
	                </div>
	                <div className="text-xs text-white/50">
	                  Fenêtre: {COMBO_HISTORY_SNAPSHOTS} snapshots
	                </div>
	              </div>

	              <div className="mt-3 flex flex-wrap items-center gap-2">
	                <button
	                  type="button"
	                  onClick={() => setCombosCompareMode("max5")}
	                  className={`px-3 py-1 rounded-lg text-sm transition ${
	                    combosCompareMode === "max5"
	                      ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
	                      : "bg-white/10 text-white/70 hover:bg-white/20"
	                  }`}
	                >
	                  Max {MAX_COMBOS_COMPARE}
	                </button>
	                <button
	                  type="button"
	                  onClick={() => setCombosCompareMode("legs7")}
	                  className={`px-3 py-1 rounded-lg text-sm transition ${
	                    combosCompareMode === "legs7"
	                      ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
	                      : "bg-white/10 text-white/70 hover:bg-white/20"
	                  }`}
	                >
	                  7 matchs
	                </button>
	                <button
	                  type="button"
	                  onClick={() => setCombosCompareMode("legs9")}
	                  className={`px-3 py-1 rounded-lg text-sm transition ${
	                    combosCompareMode === "legs9"
	                      ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
	                      : "bg-white/10 text-white/70 hover:bg-white/20"
	                  }`}
	                >
	                  9 matchs
	                </button>
	              </div>
	
	              <div className="mt-4 overflow-x-auto rounded-lg border border-white/10 bg-black/20 p-3">
	                <div className="min-w-[720px] grid grid-cols-[1.4fr_0.6fr_0.6fr_0.6fr] gap-3">
	                  <div className="text-[10px] uppercase tracking-wide text-white/40">Métrique</div>
	                  <div className="text-[10px] uppercase tracking-wide text-white/40 text-right">
	                    Baseline
	                  </div>
	                  <div className="text-[10px] uppercase tracking-wide text-white/40 text-right">
	                    {compareVariant.shortLabel}
	                  </div>
	                  <div className="text-[10px] uppercase tracking-wide text-white/40 text-right">
	                    Δ
	                  </div>

                  <div className="text-sm text-white/70">Total combinés</div>
	                  <div className="text-sm tabular-nums text-right">{combosHistoryStats.total}</div>
	                  <div className="text-sm tabular-nums text-right">
	                    {compareVariantStats.total}
	                  </div>
	                  <div className="text-sm tabular-nums text-right text-white/60">
	                    {formatSigned(compareVariantStats.total - combosHistoryStats.total, 0)}
	                  </div>

                  <div className="text-sm text-white/70">Hits</div>
                  <div className="text-sm tabular-nums text-right text-emerald-300">
                    {combosHistoryStats.hits}
                  </div>
	                  <div className="text-sm tabular-nums text-right text-emerald-300">
	                    {compareVariantStats.hits}
	                  </div>
	                  <div className="text-sm tabular-nums text-right text-white/60">
	                    {formatSigned(compareVariantStats.hits - combosHistoryStats.hits, 0)}
	                  </div>

                  <div className="text-sm text-white/70">Miss</div>
                  <div className="text-sm tabular-nums text-right text-rose-300">
                    {combosHistoryStats.misses}
                  </div>
	                  <div className="text-sm tabular-nums text-right text-rose-300">
	                    {compareVariantStats.misses}
	                  </div>
	                  <div className="text-sm tabular-nums text-right text-white/60">
	                    {formatSigned(compareVariantStats.misses - combosHistoryStats.misses, 0)}
	                  </div>

                  <div className="text-sm text-white/70">Hit rate</div>
                  <div className="text-sm tabular-nums text-right">
                    {combosHistoryStats.hitRate.toFixed(1)}%
	                  </div>
	                  <div className="text-sm tabular-nums text-right">
	                    {compareVariantStats.hitRate.toFixed(1)}%
	                  </div>
	                  <div className="text-sm tabular-nums text-right text-white/60">
	                    {formatSigned(
	                      compareVariantStats.hitRate - combosHistoryStats.hitRate,
	                      1,
	                      "%"
	                    )}
	                  </div>

                  <div className="text-sm text-white/70">ROI</div>
                  <div className="text-sm tabular-nums text-right">
                    {combosHistoryStats.roiPct.toFixed(1)}%
	                  </div>
	                  <div className="text-sm tabular-nums text-right">
	                    {compareVariantStats.roiPct.toFixed(1)}%
	                  </div>
	                  <div className="text-sm tabular-nums text-right text-white/60">
	                    {formatSigned(
	                      compareVariantStats.roiPct - combosHistoryStats.roiPct,
	                      1,
	                      "%"
	                    )}
	                  </div>

                  <div className="text-sm text-white/70">Profit</div>
                  <div
                    className={`text-sm tabular-nums text-right ${
                      combosHistoryStats.profit >= 0 ? "text-emerald-300" : "text-rose-300"
                    }`}
                  >
                    {formatSigned(combosHistoryStats.profit, 0, "$")}
                  </div>
	                  <div
	                    className={`text-sm tabular-nums text-right ${
	                      compareVariantStats.profit >= 0 ? "text-emerald-300" : "text-rose-300"
	                    }`}
	                  >
	                    {formatSigned(compareVariantStats.profit, 0, "$")}
	                  </div>
	                  <div className="text-sm tabular-nums text-right text-white/60">
	                    {formatSigned(compareVariantStats.profit - combosHistoryStats.profit, 0, "$")}
	                  </div>

                  <div className="text-sm text-white/70">Croissance (capital)</div>
                  <div className="text-sm tabular-nums text-right">
                    {combosHistoryStats.finalCapital.toFixed(0)}$
	                  </div>
	                  <div className="text-sm tabular-nums text-right">
	                    {compareVariantStats.finalCapital.toFixed(0)}$
	                  </div>
	                  <div className="text-sm tabular-nums text-right text-white/60">
	                    {formatSigned(
	                      compareVariantStats.finalCapital - combosHistoryStats.finalCapital,
	                      0,
	                      "$"
	                    )}
	                  </div>

                  <div className="text-sm text-white/70">Cote moyenne</div>
                  <div className="text-sm tabular-nums text-right">
                    {combosHistoryStats.avgOdd.toFixed(2)}
	                  </div>
	                  <div className="text-sm tabular-nums text-right">
	                    {compareVariantStats.avgOdd.toFixed(2)}
	                  </div>
	                  <div className="text-sm tabular-nums text-right text-white/60">
	                    {formatSigned(
	                      compareVariantStats.avgOdd - combosHistoryStats.avgOdd,
	                      2
	                    )}
	                  </div>

                  <div className="text-sm text-white/70">Matchs (legs)</div>
	                  <div className="text-sm tabular-nums text-right">{combosHistoryStats.totalLegs}</div>
	                  <div className="text-sm tabular-nums text-right">
	                    {compareVariantStats.totalLegs}
	                  </div>
	                  <div className="text-sm tabular-nums text-right text-white/60">
	                    {formatSigned(
	                      compareVariantStats.totalLegs - combosHistoryStats.totalLegs,
	                      0
	                    )}
	                  </div>

                  <div className="text-sm text-white/70">Drawdown max (%)</div>
                  <div className="text-sm tabular-nums text-right text-rose-300">
                    -{combosHistoryStats.maxDrawdownPct.toFixed(1)}%
	                  </div>
	                  <div className="text-sm tabular-nums text-right text-rose-300">
	                    -{compareVariantStats.maxDrawdownPct.toFixed(1)}%
	                  </div>
	                  <div className="text-sm tabular-nums text-right text-white/60">
	                    {formatSigned(
	                      compareVariantStats.maxDrawdownPct - combosHistoryStats.maxDrawdownPct,
	                      1,
	                      "%"
	                    )}
	                  </div>

                  <div className="text-sm text-white/70">Drawdown max ($)</div>
                  <div className="text-sm tabular-nums text-right text-rose-300">
                    -{combosHistoryStats.maxDrawdownValue.toFixed(0)}$
	                  </div>
	                  <div className="text-sm tabular-nums text-right text-rose-300">
	                    -{compareVariantStats.maxDrawdownValue.toFixed(0)}$
	                  </div>
	                  <div className="text-sm tabular-nums text-right text-white/60">
	                    {formatSigned(
	                      compareVariantStats.maxDrawdownValue - combosHistoryStats.maxDrawdownValue,
	                      0,
	                      "$"
	                    )}
	                  </div>
                </div>
              </div>

              <div className="mt-3 text-xs text-white/50">
                Même sélection stable (seed par snapshot) • mêmes règles bookmaker/blacklist
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-3">
                <CompactComboStatCard
                  label="Total combinés"
                  value={combosHistoryStats.total}
                  sub={
                    <>
                      <span className="text-emerald-300">{combosHistoryStats.hits} hit</span>
                      <span className="text-white/40"> • </span>
                      <span className="text-rose-300">{combosHistoryStats.misses} miss</span>
                      <span className="text-white/40"> • </span>
                      {combosHistoryStats.hitRate.toFixed(1)}%
                    </>
                  }
                />
                <CompactComboStatCard
                  label="Bénéfice"
                  value={
                    <span className="inline-flex items-baseline gap-2">
                      <span>{formatSigned(combosHistoryStats.profit, 0, "$")}</span>
                      <span className="text-sm text-white/60">
                        ({formatSigned(combosHistoryStats.roiPct, 1, "%")})
                      </span>
                    </span>
                  }
                  valueClassName={
                    combosHistoryStats.profit >= 0 ? "text-emerald-200" : "text-rose-300"
                  }
                  sub={`Capital final: ${combosHistoryStats.finalCapital.toFixed(0)}$`}
                />
                <CompactComboStatCard
                  label="ROI combinés"
                  value={`${combosHistoryStats.roiPct.toFixed(1)}%`}
                  valueClassName={
                    combosHistoryStats.roiPct >= 0 ? "text-emerald-200" : "text-rose-300"
                  }
                  sub={`Base ${BASE_BANKROLL}$ • Mise ${COMBOS_STAKE}$`}
                />
                <CompactComboStatCard
                  label="Cote moyenne"
                  value={combosHistoryStats.avgOdd.toFixed(2)}
                />
                <CompactComboStatCard
                  label="Matchs (combinés)"
                  value={combosHistoryStats.totalLegs}
                  sub={`Uniques: ${combosHistoryStats.uniqueFixtures} • Moy: ${combosHistoryStats.avgLegsPerCombo.toFixed(2)}`}
                />
                <CompactComboStatCard
                  label="Ratio Jaune / Rose"
                  value={`${combosHistoryStats.yellowLegsPct.toFixed(0)}% / ${combosHistoryStats.roseLegsPct.toFixed(0)}%`}
                  sub={`Jaune: ${combosHistoryStats.yellowLegs} • Rose: ${combosHistoryStats.roseLegs}`}
                />
                <CompactComboStatCard
                  label="Matchs (snapshots)"
                  value={combosHistorySnapshotsStats.totalCandidates}
                  sub={`Snapshots: ${combosHistorySnapshotsStats.snapshots} • Uniques: ${combosHistorySnapshotsStats.uniqueFixtures}`}
                />
                <CompactComboStatCard
                  label="Drawdown max"
                  value={`-${combosHistoryStats.maxDrawdownPct.toFixed(1)}%`}
                  valueClassName="text-rose-300"
                  sub={`-${combosHistoryStats.maxDrawdownValue.toFixed(0)}$`}
                />
                <CompactComboStatCard
                  label={`Sim. doubles ≥ ${MIN_COMBO_ODDS.toFixed(2)}`}
                  className="col-span-2 md:col-span-3 xl:col-span-2"
                  value={
                    <>
                      <span className="text-emerald-300">{combosHistoryAllStats.hits}</span>
                      <span className="text-white/45"> / </span>
                      <span className="text-rose-300">{combosHistoryAllStats.misses}</span>
                    </>
                  }
                  sub={`Résolus: ${combosHistoryAllStats.resolved} / ${combosHistoryAllStats.total} • ${combosHistoryAllStats.hitRate.toFixed(1)}%`}
                  sub2={
                    <>
                      Cote moy: {combosHistoryAllStats.avgOdd.toFixed(2)} • ROI:{" "}
                      <span
                        className={
                          combosHistoryAllStats.roiPct >= 0 ? "text-emerald-200" : "text-rose-200"
                        }
                      >
                        {combosHistoryAllStats.roiPct.toFixed(1)}%
                      </span>
                    </>
                  }
                />
              </div>

              {combosHistoryStats.points.length ? (
                <PicksChart
                  points={combosHistoryStats.points}
                  label="Évolution capital (Combinés)"
                  subLabel={`(${BASE_BANKROLL}$ base • ${COMBOS_STAKE}$ / mise)`}
                />
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white/70 text-sm">
                  Pas assez de combinés résolus pour la courbe.
                </div>
              )}

              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-white/70">Sélection combinés (historique)</div>
                  <button
                    type="button"
                    onClick={() => setShowComboHistoryDebug((prev) => !prev)}
                    className="px-3 py-1 rounded-lg text-xs bg-white/10 text-white/70 hover:bg-white/20"
                  >
                    {showComboHistoryDebug ? "Masquer debug" : "Afficher debug"}
                  </button>
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
                            {showComboHistoryDebug ? (
                              <div className="pt-1 space-y-0.5 text-[10px] text-white/45 font-mono break-all">
                                {(() => {
                                  const snapshot = combo.snapshotDate ?? "N/A";
                                  const seed = `history|${snapshot}|${combo.legs.length}`;
                                  const key = comboKey(combo);
                                  const score = comboScore(combo, seed);
                                  return (
                                    <>
                                      <div>seed: {seed}</div>
                                      <div>comboKey: {key}</div>
                                      <div>score: {score}</div>
                                    </>
                                  );
                                })()}
                              </div>
                            ) : null}
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
          )}

        </>
      ) : null}

      {view === "singles" ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div
            className={`flex items-center justify-between ${
              showLatestPicks ? "mb-3" : ""
            }`}
          >
            <div className="text-sm font-semibold">Derniers picks</div>
            <button
              type="button"
              onClick={() => setShowLatestPicks((prev) => !prev)}
              className="px-3 py-1 rounded-lg text-xs bg-white/10 text-white/70 hover:bg-white/20"
            >
              {showLatestPicks ? "Réduire" : "Dérouler"}
            </button>
          </div>
          {showLatestPicks ? (
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
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
