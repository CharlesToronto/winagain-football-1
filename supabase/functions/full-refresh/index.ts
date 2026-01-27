// @ts-nocheck

export const config = {
  jwtVerify: false,
};

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const API_FOOTBALL_KEY = Deno.env.get("API_FOOTBALL_KEY");

const SEASON = 2025;
const UPCOMING_STATUSES = ["NS", "TBD", "PST", "POSTP", "SUSP", "CANC", "INT", "BT"];

function getSupabaseAdmin() {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
}

async function fetchApiFootball(path: string, params: Record<string, any>) {
  const url = new URL(`https://v3.football.api-sports.io/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, `${v}`));

  const res = await fetch(url, {
    headers: {
      "x-apisports-key": API_FOOTBALL_KEY!,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API_Football error ${res.status}: ${text}`);
  }

  return res.json();
}

async function fetchFixturesForCompetition(leagueId: number, status: string) {
  const apiResponse = await fetchApiFootball("fixtures", {
    league: leagueId,
    season: SEASON,
    status,
  });

  return apiResponse?.response ?? [];
}

function extractFields(fx: any) {
  return {
    status_short: fx.fixture?.status?.short ?? null,
    status_long: fx.fixture?.status?.long ?? null,
    goals_home: fx.goals?.home ?? null,
    goals_away: fx.goals?.away ?? null,
    round: fx.league?.round ?? null,
    date_utc: fx.fixture?.date ?? null,
  };
}

function isChanged(existing: any, nextFields: any) {
  return (
    existing.status_short !== nextFields.status_short ||
    existing.status_long !== nextFields.status_long ||
    existing.goals_home !== nextFields.goals_home ||
    existing.goals_away !== nextFields.goals_away ||
    existing.round !== nextFields.round ||
    existing.date_utc !== nextFields.date_utc
  );
}

async function syncFixturesForCompetition(supabase: any, leagueId: number) {
  let checked = 0;
  let updated = 0;
  let skipped = 0;
  const errors: any[] = [];

  const finished = await fetchFixturesForCompetition(leagueId, "FT");
  const upcoming = await fetchFixturesForCompetition(
    leagueId,
    UPCOMING_STATUSES.join(",")
  );

  const fixtures = [...finished, ...upcoming];
  checked += fixtures.length;

  for (const fx of fixtures) {
    const id = fx.fixture?.id;
    if (!id) continue;

    const { data: existing, error: selectError } = await supabase
      .from("fixtures")
      .select("*")
      .eq("id", id)
      .single();

    if (selectError && selectError.code !== "PGRST116") {
      errors.push({ leagueId, fixtureId: id, error: selectError.message });
      continue;
    }

    if (!existing) {
      skipped++;
      continue;
    }

    const nextFields = extractFields(fx);
    if (!isChanged(existing, nextFields)) {
      continue;
    }

    const { error: updateError } = await supabase
      .from("fixtures")
      .update(nextFields)
      .eq("id", id);

    if (updateError) {
      errors.push({ leagueId, fixtureId: id, error: updateError.message });
    } else {
      updated++;
    }
  }

  return { checked, updated, skipped, errors };
}

serve(async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !API_FOOTBALL_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or API_FOOTBALL_KEY",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: competitions, error: competitionsError } = await supabase
    .from("competitions")
    .select("id");

  if (competitionsError) {
    return new Response(
      JSON.stringify({ ok: false, error: competitionsError.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const summary = {
    ok: true,
    season: SEASON,
    checked: 0,
    updated: 0,
    skipped: 0,
    errorCount: 0,
    errors: [] as any[],
  };

  for (const comp of competitions ?? []) {
    const leagueId = comp?.id;
    if (!leagueId) continue;

    try {
      const { checked, updated, skipped, errors } = await syncFixturesForCompetition(
        supabase,
        leagueId
      );
      summary.checked += checked;
      summary.updated += updated;
      summary.skipped += skipped;
      summary.errors.push(...errors);
    } catch (err: any) {
      summary.errors.push({ leagueId, error: err?.message ?? String(err) });
    }
  }

  summary.errorCount = summary.errors.length;
  summary.ok = summary.errorCount === 0;

  return new Response(JSON.stringify(summary), {
    headers: { "Content-Type": "application/json" },
  });
});
