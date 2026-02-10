"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type LogEntry = {
  id: string;
  timestamp: string;
  status: "success" | "error";
  message: string;
};

function formatDate(value: string | null) {
  if (!value) return "Jamais";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function AdminDataPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastManualCall, setLastManualCall] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [typingIndex, setTypingIndex] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [htLogs, setHtLogs] = useState<LogEntry[]>([]);
  const [htLoading, setHtLoading] = useState(false);
  const [htSeconds, setHtSeconds] = useState(0);
  const [htLastManualCall, setHtLastManualCall] = useState<string | null>(null);
  const [htTypingIndex, setHtTypingIndex] = useState(0);
  const cacheReady = useRef(false);

  const sqlTotalPicksV3 = `select count(*) as total_picks_v3
from public.daily_algo_picks_v3;`;

  const sqlResolvedPicksV3 = `select count(*) as resolved_picks_v3
from public.daily_algo_picks_v3
where status in ('hit','miss');`;

  const CACHE_KEY = "admin-data-cache-v1";
  const CACHE_TTL_MS = 10 * 24 * 60 * 60 * 1000; // 10 jours

  const targetUrl = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
    return `${base.replace(/\/$/, "")}/api/update/fixtures`;
  }, []);

  const typedLabel = useMemo(() => {
    const base = "Mise à jour...";
    if (!loading) return "Lancer la mise à jour";
    const len = typingIndex % (base.length + 1);
    return base.slice(0, len || 1);
  }, [loading, typingIndex]);

  const htTargetUrl = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
    return `${base.replace(/\/$/, "")}/api/update/fixtures-ht`;
  }, []);

  const resolvePicksUrl = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
    return `${base.replace(/\/$/, "")}/api/jobs/daily-algo?task=resolve&algo=v3`;
  }, []);

  const snapshotPicksUrl = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
    return `${base.replace(/\/$/, "")}/api/jobs/daily-algo?task=snapshot&algo=v3`;
  }, []);

  const picksUrl = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
    return `${base.replace(/\/$/, "")}/picks?algo=v3`;
  }, []);

  const htTypedLabel = useMemo(() => {
    const base = "Mise à jour HT...";
    if (!htLoading) return "Lancer la mise à jour HT";
    const len = htTypingIndex % (base.length + 1);
    return base.slice(0, len || 1);
  }, [htLoading, htTypingIndex]);

  useEffect(() => {
    if (!loading) {
      setTypingIndex(0);
      setSeconds(0);
      return;
    }

    const typing = setInterval(() => {
      setTypingIndex((prev) => prev + 1);
    }, 120);

    const timer = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);

    return () => {
      clearInterval(typing);
      clearInterval(timer);
    };
  }, [loading]);

  function formatFriendlyDate(value: string | null) {
    if (!value) return "Jamais";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const formatted = date.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    return formatted.toUpperCase();
  }

  // Charger le cache local (validité 10 jours)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) {
        cacheReady.current = true;
        return;
      }
      const parsed = JSON.parse(raw);
      const now = Date.now();
      if (parsed?.savedAt && now - parsed.savedAt > CACHE_TTL_MS) {
        localStorage.removeItem(CACHE_KEY);
        cacheReady.current = true;
        return;
      }
      if (Array.isArray(parsed?.logs)) setLogs(parsed.logs);
      if (parsed?.lastManualCall) setLastManualCall(parsed.lastManualCall);
    } catch {
      // ignore parsing errors
    } finally {
      cacheReady.current = true;
    }
  }, []);

  // Persister le cache
  useEffect(() => {
    if (!cacheReady.current) return;
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          logs,
          lastManualCall,
          savedAt: Date.now(),
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [logs, lastManualCall]);

  useEffect(() => {
    if (!htLoading) {
      setHtTypingIndex(0);
      setHtSeconds(0);
      return;
    }
    const typing = setInterval(() => setHtTypingIndex((p) => p + 1), 120);
    const timer = setInterval(() => setHtSeconds((p) => p + 1), 1000);
    return () => {
      clearInterval(typing);
      clearInterval(timer);
    };
  }, [htLoading]);

  async function triggerUpdate() {
    setLoading(true);
    const startedAt = new Date().toISOString();

    try {
      const res = await fetch(targetUrl, { method: "GET" });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }

      setLogs((prev) => [
        {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date().toISOString(),
          status: "success",
          message: `MàJ réussie (checked: ${body?.checked ?? "?"}, updated: ${
            body?.updated ?? "?"
          })`,
        },
        ...prev,
      ]);
      setLastManualCall(startedAt);
    } catch (err: any) {
      setLogs((prev) => [
        {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date().toISOString(),
          status: "error",
          message: err?.message ?? "Erreur inconnue",
        },
        ...prev,
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function triggerHtUpdate() {
    setHtLoading(true);
    const startedAt = new Date().toISOString();
    try {
      const res = await fetch(htTargetUrl, { method: "GET" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setHtLogs((prev) => [
        {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date().toISOString(),
          status: "success",
          message: `HT MàJ (checked: ${body?.checked ?? "?"}, updated: ${
            body?.updated ?? "?"
          })`,
        },
        ...prev,
      ]);
      setHtLastManualCall(startedAt);
    } catch (err: any) {
      setHtLogs((prev) => [
        {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date().toISOString(),
          status: "error",
          message: err?.message ?? "Erreur inconnue",
        },
        ...prev,
      ]);
    } finally {
      setHtLoading(false);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      // fallback below
    }
    if (typeof document === "undefined") return;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
  }

  return (
    <div className="min-h-screen w-full p-6 text-white">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <p className="text-sm opacity-70">Admin</p>
          <h1 className="text-3xl font-bold">Admin Data</h1>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          {loading && (
            <span className="text-xs px-3 py-1 rounded-full bg-white/15 border border-white/20">
              {seconds}s
            </span>
          )}
          <button
            onClick={triggerUpdate}
            disabled={loading}
            className={`px-4 py-2 rounded-md text-sm font-semibold transition min-w-[170px] text-center w-full sm:w-auto ${
              loading
                ? "bg-white/20 text-white/60 cursor-not-allowed"
                : "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white hover:from-green-400 hover:via-emerald-400 hover:to-lime-400"
            }`}
          >
            <span className="inline-block overflow-hidden whitespace-nowrap align-middle">
              {typedLabel}
            </span>
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-sm font-semibold mb-2">Procédure manuelle (simple)</p>
        <div className="text-xs text-white/70 space-y-1">
          <div>
            1) Créer les picks du jour :{" "}
            <button
              type="button"
              onClick={() => copyToClipboard(snapshotPicksUrl)}
              className="text-sky-300 hover:text-sky-200 underline break-all bg-transparent p-0 text-left"
              title="Cliquer pour copier"
            >
              {snapshotPicksUrl}
            </button>
          </div>
          <div>
            2) Après les matchs, mettre à jour les fixtures :{" "}
            <button
              type="button"
              onClick={() => copyToClipboard(targetUrl)}
              className="text-sky-300 hover:text-sky-200 underline break-all bg-transparent p-0 text-left"
              title="Cliquer pour copier"
            >
              {targetUrl}
            </button>
          </div>
          <div>
            3) Résoudre les picks :{" "}
            <button
              type="button"
              onClick={() => copyToClipboard(resolvePicksUrl)}
              className="text-sky-300 hover:text-sky-200 underline break-all bg-transparent p-0 text-left"
              title="Cliquer pour copier"
            >
              {resolvePicksUrl}
            </button>
          </div>
          <div>
            4) Voir le résultat :{" "}
            <button
              type="button"
              onClick={() => copyToClipboard(picksUrl)}
              className="text-sky-300 hover:text-sky-200 underline break-all bg-transparent p-0 text-left"
              title="Cliquer pour copier"
            >
              {picksUrl}
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <p className="text-sm font-semibold">SQL (Algo v3)</p>
            <p className="text-xs text-white/70">
              Requêtes utiles pour vérifier le volume de picks et le nombre de picks résolus.
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-semibold text-white/80">Nombre total de picks (v3)</p>
              <button
                type="button"
                onClick={() => copyToClipboard(sqlTotalPicksV3)}
                className="text-xs px-2 py-1 rounded-md border border-white/15 bg-white/10 hover:bg-white/15"
              >
                Copier
              </button>
            </div>
            <pre className="text-xs text-white/80 whitespace-pre-wrap break-words select-text font-mono">
              {sqlTotalPicksV3}
            </pre>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-semibold text-white/80">Nombre de picks résolus (v3)</p>
              <button
                type="button"
                onClick={() => copyToClipboard(sqlResolvedPicksV3)}
                className="text-xs px-2 py-1 rounded-md border border-white/15 bg-white/10 hover:bg-white/15"
              >
                Copier
              </button>
            </div>
            <pre className="text-xs text-white/80 whitespace-pre-wrap break-words select-text font-mono">
              {sqlResolvedPicksV3}
            </pre>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="bg-white/10 border border-white/10 rounded-lg p-4">
          <p className="text-sm opacity-70 mb-1">Endpoint appelé</p>
          <p className="text-xs break-all text-white/80">{targetUrl}</p>
        </div>

        <div className="bg-white/10 border border-white/10 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Logs</h2>
            <span className="text-xs opacity-60">{logs.length} entrée(s)</span>
          </div>
          {logs.length === 0 ? (
            <p className="text-sm opacity-70">Aucun log pour l’instant.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 rounded-md px-3 py-2 ${
                    log.status === "success" ? "bg-green-500/10 border border-green-500/20" : "bg-red-500/10 border border-red-500/20"
                  }`}
                >
                  <div className="text-xs opacity-60 min-w-0 sm:min-w-[110px]">{formatDate(log.timestamp)}</div>
                  <div className="text-sm">
                    <span
                      className={`mr-2 text-[11px] px-2 py-0.5 rounded-full uppercase ${
                        log.status === "success" ? "bg-green-500/20 text-green-200" : "bg-red-500/20 text-red-200"
                      }`}
                    >
                      {log.status}
                    </span>
                    {log.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-lg p-4 hidden">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold">Mise à jour HT (goals_home_ht / goals_away_ht)</h3>
              <p className="text-xs text-white/70">Saisons 2024 et 2025</p>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              {htLoading && (
                <span className="text-xs px-3 py-1 rounded-full bg-white/15 border border-white/20">
                  {htSeconds}s
                </span>
              )}
              <button
                onClick={triggerHtUpdate}
                disabled={htLoading}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition min-w-[200px] text-center w-full sm:w-auto ${
                  htLoading
                    ? "bg-white/20 text-white/60 cursor-not-allowed"
                    : "bg-orange-500 hover:bg-orange-400"
                }`}
              >
                <span className="inline-block overflow-hidden whitespace-nowrap align-middle">
                  {htTypedLabel}
                </span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div className="bg-white/10 border border-white/10 rounded-lg p-3">
              <p className="text-sm opacity-70 mb-1">Endpoint HT</p>
              <p className="text-xs break-all text-white/80">{htTargetUrl}</p>
            </div>
            <div className="bg-white/10 border border-white/10 rounded-lg p-3">
              <p className="text-sm opacity-70 mb-1">Dernier appel manuel</p>
              <p className="text-lg font-semibold">
                {formatFriendlyDate(htLastManualCall)}
              </p>
            </div>
          </div>

          <div className="bg-white/10 border border-white/10 rounded-lg p-3">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-md font-semibold">Logs HT</h2>
              <span className="text-xs opacity-60">{htLogs.length} entrée(s)</span>
            </div>
            {htLogs.length === 0 ? (
              <p className="text-sm opacity-70">Aucun log pour l’instant.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {htLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 rounded-md px-3 py-2 ${
                      log.status === "success" ? "bg-green-500/10 border border-green-500/20" : "bg-red-500/10 border border-red-500/20"
                    }`}
                  >
                    <div className="text-xs opacity-60 min-w-0 sm:min-w-[110px]">
                      {formatDate(log.timestamp)}
                    </div>
                    <div className="text-sm">
                      <span
                        className={`mr-2 text-[11px] px-2 py-0.5 rounded-full uppercase ${
                          log.status === "success"
                            ? "bg-green-500/20 text-green-200"
                            : "bg-red-500/20 text-red-200"
                        }`}
                      >
                        {log.status}
                      </span>
                      {log.message}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
