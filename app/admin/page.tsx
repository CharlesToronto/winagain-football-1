"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type TopPageRow = { path: string; views: number; unique_sessions: number };

type UsageSummaryRow = {
  sessions: number;
  active_sessions_24h: number;
  avg_seconds: number;
  total_seconds: number;
};

type BroadcastRow = {
  id: string;
  channel: string;
  title: string | null;
  message: string;
  starts_at: string;
  ends_at: string | null;
};

type PickLite = {
  snapshot_date: string;
  fixture_id: number;
  league_id: number | null;
  competition_name: string | null;
  pick: string | null;
  odd: number | null;
  status: string | null;
};

type ComboLeg = PickLite & { fixture_id: number; pick: string; odd: number; status: "hit" | "miss" };

type Combo = {
  legs: ComboLeg[];
  totalOdd: number;
  status: "hit" | "miss";
  snapshotDate: string;
};

const UPDATE_EVENT = "app-broadcast-updated";

const MIN_COMBO_ODDS = 1.75;
const COMBO_HISTORY_SNAPSHOTS = 30;
const MAX_COMBOS_PER_SNAPSHOT = 3;
const BASE_BANKROLL = 1000;
const SINGLES_STAKE = 10;
const COMBOS_STAKE = 50;

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
  "Romania|||Liga I",
  "Serbia|||Super Liga",
]);

function isMissingTable(error: any) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("does not exist") && message.includes("relation");
}

function isMissingFunction(error: any) {
  if (!error) return false;
  if (error.code === "PGRST202") {
    const message = String(error.message ?? "").toLowerCase();
    return message.includes("could not find the function");
  }
  return false;
}

function formatNumber(value: number | null, digits = 0) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSeconds(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const s = Math.max(0, Math.floor(value));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function toDatetimeLocalValue(iso: string | null | undefined) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mi = String(dt.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function datetimeLocalToIso(value: string) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function normalizePickKey(pick: string | null | undefined) {
  return String(pick ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function comboLegKey(leg: ComboLeg) {
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

function selectRandomCombos(list: Omit<Combo, "snapshotDate">[], seed: string, max: number) {
  const limit = Math.max(0, Math.floor(Number(max) || 0));
  if (!limit) return [];
  if (!Array.isArray(list) || list.length === 0) return [];

  const seeded = [...list].sort((a, b) => {
    const scoreA = hash32(`${seed}|${a.legs.map(comboLegKey).sort().join("|")}`);
    const scoreB = hash32(`${seed}|${b.legs.map(comboLegKey).sort().join("|")}`);
    if (scoreA !== scoreB) return scoreA - scoreB;
    const keyA = a.legs.map(comboLegKey).sort().join("|");
    const keyB = b.legs.map(comboLegKey).sort().join("|");
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const usedLegs = new Set<string>();
  const selected: Omit<Combo, "snapshotDate">[] = [];
  for (const combo of seeded) {
    const keys = combo.legs.map(comboLegKey);
    if (keys.some((key) => usedLegs.has(key))) continue;
    keys.forEach((key) => usedLegs.add(key));
    selected.push(combo);
    if (selected.length >= limit) break;
  }
  return selected;
}

function buildDoubles(candidates: ComboLeg[]) {
  const combos: Omit<Combo, "snapshotDate">[] = [];
  const n = candidates.length;
  for (let i = 0; i < n - 1; i += 1) {
    const a = candidates[i];
    for (let j = i + 1; j < n; j += 1) {
      const b = candidates[j];
      if (a.fixture_id === b.fixture_id) continue;
      const totalOdd = Number((a.odd * b.odd).toFixed(2));
      if (totalOdd < MIN_COMBO_ODDS) continue;
      combos.push({
        legs: [a, b],
        totalOdd,
        status: a.status === "hit" && b.status === "hit" ? "hit" : "miss",
      });
    }
  }
  return combos;
}

function buildRandomTriples(candidates: ComboLeg[], seed: string, maxSamples: number) {
  const n = candidates.length;
  if (n < 3) return [];
  const maxWanted = Math.max(0, Math.floor(Number(maxSamples) || 0));
  if (!maxWanted) return [];

  const rng = mulberry32(hash32(seed));
  const combos: Omit<Combo, "snapshotDate">[] = [];
  const seen = new Set<string>();
  const maxAttempts = Math.min(50000, maxWanted * 60);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (combos.length >= maxWanted) break;

    const i = Math.floor(rng() * n);
    let j = Math.floor(rng() * n);
    let k = Math.floor(rng() * n);
    if (j === i) j = (j + 1) % n;
    if (k === i || k === j) k = (k + 2) % n;
    if (i === j || i === k || j === k) continue;

    const a = candidates[i];
    const b = candidates[j];
    const c = candidates[k];
    if (a.fixture_id === b.fixture_id || a.fixture_id === c.fixture_id || b.fixture_id === c.fixture_id)
      continue;

    const totalOdd = Number((a.odd * b.odd * c.odd).toFixed(2));
    if (totalOdd < MIN_COMBO_ODDS) continue;

    const legs = [a, b, c];
    const key = legs.map(comboLegKey).sort().join("|");
    if (!key || seen.has(key)) continue;
    seen.add(key);

    combos.push({
      legs,
      totalOdd,
      status: legs.every((leg) => leg.status === "hit") ? "hit" : "miss",
    });
  }
  return combos;
}

function buildSelectedCombos(candidates: ComboLeg[], seed: string, limit: number) {
  const selected: Omit<Combo, "snapshotDate">[] = [];
  const doubles = buildDoubles(candidates);
  selected.push(...selectRandomCombos(doubles, `${seed}|2`, limit));
  if (selected.length >= limit) return selected;

  const remaining = limit - selected.length;
  const triples = buildRandomTriples(candidates, `${seed}|3`, 2500);
  const usedLegs = new Set(selected.flatMap((combo) => combo.legs.map(comboLegKey)));
  const triplesFiltered = triples.filter((combo) =>
    combo.legs.map(comboLegKey).every((key) => !usedLegs.has(key))
  );
  selected.push(...selectRandomCombos(triplesFiltered, `${seed}|3`, remaining));
  return selected.slice(0, limit);
}

export default function AdminPage() {
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [usersCount, setUsersCount] = useState<number | null>(null);
  const [subsTotal, setSubsTotal] = useState<number | null>(null);
  const [subsActive, setSubsActive] = useState<number | null>(null);

  const [picksTotal, setPicksTotal] = useState<number | null>(null);
  const [picksResolved, setPicksResolved] = useState<number | null>(null);
  const [picksHits, setPicksHits] = useState<number | null>(null);
  const [picksMisses, setPicksMisses] = useState<number | null>(null);
  const [picksAvgOdd, setPicksAvgOdd] = useState<number | null>(null);
  const [picksProfit, setPicksProfit] = useState<number | null>(null);
  const [picksRoi, setPicksRoi] = useState<number | null>(null);

  const [combosCount, setCombosCount] = useState<number | null>(null);
  const [combosHitRate, setCombosHitRate] = useState<number | null>(null);
  const [combosProfit, setCombosProfit] = useState<number | null>(null);

  const [usageSummary, setUsageSummary] = useState<UsageSummaryRow | null>(null);
  const [topPages, setTopPages] = useState<TopPageRow[]>([]);

  const [topbarDraft, setTopbarDraft] = useState({
    message: "",
    startsAt: "",
    endsAt: "",
  });
  const [bannerDraft, setBannerDraft] = useState({
    title: "",
    message: "",
    startsAt: "",
    endsAt: "",
  });
  const [saving, setSaving] = useState(false);

  const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([]);

  const hitRate = useMemo(() => {
    if (!picksResolved) return null;
    if (!picksHits && picksHits !== 0) return null;
    return (picksHits / picksResolved) * 100;
  }, [picksHits, picksResolved]);

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const [
        profilesRes,
        subsRes,
        subsActiveRes,
        totalRes,
        resolvedRes,
        hitsRes,
        missesRes,
      ] = await Promise.all([
        supabaseBrowser.from("profiles").select("id", { count: "exact", head: true }),
        supabaseBrowser.from("app_subscriptions").select("id", { count: "exact", head: true }),
        supabaseBrowser
          .from("app_subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("status", "active"),
        supabaseBrowser.from("daily_algo_picks_v3").select("id", { count: "exact", head: true }),
        supabaseBrowser
          .from("daily_algo_picks_v3")
          .select("id", { count: "exact", head: true })
          .in("status", ["hit", "miss"]),
        supabaseBrowser
          .from("daily_algo_picks_v3")
          .select("id", { count: "exact", head: true })
          .eq("status", "hit"),
        supabaseBrowser
          .from("daily_algo_picks_v3")
          .select("id", { count: "exact", head: true })
          .eq("status", "miss"),
      ]);

      if (profilesRes.error && !isMissingTable(profilesRes.error)) {
        console.warn("[admin] profiles count error:", profilesRes.error);
      }
      if (subsRes.error && !isMissingTable(subsRes.error)) {
        console.warn("[admin] subscriptions count error:", subsRes.error);
      }
      if (subsActiveRes.error && !isMissingTable(subsActiveRes.error)) {
        console.warn("[admin] subscriptions active count error:", subsActiveRes.error);
      }
      if (totalRes.error) throw totalRes.error;
      if (resolvedRes.error) throw resolvedRes.error;
      if (hitsRes.error) throw hitsRes.error;
      if (missesRes.error) throw missesRes.error;

      setUsersCount(profilesRes.count ?? null);
      setSubsTotal(subsRes.count ?? null);
      setSubsActive(subsActiveRes.count ?? null);
      setPicksTotal(totalRes.count ?? null);
      setPicksResolved(resolvedRes.count ?? null);
      setPicksHits(hitsRes.count ?? null);
      setPicksMisses(missesRes.count ?? null);

      const { data: oddsRows, error: oddsError } = await supabaseBrowser
        .from("daily_algo_picks_v3")
        .select("status,odd,snapshot_date,fixture_id,league_id,competition_name,pick")
        .in("status", ["hit", "miss", "pending"]);
      if (oddsError) throw oddsError;

      const resolvedRows = (oddsRows ?? []).filter(
        (row: any) => row.status === "hit" || row.status === "miss"
      ) as PickLite[];
      const resolvedWithOdds = resolvedRows
        .map((row) => ({ ...row, odd: Number(row.odd) }))
        .filter((row) => Number.isFinite(row.odd) && row.odd > 1);

      const avgOdd =
        resolvedWithOdds.length > 0
          ? resolvedWithOdds.reduce((sum, row) => sum + (row.odd as number), 0) /
            resolvedWithOdds.length
          : 0;
      setPicksAvgOdd(avgOdd || null);

      let profit = 0;
      let profitBets = 0;
      resolvedWithOdds.forEach((row) => {
        const odd = Number(row.odd);
        if (!Number.isFinite(odd) || odd <= 1) return;
        const isHit = row.status === "hit";
        profit += isHit ? (odd - 1) * SINGLES_STAKE : -SINGLES_STAKE;
        profitBets += 1;
      });
      setPicksProfit(profitBets ? profit : 0);
      setPicksRoi(profitBets ? (profit / (profitBets * SINGLES_STAKE)) * 100 : 0);

      // Combos summary (last 30 snapshots with resolved picks)
      const snapshotDates = Array.from(
        new Set(resolvedWithOdds.map((row) => String(row.snapshot_date)).filter(Boolean))
      ).sort();
      const recentDates = snapshotDates.slice(-COMBO_HISTORY_SNAPSHOTS);

      const combosHistory: Combo[] = [];
      recentDates.forEach((date) => {
        const rowsForDate = resolvedWithOdds.filter((row) => row.snapshot_date === date);
        const candidates = rowsForDate
          .filter((row) => {
            const competitionKey = `${row.league_id ?? ""}|||${row.competition_name ?? ""}`;
            if (row.league_id == null && row.competition_name) {
              // fallback to name-only (keeps historical blacklist behavior)
              const key = `${""}|||${row.competition_name ?? ""}`;
              if (DISCOURAGED_COMPETITIONS.has(key)) return false;
            }
            if (row.competition_name) {
              // We only have name here. Keep selection permissive if country missing.
            }
            return true;
          })
          .map((row) => ({
            ...(row as any),
            fixture_id: Number(row.fixture_id),
            pick: String(row.pick ?? ""),
            odd: Number(row.odd),
            status: row.status as "hit" | "miss",
          }))
          .filter((row) => row.pick && Number.isFinite(row.fixture_id) && row.fixture_id > 0);

        const selected = buildSelectedCombos(candidates as ComboLeg[], `history|${date}`, MAX_COMBOS_PER_SNAPSHOT)
          .map((combo) => ({ ...combo, snapshotDate: date }));
        combosHistory.push(...selected);
      });

      const cCount = combosHistory.length;
      const cHits = combosHistory.filter((c) => c.status === "hit").length;
      const cHitRate = cCount ? (cHits / cCount) * 100 : 0;
      let cProfit = 0;
      combosHistory.forEach((combo) => {
        cProfit += combo.status === "hit" ? (combo.totalOdd - 1) * COMBOS_STAKE : -COMBOS_STAKE;
      });
      setCombosCount(cCount);
      setCombosHitRate(cCount ? cHitRate : null);
      setCombosProfit(cCount ? cProfit : null);

      // Analytics (optional)
      const { data: usageData, error: usageError } = await supabaseBrowser.rpc(
        "analytics_usage_summary",
        { days: 7 }
      );
      if (usageError) {
        if (!isMissingTable(usageError) && !isMissingFunction(usageError)) {
          console.warn("[admin] analytics usage error:", usageError);
        }
        setUsageSummary(null);
      } else {
        const usageRow = Array.isArray(usageData) ? usageData[0] : null;
        setUsageSummary(usageRow ?? null);
      }

      const { data: topData, error: topError } = await supabaseBrowser.rpc("analytics_top_pages", {
        days: 7,
        max_rows: 10,
      });
      if (topError) {
        if (!isMissingTable(topError) && !isMissingFunction(topError)) {
          console.warn("[admin] analytics top pages error:", topError);
        }
        setTopPages([]);
      } else {
        setTopPages(Array.isArray(topData) ? (topData as TopPageRow[]) : []);
      }

      const nowIso = new Date().toISOString();
      const { data: currentTopbar, error: topbarError } = await supabaseBrowser
        .from("app_broadcasts")
        .select("id,channel,title,message,starts_at,ends_at")
        .eq("channel", "topbar")
        .lte("starts_at", nowIso)
        .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (topbarError && !isMissingTable(topbarError)) {
        console.warn("[admin] topbar load error:", topbarError);
      }
      setTopbarDraft({
        message: String(currentTopbar?.message ?? "").trim(),
        startsAt: toDatetimeLocalValue(currentTopbar?.starts_at ?? null) || toDatetimeLocalValue(nowIso),
        endsAt: toDatetimeLocalValue(currentTopbar?.ends_at ?? null),
      });

      const { data: currentBanner, error: bannerError } = await supabaseBrowser
        .from("app_broadcasts")
        .select("id,channel,title,message,starts_at,ends_at")
        .eq("channel", "banner")
        .lte("starts_at", nowIso)
        .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (bannerError && !isMissingTable(bannerError)) {
        console.warn("[admin] banner load error:", bannerError);
      }
      setBannerDraft({
        title: String(currentBanner?.title ?? "").trim(),
        message: String(currentBanner?.message ?? "").trim(),
        startsAt: toDatetimeLocalValue(currentBanner?.starts_at ?? null) || toDatetimeLocalValue(nowIso),
        endsAt: toDatetimeLocalValue(currentBanner?.ends_at ?? null),
      });

      const { data: recentBroadcasts, error: broadcastsError } = await supabaseBrowser
        .from("app_broadcasts")
        .select("id,channel,title,message,starts_at,ends_at")
        .order("starts_at", { ascending: false })
        .limit(15);
      if (broadcastsError && !isMissingTable(broadcastsError)) {
        console.warn("[admin] broadcasts load error:", broadcastsError);
      }
      setBroadcasts(Array.isArray(recentBroadcasts) ? (recentBroadcasts as BroadcastRow[]) : []);

      setNotice("Dashboard mis à jour.");
    } catch (err: any) {
      setError(err?.message ?? "Erreur chargement dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void handleRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveBroadcast = async (channel: "topbar" | "banner") => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const nowIso = new Date().toISOString();
      const draft = channel === "topbar" ? topbarDraft : bannerDraft;
      const message = String(draft.message ?? "").trim();
      if (!message) throw new Error("Message requis.");

      const startsAtIso = datetimeLocalToIso(draft.startsAt) ?? nowIso;
      const endsAtIso = draft.endsAt ? datetimeLocalToIso(draft.endsAt) : null;

      const payload: any = {
        channel,
        title: channel === "banner" ? String((draft as any).title ?? "").trim() || null : null,
        message,
        starts_at: startsAtIso,
        ends_at: endsAtIso,
        updated_at: nowIso,
      };

      const { error: insertError } = await supabaseBrowser.from("app_broadcasts").insert(payload);
      if (insertError) throw insertError;

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(UPDATE_EVENT));
      }
      setNotice(channel === "topbar" ? "Topbar mise à jour." : "Notification mise à jour.");
      await handleRefresh();
    } catch (err: any) {
      setError(err?.message ?? "Erreur sauvegarde");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen w-full px-3 py-4 sm:p-6 text-white space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-white/60">Admin</p>
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-white/60">
            Pilotage, notifications, stats et monitoring (7 derniers jours).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="px-3 py-2 rounded-lg text-sm border border-white/15 bg-white/10 hover:bg-white/15 disabled:opacity-50"
          >
            {loading ? "Chargement..." : "Rafraîchir"}
          </button>
          <Link
            href="/admin-data"
            className="px-3 py-2 rounded-lg text-sm border border-white/15 bg-white/10 hover:bg-white/15"
          >
            Admin Data
          </Link>
        </div>
      </div>

      {notice ? (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Users inscrits</div>
          <div className="mt-1 text-2xl font-bold">{formatNumber(usersCount)}</div>
          <div className="mt-1 text-[11px] text-white/50">Table `profiles`</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Abonnements (total)</div>
          <div className="mt-1 text-2xl font-bold">{formatNumber(subsTotal)}</div>
          <div className="mt-1 text-[11px] text-white/50">Table `app_subscriptions`</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Abonnements actifs</div>
          <div className="mt-1 text-2xl font-bold">{formatNumber(subsActive)}</div>
          <div className="mt-1 text-[11px] text-white/50">status = active</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Sessions (7j)</div>
          <div className="mt-1 text-2xl font-bold">
            {formatNumber(usageSummary?.sessions ?? null)}
          </div>
          <div className="mt-1 text-[11px] text-white/50">
            Actives 24h: {formatNumber(usageSummary?.active_sessions_24h ?? null)}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Bannière Topbar</div>
              <div className="text-xs text-white/60">
                Texte affiché en haut de l&apos;app.
              </div>
            </div>
            <button
              type="button"
              onClick={() => saveBroadcast("topbar")}
              disabled={saving}
              className="px-3 py-2 rounded-lg text-sm bg-sky-500/20 border border-sky-400/30 text-sky-100 hover:bg-sky-500/30 disabled:opacity-50"
            >
              {saving ? "Sauvegarde..." : "Sauvegarder"}
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            <textarea
              value={topbarDraft.message}
              onChange={(e) => setTopbarDraft((p) => ({ ...p, message: e.target.value }))}
              className="w-full min-h-[90px] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
              placeholder="Message topbar..."
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs text-white/60">
                Début
                <input
                  type="datetime-local"
                  value={topbarDraft.startsAt}
                  onChange={(e) =>
                    setTopbarDraft((p) => ({ ...p, startsAt: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none"
                />
              </label>
              <label className="text-xs text-white/60">
                Fin (optionnel)
                <input
                  type="datetime-local"
                  value={topbarDraft.endsAt}
                  onChange={(e) => setTopbarDraft((p) => ({ ...p, endsAt: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Notification (bannière)</div>
              <div className="text-xs text-white/60">
                Affichée dans les pages (dismissible).
              </div>
            </div>
            <button
              type="button"
              onClick={() => saveBroadcast("banner")}
              disabled={saving}
              className="px-3 py-2 rounded-lg text-sm bg-amber-500/20 border border-amber-400/30 text-amber-100 hover:bg-amber-500/30 disabled:opacity-50"
            >
              {saving ? "Sauvegarde..." : "Envoyer"}
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            <input
              value={bannerDraft.title}
              onChange={(e) => setBannerDraft((p) => ({ ...p, title: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
              placeholder="Titre (optionnel)"
            />
            <textarea
              value={bannerDraft.message}
              onChange={(e) => setBannerDraft((p) => ({ ...p, message: e.target.value }))}
              className="w-full min-h-[90px] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
              placeholder="Message notification..."
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs text-white/60">
                Début
                <input
                  type="datetime-local"
                  value={bannerDraft.startsAt}
                  onChange={(e) => setBannerDraft((p) => ({ ...p, startsAt: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none"
                />
              </label>
              <label className="text-xs text-white/60">
                Fin (optionnel)
                <input
                  type="datetime-local"
                  value={bannerDraft.endsAt}
                  onChange={(e) => setBannerDraft((p) => ({ ...p, endsAt: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-semibold">Résumé • Historique Algo (simples)</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-white/60">Picks (v3)</div>
              <div className="mt-1 text-xl font-bold">
                {formatNumber(picksResolved)}/{formatNumber(picksTotal)}
              </div>
              <div className="mt-1 text-[11px] text-white/50">Résolus / Total</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-white/60">Hit rate</div>
              <div className="mt-1 text-xl font-bold">
                {hitRate == null ? "—" : `${formatNumber(hitRate, 1)}%`}
              </div>
              <div className="mt-1 text-[11px] text-white/50">
                {formatNumber(picksHits)} / {formatNumber(picksMisses)}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-white/60">Cote moyenne (résolus)</div>
              <div className="mt-1 text-xl font-bold">
                {picksAvgOdd == null ? "—" : formatNumber(picksAvgOdd, 2)}
              </div>
              <div className="mt-1 text-[11px] text-white/50">Odds &gt; 1</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-white/60">Profit / ROI</div>
              <div className="mt-1 text-xl font-bold">
                {picksProfit == null ? "—" : `${formatNumber(picksProfit, 0)}$`}
              </div>
              <div className="mt-1 text-[11px] text-white/50">
                ROI {picksRoi == null ? "—" : `${formatNumber(picksRoi, 1)}%`} • mise {SINGLES_STAKE}$
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/picks"
              className="px-3 py-2 rounded-lg text-sm border border-white/15 bg-white/10 hover:bg-white/15"
            >
              Ouvrir Matchs simples
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-semibold">Résumé • Historique Algo (combinés)</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-white/60">Tickets (30 derniers snapshots)</div>
              <div className="mt-1 text-xl font-bold">{formatNumber(combosCount)}</div>
              <div className="mt-1 text-[11px] text-white/50">max {MAX_COMBOS_PER_SNAPSHOT}/snapshot</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-white/60">Hit rate</div>
              <div className="mt-1 text-xl font-bold">
                {combosHitRate == null ? "—" : `${formatNumber(combosHitRate, 1)}%`}
              </div>
              <div className="mt-1 text-[11px] text-white/50">Base {BASE_BANKROLL}$</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3 sm:col-span-2">
              <div className="text-xs text-white/60">Profit (tickets)</div>
              <div className="mt-1 text-xl font-bold">
                {combosProfit == null ? "—" : `${formatNumber(combosProfit, 0)}$`}
              </div>
              <div className="mt-1 text-[11px] text-white/50">mise {COMBOS_STAKE}$</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/combos"
              className="px-3 py-2 rounded-lg text-sm border border-white/15 bg-white/10 hover:bg-white/15"
            >
              Ouvrir Combinés
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-semibold">Analytics • Temps d&apos;utilisation</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-white/60">Durée moyenne</div>
              <div className="mt-1 text-xl font-bold">
                {formatSeconds(usageSummary?.avg_seconds ?? null)}
              </div>
              <div className="mt-1 text-[11px] text-white/50">par session</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-white/60">Temps total</div>
              <div className="mt-1 text-xl font-bold">
                {usageSummary?.total_seconds == null
                  ? "—"
                  : `${formatNumber((usageSummary.total_seconds ?? 0) / 3600, 1)}h`}
              </div>
              <div className="mt-1 text-[11px] text-white/50">sur 7 jours</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-white/50">
            Données alimentées par le tracker (AppShell).
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-semibold">Analytics • Pages les plus visitées</div>
          {topPages.length ? (
            <div className="mt-3 space-y-2">
              {topPages.map((row) => (
                <div
                  key={row.path}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-white">{row.path}</div>
                    <div className="text-[11px] text-white/50">
                      {formatNumber(row.unique_sessions)} session(s) uniques
                    </div>
                  </div>
                  <div className="text-xs font-bold text-white/80 tabular-nums">
                    {formatNumber(row.views)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-white/60">
              Pas encore de données (ou tables analytics non installées).
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-sm font-semibold">Historique des broadcasts (15 derniers)</div>
        {broadcasts.length ? (
          <div className="mt-3 grid gap-2">
            {broadcasts.map((b) => (
              <div
                key={b.id}
                className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-white">
                    {b.channel.toUpperCase()}{" "}
                    <span className="text-white/40 font-normal">
                      • {new Date(b.starts_at).toLocaleString("fr-FR")}
                    </span>
                  </div>
                  {b.ends_at ? (
                    <div className="text-[11px] text-white/50">
                      Fin: {new Date(b.ends_at).toLocaleString("fr-FR")}
                    </div>
                  ) : (
                    <div className="text-[11px] text-white/50">—</div>
                  )}
                </div>
                {b.title ? (
                  <div className="mt-1 text-[11px] font-semibold text-white/80">
                    {b.title}
                  </div>
                ) : null}
                <div className="mt-1 text-[11px] text-white/70 whitespace-pre-line">
                  {b.message}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-sm text-white/60">
            Aucun broadcast (ou table `app_broadcasts` absente).
          </div>
        )}
      </div>
    </div>
  );
}
