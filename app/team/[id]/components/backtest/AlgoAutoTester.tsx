"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Card from "@/app/components/ui/Card";
import { getLeagueFixturesBySeason } from "@/lib/queries/fixtures";
import { useTeamAlgoSettings } from "@/app/components/algo/useTeamAlgoSettings";
import {
  AlgoSettings,
  type MarketLine,
  normalizeAlgoSettings,
} from "@/lib/analysisEngine/overUnderModel";
import {
  computeBacktest,
  type BacktestFixture,
} from "@/lib/analysisEngine/overUnderBacktest";
import { logAlgoEvent } from "@/lib/adapters/algoEvents";
import CharlyLottie from "../CharlyLottie";

const WINDOWS = [10, 15, 20, 25, 30];
const BUCKETS = [3, 5];
const THRESHOLDS = [0.55, 0.6, 0.65, 0.7, 0.75];
const MIN_MATCHES = [5, 7, 10];
const MIN_LEAGUE_MATCHES = [5, 10, 15];
const LINE_OPTIONS: MarketLine[] = [1.5, 2.5, 3.5, 4.5, "1X", "X2", "12"];
const LINE_SETS: MarketLine[][] = [
  [1.5, 2.5, 3.5],
  [2.5, 3.5, 4.5],
  [1.5, 2.5],
  ["1X", "X2", "12"],
  [1.5, "1X", "X2"],
  [2.5, "1X", "X2"],
];

function lineKey(line: MarketLine) {
  return typeof line === "number" ? line.toString() : line;
}

type SeasonMode = "current" | "previous" | "both";

type ResultStats = {
  picks: number;
  hits: number;
  hitRate: number;
  coverage: number;
  evaluated: number;
};

type AutoTestRow = {
  id: string;
  settings: AlgoSettings;
  stats: ResultStats;
};

function createWeightProfile(buckets: number, mode: "soft" | "medium" | "hard") {
  const minValue = mode === "soft" ? 0.7 : mode === "medium" ? 0.5 : 0.3;
  if (buckets <= 1) return [1];
  const step = (1 - minValue) / (buckets - 1);
  return Array.from({ length: buckets }, (_, idx) => {
    const value = 1 - idx * step;
    return Math.round(value * 100) / 100;
  });
}

function computeStats(
  fixtures: BacktestFixture[],
  teamId: number | null,
  settings: AlgoSettings
): ResultStats {
  const result = computeBacktest(fixtures, teamId, settings);
  const allPicks = result.picks;
  const filtered = allPicks.filter((pick) => pick.probability >= settings.threshold);
  const hits = filtered.filter((pick) => pick.hit).length;
  const picks = filtered.length;
  const hitRate = picks ? hits / picks : 0;
  const coverage = allPicks.length ? picks / allPicks.length : 0;
  return {
    picks,
    hits,
    hitRate,
    coverage,
    evaluated: allPicks.length,
  };
}

function buildCandidateSettings(count: number, lineSets: MarketLine[][]) {
  const combos: AlgoSettings[] = [];
  const weightModes: Array<"soft" | "medium" | "hard"> = ["soft", "medium", "hard"];

  for (const windowSize of WINDOWS) {
    for (const bucketSize of BUCKETS) {
      for (const threshold of THRESHOLDS) {
        for (const minMatches of MIN_MATCHES) {
          for (const minLeagueMatches of MIN_LEAGUE_MATCHES) {
            for (const lines of lineSets) {
              for (const mode of weightModes) {
                const buckets = Math.max(1, Math.ceil(windowSize / bucketSize));
                const weights = createWeightProfile(buckets, mode);
                combos.push(
                  normalizeAlgoSettings({
                    windowSize,
                    bucketSize,
                    threshold,
                    minMatches,
                    minLeagueMatches,
                    weights,
                    lines,
                  })
                );
              }
            }
          }
        }
      }
    }
  }

  // Shuffle combos for variety
  for (let i = combos.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [combos[i], combos[j]] = [combos[j], combos[i]];
  }

  return combos.slice(0, count);
}

function buildAllSettings(lineSets: MarketLine[][]) {
  const combos: AlgoSettings[] = [];
  const weightModes: Array<"soft" | "medium" | "hard"> = ["soft", "medium", "hard"];

  for (const windowSize of WINDOWS) {
    for (const bucketSize of BUCKETS) {
      for (const threshold of THRESHOLDS) {
        for (const minMatches of MIN_MATCHES) {
          for (const minLeagueMatches of MIN_LEAGUE_MATCHES) {
            for (const lines of lineSets) {
              for (const mode of weightModes) {
                const buckets = Math.max(1, Math.ceil(windowSize / bucketSize));
                const weights = createWeightProfile(buckets, mode);
                combos.push(
                  normalizeAlgoSettings({
                    windowSize,
                    bucketSize,
                    threshold,
                    minMatches,
                    minLeagueMatches,
                    weights,
                    lines,
                  })
                );
              }
            }
          }
        }
      }
    }
  }

  return combos;
}

export default function AlgoAutoTester({
  teamId,
  leagueId,
  currentSeason,
  onClose,
}: {
  teamId: number | null;
  leagueId: number | null;
  currentSeason: number;
  onClose?: () => void;
}) {
  const { updateGlobalSettings, saveTeamSettings } = useTeamAlgoSettings(teamId);
  const [seasonMode, setSeasonMode] = useState<SeasonMode>("current");
  const [testsCount, setTestsCount] = useState(30);
  const [resultLimit, setResultLimit] = useState(20);
  const [minCoverage, setMinCoverage] = useState(0.4);
  const [selectedLines, setSelectedLines] = useState<Set<string>>(
    new Set(LINE_OPTIONS.map((line) => lineKey(line)))
  );
  const [fixturesBySeason, setFixturesBySeason] = useState<Record<number, BacktestFixture[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AutoTestRow[]>([]);
  const [running, setRunning] = useState(false);
  const [runningMode, setRunningMode] = useState<"auto" | "full" | null>(null);
  const [lastRunMode, setLastRunMode] = useState<"auto" | "full" | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [typingText, setTypingText] = useState("");
  const [analysisText, setAnalysisText] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [runSummary, setRunSummary] = useState<{
    calcCount: number;
    lineVariants: number;
    weightVariants: number;
    mode: "auto" | "full";
  } | null>(null);
  const [overlayActive, setOverlayActive] = useState(false);
  const [overlayCountdown, setOverlayCountdown] = useState(0);
  const [overlayCount, setOverlayCount] = useState(0);
  const overlayTimerRef = useRef<number | null>(null);

  const seasons = useMemo(() => {
    if (seasonMode === "both") return [currentSeason, currentSeason - 1];
    if (seasonMode === "previous") return [currentSeason - 1];
    return [currentSeason];
  }, [seasonMode, currentSeason]);

  const fixtures = useMemo(() => {
    return seasons.flatMap((season) => fixturesBySeason[season] ?? []);
  }, [seasons, fixturesBySeason]);

  const selectedLineList = useMemo(() => {
    return LINE_OPTIONS.filter((line) => selectedLines.has(lineKey(line)));
  }, [selectedLines]);

  const availableLineSets = useMemo(() => {
    const filtered = LINE_SETS.filter((set) =>
      set.every((line) => selectedLines.has(lineKey(line)))
    );
    if (filtered.length) return filtered;
    return selectedLineList.length ? [selectedLineList] : [];
  }, [selectedLines, selectedLineList]);

  useEffect(() => {
    if (!leagueId) return;
    const toFetch = seasons.filter((season) => !fixturesBySeason[season]);
    if (!toFetch.length) return;
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all(
      toFetch.map(async (season) => {
        const data = await getLeagueFixturesBySeason(leagueId, season);
        return { season, data: Array.isArray(data) ? (data as BacktestFixture[]) : [] };
      })
    )
      .then((data) => {
        if (!active) return;
        setFixturesBySeason((prev) => {
          const next = { ...prev };
          data.forEach((entry) => {
            next[entry.season] = entry.data;
          });
          return next;
        });
      })
      .catch((err: any) => {
        if (!active) return;
        setError(err?.message ?? "Erreur chargement fixtures");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [leagueId, seasons, fixturesBySeason]);

  const toggleSelectedLine = (line: MarketLine) => {
    const key = lineKey(line);
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    setError(null);
  };

  const triggerSaved = (key: string) => {
    setSavedKey(key);
    window.setTimeout(() => {
      setSavedKey((prev) => (prev === key ? null : prev));
    }, 700);
  };

  const runAutoTests = () => {
    if (!fixtures.length || !teamId) return;
    const count = Math.max(20, Math.min(50, testsCount));
    if (!selectedLineList.length) {
      setError("Aucune ligne disponible. Coche au moins une ligne.");
      return;
    }
    setRunning(true);
    setRunningMode("auto");
    setLastRunMode("auto");
    setError(null);
    setResults([]);
    setResultsOpen(true);
    setRunSummary(null);
    setAnalysisText(null);
    setAnalysisError(null);

    setTimeout(() => {
      const candidates = buildCandidateSettings(count, availableLineSets);
      const computed = candidates.map((settings, index) => ({
        id: `auto-${index}`,
        settings,
        stats: computeStats(fixtures, teamId, settings),
      }));
      const filtered = computed.filter(
        (row) => row.stats.hitRate >= 0.8 && row.stats.hitRate <= 1
      );
      const sorted = filtered
        .slice()
        .sort((a, b) => {
          if (b.stats.picks !== a.stats.picks) return b.stats.picks - a.stats.picks;
          if (b.stats.hitRate !== a.stats.hitRate) return b.stats.hitRate - a.stats.hitRate;
          return b.stats.coverage - a.stats.coverage;
        })
        .slice(0, Math.max(1, resultLimit));
      setResults(sorted);
      setRunSummary({
        calcCount: computed.length,
        lineVariants: availableLineSets.length || selectedLineList.length,
        weightVariants: 3,
        mode: "auto",
      });
      setRunning(false);
      setRunningMode(null);
      void logAlgoEvent({
        eventType: "run_autotest",
        teamId,
        leagueId,
        payload: {
          seasonMode,
          minCoverage,
          lines: selectedLineList,
          results: sorted.map((row) => ({ settings: row.settings, stats: row.stats })),
          calcCount: computed.length,
        },
      });
    }, 0);
  };

  const runFullSearch = () => {
    if (!fixtures.length || !teamId) return;
    if (!selectedLineList.length) {
      setError("Aucune ligne disponible. Coche au moins une ligne.");
      return;
    }
    setRunning(true);
    setRunningMode("full");
    setLastRunMode("full");
    setError(null);
    setResults([]);
    setResultsOpen(true);
    setRunSummary(null);
    setAnalysisText(null);
    setAnalysisError(null);

    const totalCount =
      WINDOWS.length *
      BUCKETS.length *
      THRESHOLDS.length *
      MIN_MATCHES.length *
      MIN_LEAGUE_MATCHES.length *
      Math.max(1, availableLineSets.length || selectedLineList.length) *
      3;

    startOverlay(totalCount, () => {
      setTimeout(() => {
        const candidates = buildAllSettings(availableLineSets);
        const computed = candidates.map((settings, index) => ({
          id: `full-${index}`,
          settings,
          stats: computeStats(fixtures, teamId, settings),
        }));
        const filtered = computed.filter(
          (row) => row.stats.hitRate >= 0.8 && row.stats.hitRate <= 1
        );
        const sorted = filtered
          .slice()
          .sort((a, b) => {
            if (b.stats.picks !== a.stats.picks) return b.stats.picks - a.stats.picks;
            if (b.stats.hitRate !== a.stats.hitRate) return b.stats.hitRate - a.stats.hitRate;
            return b.stats.coverage - a.stats.coverage;
          })
          .slice(0, Math.max(1, resultLimit));
        setResults(sorted);
        setRunSummary({
          calcCount: computed.length,
          lineVariants: availableLineSets.length || selectedLineList.length,
          weightVariants: 3,
          mode: "full",
        });
        setRunning(false);
        setRunningMode(null);
        setOverlayActive(false);
        void logAlgoEvent({
          eventType: "run_full_search",
          teamId,
          leagueId,
          payload: {
            seasonMode,
            minCoverage,
            lines: selectedLineList,
            results: sorted.map((row) => ({ settings: row.settings, stats: row.stats })),
            calcCount: computed.length,
          },
        });
      }, 0);
    });
  };

  useEffect(() => {
    if (results.length > 0) return;
    const message = "Lance un test pour comparer les performances";
    let index = 0;
    let timeoutId: number;

    const tick = () => {
      if (index < message.length) {
        index += 1;
        setTypingText(message.slice(0, index));
        const delay = 70 + Math.random() * 90;
        timeoutId = window.setTimeout(tick, delay);
        return;
      }
      timeoutId = window.setTimeout(() => {
        index = 0;
        setTypingText("");
        timeoutId = window.setTimeout(tick, 200);
      }, 1200);
    };

    timeoutId = window.setTimeout(tick, 200);
    return () => window.clearTimeout(timeoutId);
  }, [results.length]);

  const bestResult = useMemo(() => {
    if (!results.length) return null;
    const eligible = results.filter((row) => row.stats.coverage >= minCoverage);
    const list = eligible.length ? eligible : results;
    return list
      .slice()
      .sort((a, b) => {
        if (b.stats.hitRate !== a.stats.hitRate) return b.stats.hitRate - a.stats.hitRate;
        return b.stats.coverage - a.stats.coverage;
      })[0];
  }, [results, minCoverage]);

  const sortedResults = useMemo(() => {
    return results
      .slice()
      .sort((a, b) => {
        if (b.stats.picks !== a.stats.picks) return b.stats.picks - a.stats.picks;
        if (b.stats.hitRate !== a.stats.hitRate) return b.stats.hitRate - a.stats.hitRate;
        return b.stats.coverage - a.stats.coverage;
      })
      .slice(0, Math.max(1, resultLimit));
  }, [results, resultLimit]);

  const analysisPayload = useMemo(() => {
    const serializeSettings = (settings: AlgoSettings) => ({
      windowSize: settings.windowSize,
      bucketSize: settings.bucketSize,
      threshold: settings.threshold,
      minMatches: settings.minMatches,
      minLeagueMatches: settings.minLeagueMatches,
      weights: settings.weights,
      lines: settings.lines,
    });
    const topResults = sortedResults.slice(0, Math.min(10, sortedResults.length));
    return {
      meta: {
        teamId,
        leagueId,
        seasonMode,
        seasons,
        testsCount,
        resultLimit,
        minCoverage,
        selectedLines: selectedLineList,
        source: lastRunMode ?? "auto",
        totalResults: results.length,
      },
      bestResult: bestResult
        ? { settings: serializeSettings(bestResult.settings), stats: bestResult.stats }
        : null,
      topResults: topResults.map((row) => ({
        settings: serializeSettings(row.settings),
        stats: row.stats,
      })),
    };
  }, [
    bestResult,
    leagueId,
    lastRunMode,
    minCoverage,
    resultLimit,
    results.length,
    seasonMode,
    seasons,
    selectedLineList,
    sortedResults,
    teamId,
    testsCount,
  ]);

  const handleCharlyAnalysis = async () => {
    if (!results.length || analysisLoading) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const res = await fetch("/api/ai/fullsearch-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: analysisPayload }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Analyse IA indisponible.");
      }
      setAnalysisText(json?.analysis ?? "");
    } catch (err: any) {
      setAnalysisError(err?.message ?? "Erreur analyse IA.");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const startOverlay = (targetCount: number, onDone: () => void) => {
    if (overlayTimerRef.current) {
      window.clearInterval(overlayTimerRef.current);
      overlayTimerRef.current = null;
    }
    const durationMs = 5000;
    const start = Date.now();
    setOverlayActive(true);
    setOverlayCountdown(5);
    setOverlayCount(0);
    overlayTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const progress = Math.min(1, elapsed / durationMs);
      const remaining = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
      setOverlayCountdown(remaining);
      setOverlayCount(Math.floor(progress * targetCount));
      if (progress >= 1) {
        if (overlayTimerRef.current) {
          window.clearInterval(overlayTimerRef.current);
          overlayTimerRef.current = null;
        }
        onDone();
      }
    }, 100);
  };

  useEffect(() => {
    if (!overlayActive) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [overlayActive]);

  return (
    <>
      {overlayActive ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#140b22]/90 px-6 py-6 text-center text-white shadow-2xl">
            <div className="flex items-center justify-center">
              <CharlyLottie className="w-20 h-20" />
            </div>
            <p className="mt-2 text-sm text-white/70">
              Nous effectuons des milliers de calculs, veuillez patienter…
            </p>
            <div className="mt-3 text-3xl font-semibold tracking-tight">
              {overlayCountdown}s
            </div>
            <div className="mt-2 text-xs text-white/60">
              Calculs en cours :{" "}
              <span className="text-white font-semibold tabular-nums">
                {overlayCount.toLocaleString("fr-FR")}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <Card className="bg-white/10 border-white/10 text-white">
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Algo - AutoTests</h2>
          <div className="flex flex-wrap items-center gap-2">
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="px-2 py-1 rounded-md text-xs bg-white/10 text-white/70 hover:bg-white/20"
              >
                Close
              </button>
            ) : null}
            <button
              type="button"
              onClick={runFullSearch}
              className="px-3 py-1 rounded-lg text-sm bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white transition hover:from-green-400 hover:via-emerald-400 hover:to-lime-400"
              disabled={running}
            >
              Run Full Search
            </button>
            <button
              type="button"
              onClick={handleCharlyAnalysis}
              className="px-3 py-1 rounded-lg text-sm border border-white/20 bg-white/5 text-white/80 transition hover:border-white/40 hover:bg-white/10 disabled:opacity-40"
              disabled={analysisLoading || running || results.length === 0}
            >
              {analysisLoading ? "Analyse..." : "Analyse Charly"}
            </button>
          </div>
        </div>

        <div className="flex flex-nowrap items-end gap-3 overflow-x-auto no-scrollbar sm:flex-wrap sm:overflow-visible">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-white/50">
              Saison
            </span>
            <select
              className="rounded bg-[#1f0f3a] border border-white/20 px-2 py-1 text-sm text-white [color-scheme:dark]"
              value={seasonMode}
              onChange={(e) => setSeasonMode(e.target.value as SeasonMode)}
            >
              <option value="current">Season {currentSeason}</option>
              <option value="previous">Season {currentSeason - 1}</option>
              <option value="both">Season {currentSeason - 1} + {currentSeason}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-white/50">
              Combinaisons
            </span>
            <input
              type="number"
              min={20}
              max={50}
              className="w-20 rounded bg-[#1f0f3a] border border-white/20 px-2 py-1 text-sm text-white"
              value={testsCount}
              onChange={(e) => setTestsCount(Number(e.target.value))}
              title="Nombre de combinaisons (20-50)"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-white/50">
              Top N
            </span>
            <input
              type="number"
              min={5}
              max={100}
              className="w-20 rounded bg-[#1f0f3a] border border-white/20 px-2 py-1 text-sm text-white"
              value={resultLimit}
              onChange={(e) => setResultLimit(Number(e.target.value))}
              title="Top N résultats"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-white/50">
              Coverage min
            </span>
            <input
              type="number"
              step="0.05"
              min={0}
              max={1}
              className="w-24 rounded bg-[#1f0f3a] border border-white/20 px-2 py-1 text-sm text-white"
              value={minCoverage}
              onChange={(e) => setMinCoverage(Number(e.target.value))}
              title="Coverage minimum"
            />
          </div>
        </div>

        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto no-scrollbar sm:flex-wrap sm:overflow-visible">
          <span className="text-xs text-white/60">Lines incluses</span>
          {LINE_OPTIONS.map((line) => {
            const key = lineKey(line);
            const checked = selectedLines.has(key);
            return (
              <label
                key={`exclude-${key}`}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs cursor-pointer ${
                  checked
                    ? "border-pink-400/60 bg-pink-500/20 text-pink-200"
                    : "border-white/10 text-white/60"
                }`}
              >
                <input
                  type="checkbox"
                  className="accent-pink-500"
                  checked={checked}
                  onChange={() => toggleSelectedLine(line)}
                />
                <span>{key}</span>
              </label>
            );
          })}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-white/70">Chargement fixtures...</p>
      ) : running && runningMode === "full" ? (
        <p className="text-sm text-white/70 animate-pulse">
          nous effectuons des milliers de calcules, veuillez patienter quelques seoncondes...
        </p>
      ) : error ? (
        <p className="text-sm text-red-200">{error}</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-white/70 hidden sm:block">
          {typingText}
          <span className="ml-1 inline-block animate-pulse text-white/60">|</span>
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/70">
            <div>
              {runSummary ? (
                <>
                  Calculs&nbsp;: <span className="text-white">{runSummary.calcCount}</span> •
                  Variantes&nbsp;:{" "}
                  <span className="text-white">
                    {runSummary.lineVariants} lignes × {runSummary.weightVariants} poids
                  </span>
                </>
              ) : (
                <>Résultats prêts.</>
              )}
            </div>
            <button
              type="button"
              onClick={() => setResultsOpen((prev) => !prev)}
              className="text-xs text-white/70 hover:text-white"
            >
              {resultsOpen ? "Réduire la liste" : "Dérouler la liste"}
            </button>
          </div>

          {(analysisText || analysisError || analysisLoading) && (
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className="text-xs uppercase tracking-wide text-white/60">
                  Analyse Charly
                </span>
                <button
                  type="button"
                  onClick={handleCharlyAnalysis}
                  className="text-xs text-white/70 hover:text-white"
                  disabled={analysisLoading}
                >
                  Relancer
                </button>
              </div>
              {analysisLoading ? (
                <p className="text-white/70">Charly analyse les meilleurs tests…</p>
              ) : analysisError ? (
                <p className="text-red-200">{analysisError}</p>
              ) : (
                <div className="whitespace-pre-line text-white/90">{analysisText}</div>
              )}
            </div>
          )}

          {resultsOpen ? (
            <div className="space-y-2">
              {sortedResults.map((row, index) => (
                <div
                  key={row.id}
                  className={`flex flex-col gap-2 rounded-lg border px-3 py-2 ${
                    row.stats.hitRate >= 0.85
                      ? "border-orange-400/60 bg-orange-500/10"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <div className="text-white/70">#{index + 1}</div>
                    <div className="flex flex-wrap items-center gap-2 text-white/70">
                      <span>win {row.settings.windowSize}</span>
                      <span>bucket {row.settings.bucketSize}</span>
                      <span>thr {row.settings.threshold.toFixed(2)}</span>
                      <span>lines {row.settings.lines.join("/")}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          updateGlobalSettings(row.settings);
                          triggerSaved(`row-${row.id}-global`);
                          void logAlgoEvent({
                            eventType: "save_global",
                            teamId,
                            leagueId,
                            payload: { source: "autotest", settings: row.settings },
                          });
                        }}
                        className={`px-2 py-1 rounded-md text-xs border border-white/60 text-white/80 bg-transparent transition hover:border-orange-400 hover:bg-orange-500/20 hover:text-white active:scale-95 ${
                          savedKey === `row-${row.id}-global`
                            ? "ring-2 ring-orange-400/60 animate-pulse border-orange-400 text-orange-200"
                            : ""
                        }`}
                      >
                        Save as global
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          saveTeamSettings(row.settings);
                          triggerSaved(`row-${row.id}-team`);
                          void logAlgoEvent({
                            eventType: "save_team",
                            teamId,
                            leagueId,
                            payload: { source: "autotest", settings: row.settings },
                          });
                        }}
                        className={`px-2 py-1 rounded-md text-xs border border-white/60 text-white/80 bg-transparent transition hover:border-orange-400 hover:bg-orange-500/20 hover:text-white active:scale-95 ${
                          savedKey === `row-${row.id}-team`
                            ? "ring-2 ring-orange-400/60 animate-pulse border-orange-400 text-orange-200"
                            : ""
                        }`}
                        disabled={!teamId}
                      >
                        Save as team
                      </button>
                    </div>
                    <div className="text-blue-300 font-semibold">
                      Hit {(row.stats.hitRate * 100).toFixed(1)}% • Cov {(row.stats.coverage * 100).toFixed(1)}% • {row.stats.hits}/{row.stats.picks}
                    </div>
                  </div>
                  <div className="text-xs text-white/60">
                    Weights: {row.settings.weights.join(", ")} • Min team {row.settings.minMatches} • Min league {row.settings.minLeagueMatches}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
      </Card>
    </>
  );
}
