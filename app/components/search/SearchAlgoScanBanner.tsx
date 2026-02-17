"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  clearSearchBgScanCancel,
  readSearchBgScanState,
  requestSearchBgScanCancel,
  SEARCH_BG_SCAN_EVENT,
  writeSearchBgScanState,
  type SearchBgScanState,
} from "@/lib/searchAlgoScanBackground";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export default function SearchAlgoScanBanner() {
  const [state, setState] = useState<SearchBgScanState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const refresh = () => setState(readSearchBgScanState());
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (event.key.includes("winagain:search-algo:bg-scan")) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(SEARCH_BG_SCAN_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SEARCH_BG_SCAN_EVENT, refresh);
    };
  }, []);

  useEffect(() => {
    if (!state || state.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state?.scanId, state?.status]);

  const computed = useMemo(() => {
    if (!state) return null;
    const startedAtMs = Number.isFinite(new Date(state.startedAt).getTime())
      ? new Date(state.startedAt).getTime()
      : now;
    const updatedAtMs = Number.isFinite(new Date(state.updatedAt).getTime())
      ? new Date(state.updatedAt).getTime()
      : now;
    const seconds = Math.max(0, (now - startedAtMs) / 1000);
    const isStale =
      state.status === "running" && now - updatedAtMs > 120_000; // No heartbeat for 2 minutes
    return { seconds, isStale };
  }, [state, now]);

  if (!state || !computed) return null;

  const progress = clamp(Number(state.progress ?? 0), 0, 100);
  const labelTarget = state.target === "today" ? "Aujourd'hui" : "Demain";
  const isRunning = state.status === "running";
  const isDone = state.status === "done";
  const isError = state.status === "error";

  const title = isRunning
    ? `Recherche (Search - Algo) en cours • ${labelTarget}`
    : isDone
      ? `Recherche terminée • ${labelTarget}`
      : `Recherche en erreur • ${labelTarget}`;

  const badgeClass = isRunning
    ? "bg-emerald-500/15 text-emerald-200 border-emerald-400/30"
    : isDone
      ? "bg-sky-500/15 text-sky-200 border-sky-400/30"
      : "bg-red-500/15 text-red-200 border-red-400/30";

  const accentBarClass = isRunning
    ? "from-emerald-400 via-lime-400 to-amber-400"
    : isDone
      ? "from-sky-400 via-indigo-400 to-fuchsia-400"
      : "from-red-400 via-orange-400 to-amber-400";

  const isAnalysisMessage =
    typeof state.message === "string" && /match\(s\) analysé\(s\)/i.test(state.message);
  const subtitle =
    !isAnalysisMessage && state.message
      ? state.message
      : isRunning
        ? "Scan en cours..."
        : null;

  const canCancel = isRunning && !computed.isStale;

  return (
    <div className="sticky top-14 z-40 mb-4">
      <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-xl px-4 py-3 shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badgeClass}`}
              >
                {isRunning ? "RUNNING" : isDone ? "DONE" : "ERROR"}
              </span>
              <div className="min-w-0 truncate text-xs font-semibold text-white">
                {title}
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/70">
              <span className="tabular-nums">Temps {formatDuration(computed.seconds)}</span>
              <span className="text-white/30">•</span>
              <span className="tabular-nums">{progress.toFixed(0)}%</span>
              {state.analysisTotal != null ? (
                <>
                  <span className="text-white/30">•</span>
                  <span className="tabular-nums">
                    {state.analysisProcessed ?? 0}/{state.analysisTotal} matchs analysés
                  </span>
                </>
              ) : null}
              {state.rowsCount != null && !isRunning ? (
                <>
                  <span className="text-white/30">•</span>
                  <span className="tabular-nums">{state.rowsCount} pick(s)</span>
                </>
              ) : null}
              {subtitle ? (
                <>
                  <span className="text-white/30">•</span>
                  <span className="truncate">{subtitle}</span>
                </>
              ) : null}
            </div>

            <div className="mt-2 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${accentBarClass} transition-[width] duration-300`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-2 sm:flex-col sm:items-stretch">
            {canCancel ? (
              <button
                type="button"
                onClick={() => requestSearchBgScanCancel(state.scanId)}
                className="rounded-lg border border-red-400/40 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-100 transition hover:bg-red-500/25 text-center"
              >
                Annuler
              </button>
            ) : null}

            {isRunning ? (
              <Link
                href="/search"
                className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/15 text-center"
              >
                Ouvrir
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  clearSearchBgScanCancel(state.scanId);
                  writeSearchBgScanState(null);
                }}
                className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/15 text-center"
              >
                Fermer
              </button>
            )}

            {computed.isStale ? (
              <button
                type="button"
                onClick={() => {
                  clearSearchBgScanCancel(state.scanId);
                  writeSearchBgScanState(null);
                }}
                className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/15 text-center"
              >
                Reset
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
