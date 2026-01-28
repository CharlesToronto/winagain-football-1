"use client";

import { useEffect, useMemo, useState } from "react";
import { getLeagueFixturesBySeason } from "@/lib/queries/fixtures";
import { useTeamAlgoSettings } from "@/app/components/algo/useTeamAlgoSettings";
import Card from "@/app/components/ui/Card";
import {
  AlgoSettings,
  type MarketLine,
  normalizeAlgoSettings,
  parseLineList,
  parseNumberList,
} from "@/lib/analysisEngine/overUnderModel";
import {
  computeBacktest,
  type BacktestFixture,
} from "@/lib/analysisEngine/overUnderBacktest";
import { logAlgoEvent } from "@/lib/adapters/algoEvents";

const DEFAULT_ROWS = 3;
const LINE_OPTIONS: MarketLine[] = [1.5, 2.5, 3.5, 4.5, "1X", "X2", "12"];

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

type ComparatorRow = {
  id: string;
  expanded: boolean;
  windowSize: number;
  bucketSize: number;
  minMatches: number;
  minLeagueMatches: number;
  threshold: number;
  weightsInput: string;
  linesInput: string;
  result?: ResultStats;
  running?: boolean;
};

type AlgoComparatorProps = {
  teamId: number | null;
  leagueId: number | null;
  currentSeason: number;
  onClose?: () => void;
};

function createRow(settings: AlgoSettings, index: number): ComparatorRow {
  return {
    id: `row-${index}`,
    expanded: index === 0,
    windowSize: settings.windowSize,
    bucketSize: settings.bucketSize,
    minMatches: settings.minMatches,
    minLeagueMatches: settings.minLeagueMatches,
    threshold: settings.threshold,
    weightsInput: settings.weights.join(", "),
    linesInput: settings.lines.join(", "),
    result: undefined,
    running: false,
  };
}

function normalizeRow(row: ComparatorRow): AlgoSettings {
  return normalizeAlgoSettings({
    windowSize: row.windowSize,
    bucketSize: row.bucketSize,
    minMatches: row.minMatches,
    minLeagueMatches: row.minLeagueMatches,
    threshold: row.threshold,
    weights: parseNumberList(row.weightsInput),
    lines: parseLineList(row.linesInput),
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

export default function AlgoComparator({
  teamId,
  leagueId,
  currentSeason,
  onClose,
}: AlgoComparatorProps) {
  const { settings, updateGlobalSettings, saveTeamSettings } = useTeamAlgoSettings(teamId);
  const [seasonMode, setSeasonMode] = useState<SeasonMode>("current");
  const [fixturesBySeason, setFixturesBySeason] = useState<Record<number, BacktestFixture[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ComparatorRow[]>([]);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!rows.length) {
      setRows(Array.from({ length: DEFAULT_ROWS }, (_, idx) => createRow(settings, idx)));
    }
  }, [rows.length, settings]);

  const seasons = useMemo(() => {
    if (seasonMode === "both") return [currentSeason, currentSeason - 1];
    if (seasonMode === "previous") return [currentSeason - 1];
    return [currentSeason];
  }, [seasonMode, currentSeason]);

  const fixtures = useMemo(() => {
    return seasons.flatMap((season) => fixturesBySeason[season] ?? []);
  }, [seasons, fixturesBySeason]);

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
      .then((results) => {
        if (!active) return;
        setFixturesBySeason((prev) => {
          const next = { ...prev };
          results.forEach((res) => {
            next[res.season] = res.data;
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

  const handleRowUpdate = (id: string, patch: Partial<ComparatorRow>) => {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  };

  const toggleLine = (rowId: string, line: MarketLine) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        const selected = new Set(
          parseLineList(row.linesInput).map((value) => lineKey(value))
        );
        const key = lineKey(line);
        if (selected.has(key)) {
          selected.delete(key);
          if (selected.size === 0) {
            selected.add(key);
          }
        } else {
          selected.add(key);
        }
        const ordered = LINE_OPTIONS.filter((option) => selected.has(lineKey(option)));
        const nextInput = ordered.map((option) => lineKey(option)).join(", ");
        return { ...row, linesInput: nextInput };
      })
    );
  };

  const runRow = (rowId: string) => {
    if (!fixtures.length || !teamId) return;
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, running: true } : row
      )
    );

    setTimeout(() => {
      let computedStats: ResultStats | null = null;
      let computedSettings: AlgoSettings | null = null;
      setRows((prev) =>
        prev.map((row) => {
          if (row.id !== rowId) return row;
          const normalized = normalizeRow(row);
          const stats = computeStats(fixtures, teamId, normalized);
          computedStats = stats;
          computedSettings = normalized;
          return { ...row, running: false, result: stats };
        })
      );
      if (computedStats && computedSettings) {
        void logAlgoEvent({
          eventType: "run_comparator",
          teamId,
          leagueId,
          payload: {
            rowId,
            seasonMode,
            settings: computedSettings,
            stats: computedStats,
          },
        });
      }
    }, 0);
  };

  const runAll = () => {
    if (!fixtures.length || !teamId) return;
    setRows((prev) => prev.map((row) => ({ ...row, running: true })));

    setTimeout(() => {
      const computedResults: Array<{
        rowId: string;
        settings: AlgoSettings;
        stats: ResultStats;
      }> = [];
      setRows((prev) =>
        prev.map((row) => {
          const normalized = normalizeRow(row);
          const stats = computeStats(fixtures, teamId, normalized);
          computedResults.push({ rowId: row.id, settings: normalized, stats });
          return { ...row, running: false, result: stats };
        })
      );
      void logAlgoEvent({
        eventType: "run_comparator_all",
        teamId,
        leagueId,
        payload: { seasonMode, results: computedResults },
      });
    }, 0);
  };

  const applyRow = (row: ComparatorRow) => {
    const normalized = normalizeRow(row);
    updateGlobalSettings(normalized);
    void logAlgoEvent({
      eventType: "save_global",
      teamId,
      leagueId,
      payload: { source: "comparator", settings: normalized },
    });
  };

  const applyRowTeam = (row: ComparatorRow) => {
    const normalized = normalizeRow(row);
    saveTeamSettings(normalized);
    void logAlgoEvent({
      eventType: "save_team",
      teamId,
      leagueId,
      payload: { source: "comparator", settings: normalized },
    });
  };

  const triggerSaved = (key: string) => {
    setSavedKey(key);
    window.setTimeout(() => {
      setSavedKey((prev) => (prev === key ? null : prev));
    }, 700);
  };

  if (!leagueId) {
    return (
      <Card className="bg-white/10 border-white/10 text-white">
        <p className="text-sm text-white/70">Sélectionne une équipe avec ligue valide.</p>
      </Card>
    );
  }

  return (
    <div className="rounded-xl p-5 text-white bg-transparent border border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold">Tests rapides (team only)</h2>
        </div>
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
          <select
            className="rounded bg-[#1f0f3a] border border-white/20 px-2 py-1 text-sm text-white [color-scheme:dark]"
            value={seasonMode}
            onChange={(e) => setSeasonMode(e.target.value as SeasonMode)}
          >
            <option value="current">Season {currentSeason}</option>
            <option value="previous">Season {currentSeason - 1}</option>
            <option value="both">Season {currentSeason - 1} + {currentSeason}</option>
          </select>
          <button
            type="button"
            onClick={runAll}
            className="px-3 py-1 rounded-lg text-sm bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white transition hover:from-green-400 hover:via-emerald-400 hover:to-lime-400"
          >
            Run all
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-white/70">Chargement des fixtures...</p>
      ) : error ? (
        <p className="text-sm text-red-200">{error}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => {
            const summary = row.result;
            const hitRateLabel = summary ? `${(summary.hitRate * 100).toFixed(1)}%` : "-";
            const coverageLabel = summary ? `${(summary.coverage * 100).toFixed(1)}%` : "-";
            const picksLabel = summary ? `${summary.hits}/${summary.picks}` : "-";

            return (
              <div
                key={row.id}
                className="border border-white/10 rounded-lg bg-white/5"
              >
                <button
                  type="button"
                  onClick={() => handleRowUpdate(row.id, { expanded: !row.expanded })}
                  className="w-full flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-left"
                >
                  {row.expanded ? (
                    <>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-white/60">Test {index + 1}</span>
                        <span className="text-white/80">thr {row.threshold.toFixed(2)}</span>
                        <span className="text-white/60">win {row.windowSize}</span>
                        <span className="text-white/60">bucket {row.bucketSize}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-white/60">
                          Hit{" "}
                          <span className={summary ? "text-blue-300 font-semibold" : "text-white/60"}>
                            {hitRateLabel}
                          </span>
                        </span>
                        <span className="text-white/60">
                          Cov{" "}
                          <span className={summary ? "text-blue-300 font-semibold" : "text-white/60"}>
                            {coverageLabel}
                          </span>
                        </span>
                        <span className="text-white/60">
                          Picks{" "}
                          <span className={summary ? "text-blue-300 font-semibold" : "text-white/60"}>
                            {picksLabel}
                          </span>
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-white/80">Test {index + 1}</div>
                  )}
                </button>

                {row.expanded ? (
                  <div className="border-t border-white/10 px-3 py-3 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-[90px_90px_90px_110px_130px_minmax(0,1fr)] gap-2">
                      <div className="flex flex-col gap-1">
                        <label
                          className="text-xs text-white/70"
                          title="Window = nombre de matchs récents utilisés pour calculer la proba. Les picks, eux, sont comptés sur tous les matchs évalués de la période."
                        >
                          Window
                        </label>
                        <input
                          type="number"
                          min={5}
                          max={60}
                          className="h-7 w-full rounded bg-[#1f0f3a] border border-white/20 px-2 py-0.5 text-xs text-white"
                          value={row.windowSize}
                          title="Window = nombre de matchs récents utilisés pour calculer la proba. Les picks, eux, sont comptés sur tous les matchs évalués de la période."
                          onChange={(e) =>
                            handleRowUpdate(row.id, { windowSize: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-white/70">Bucket</label>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          className="h-7 w-full rounded bg-[#1f0f3a] border border-white/20 px-2 py-0.5 text-xs text-white"
                          value={row.bucketSize}
                          onChange={(e) =>
                            handleRowUpdate(row.id, { bucketSize: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-white/70">Seuil</label>
                        <input
                          type="number"
                          step="0.01"
                          min={0.5}
                          max={0.95}
                          className="h-7 w-full rounded bg-[#1f0f3a] border border-white/20 px-2 py-0.5 text-xs text-white"
                          value={row.threshold}
                          onChange={(e) =>
                            handleRowUpdate(row.id, { threshold: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-white/70">Min team matches</label>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          className="h-7 w-full rounded bg-[#1f0f3a] border border-white/20 px-2 py-0.5 text-xs text-white"
                          value={row.minMatches}
                          onChange={(e) =>
                            handleRowUpdate(row.id, { minMatches: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-white/70">Min league matches</label>
                        <input
                          type="number"
                          min={1}
                          max={200}
                          className="h-7 w-full rounded bg-[#1f0f3a] border border-white/20 px-2 py-0.5 text-xs text-white"
                          value={row.minLeagueMatches}
                          onChange={(e) =>
                            handleRowUpdate(row.id, {
                              minLeagueMatches: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-white/70">Lines</label>
                        <div className="flex flex-wrap md:flex-nowrap items-center gap-2">
                          {LINE_OPTIONS.map((line) => {
                            const key = lineKey(line);
                            const selected = parseLineList(row.linesInput).some(
                              (value) => lineKey(value) === key
                            );
                            return (
                              <label
                                key={`line-${row.id}-${key}`}
                                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] cursor-pointer ${
                                  selected
                                    ? "border-pink-400/60 bg-pink-500/20 text-pink-200"
                                    : "border-white/10 text-white/60"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="accent-pink-500"
                                  checked={selected}
                                  onChange={() => toggleLine(row.id, line)}
                                />
                                <span>{key}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-white/70">Weights (recent → old)</label>
                      <input
                        type="text"
                        className="h-7 rounded bg-[#1f0f3a] border border-white/20 px-2 py-0.5 text-xs text-white"
                        value={row.weightsInput}
                        onChange={(e) =>
                          handleRowUpdate(row.id, { weightsInput: e.target.value })
                        }
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full justify-start">
                      <button
                        type="button"
                        onClick={() => runRow(row.id)}
                        className="px-3 py-1 rounded-lg text-sm bg-blue-500 text-white"
                      >
                        {row.running ? "Running..." : "Run"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          applyRow(row);
                          triggerSaved(`global-${row.id}`);
                        }}
                        className={`px-3 py-1 rounded-lg text-sm border border-white/60 text-white/80 bg-transparent transition hover:border-orange-400 hover:bg-orange-500/20 hover:text-white active:scale-95 ${
                          savedKey === `global-${row.id}`
                            ? "ring-2 ring-orange-400/60 animate-pulse border-orange-400 text-orange-200"
                            : ""
                        }`}
                      >
                        Save as global
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          applyRowTeam(row);
                          triggerSaved(`team-${row.id}`);
                        }}
                        className={`px-3 py-1 rounded-lg text-sm border border-white/60 text-white/80 bg-transparent transition hover:border-orange-400 hover:bg-orange-500/20 hover:text-white active:scale-95 ${
                          savedKey === `team-${row.id}`
                            ? "ring-2 ring-orange-400/60 animate-pulse border-orange-400 text-orange-200"
                            : ""
                        }`}
                      >
                        Save as team
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
