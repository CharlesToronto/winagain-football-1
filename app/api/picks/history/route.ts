import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function formatDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeRatio(value: any) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num > 1 && num <= 100) return num / 100;
  return num;
}

function isBluePick(row: any) {
  const probability = Number(row?.probability);
  const odd = Number(row?.odd);
  const hitRate = normalizeRatio(row?.hit_rate);
  if (!Number.isFinite(probability) || probability <= 0) return false;
  if (!Number.isFinite(odd) || odd <= 1) return false;
  if (!Number.isFinite(hitRate ?? NaN) || (hitRate ?? 0) <= 0.9) return false;
  const implied = 1 / odd;
  return probability > implied;
}

export async function GET(request: Request) {
  const supabase = createClient();
  try {
    const url = new URL(request.url);
    const daysParam = Number(url.searchParams.get("days") ?? "30");
    const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30;
    const criteria = (url.searchParams.get("criteria") ?? "all").toLowerCase();
    const market = url.searchParams.get("market") ?? "all";
    const algoVersion = (url.searchParams.get("algo") ?? "v1").toLowerCase();
    const tableName =
      algoVersion === "v2"
        ? "daily_algo_picks_v2"
        : algoVersion === "v3"
          ? "daily_algo_picks_v3"
          : "daily_algo_picks";

    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromKey = formatDateKey(from);

    const buildQuery = (offset: number, limit: number) => {
      let query = supabase
        .from(tableName)
        .select("*")
        .or(`snapshot_date.gte.${fromKey},snapshot_date.is.null`)
        .order("fixture_date_utc", { ascending: true })
        .range(offset, offset + limit - 1);

      if (criteria === "rose") {
        query = query.eq("meets_criteria", true);
      } else if (criteria === "yellow") {
        query = query.eq("meets_criteria", false);
      }

    if (market !== "all") {
      query = query.eq("market", market);
    }

      return query;
    };

    const items: any[] = [];
    const batchSize = 1000;
    let offset = 0;

    while (true) {
      const { data, error } = await buildQuery(offset, batchSize);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const rows = data ?? [];
      items.push(...rows);
      if (rows.length < batchSize) break;
      offset += batchSize;
    }

    const leagueIds = Array.from(
      new Set(
        items
          .map((row: any) => Number(row?.league_id))
          .filter((id: number) => Number.isFinite(id))
      )
    );
    const fixtureIds = Array.from(
      new Set(
        items
          .map((row: any) => Number(row?.fixture_id))
          .filter((id: number) => Number.isFinite(id) && id > 0)
      )
    );
    const competitionCountryMap = new Map<number, string>();
    const fixtureHomeTeamMap = new Map<number, number | null>();
    const fixtureAwayTeamMap = new Map<number, number | null>();
    if (leagueIds.length) {
      const { data: competitions, error: compError } = await supabase
        .from("competitions")
        .select("id,country")
        .in("id", leagueIds);
      if (compError) {
        return NextResponse.json({ error: compError.message }, { status: 500 });
      }
      (competitions ?? []).forEach((row: any) => {
        const id = Number(row?.id);
        if (!Number.isFinite(id)) return;
        if (row?.country) competitionCountryMap.set(id, String(row.country));
      });
    }

    if (fixtureIds.length) {
      const chunkSize = 1000;
      for (let index = 0; index < fixtureIds.length; index += chunkSize) {
        const chunk = fixtureIds.slice(index, index + chunkSize);
        const { data: fixtures, error: fixturesError } = await supabase
          .from("fixtures")
          .select("id,home_team_id,away_team_id")
          .in("id", chunk);
        if (fixturesError) {
          return NextResponse.json({ error: fixturesError.message }, { status: 500 });
        }
        (fixtures ?? []).forEach((row: any) => {
          const id = Number(row?.id);
          if (!Number.isFinite(id)) return;
          const homeTeamId = Number(row?.home_team_id);
          const awayTeamId = Number(row?.away_team_id);
          fixtureHomeTeamMap.set(id, Number.isFinite(homeTeamId) ? homeTeamId : null);
          fixtureAwayTeamMap.set(id, Number.isFinite(awayTeamId) ? awayTeamId : null);
        });
      }
    }

    const enriched = items.map((row: any) => ({
      ...row,
      competition_country: competitionCountryMap.get(Number(row?.league_id)) ?? null,
      home_team_id: fixtureHomeTeamMap.get(Number(row?.fixture_id)) ?? null,
      away_team_id: fixtureAwayTeamMap.get(Number(row?.fixture_id)) ?? null,
    }));
    const finalItems = criteria === "blue" ? enriched.filter(isBluePick) : enriched;

    const res = NextResponse.json({ items: finalItems });
    // Explicitly prevent caching. We rely on live DB state (statuses change after resolve).
    res.headers.set("Cache-Control", "no-store, max-age=0");
    res.headers.set("Pragma", "no-cache");
    res.headers.set("Expires", "0");
    res.headers.set("Surrogate-Control", "no-store");
    return res;
  } catch (err: any) {
    return NextResponse.json(
      { error: true, details: err?.message ?? "History error" },
      { status: 500 }
    );
  }
}
