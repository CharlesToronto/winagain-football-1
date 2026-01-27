// @ts-nocheck
export const config = { jwtVerify: false };

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_FOOTBALL_KEY = Deno.env.get("API_FOOTBALL_KEY")!;

const SEASONS = [2024, 2025]; // on couvre les saisons connues (API-Football utilise l'année de début)

function getSupabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function clean(value: any) {
  return String(value).trim();
}

async function fetchApiFootball(path: string, params: Record<string, any>) {
  const url = new URL(`https://v3.football.api-sports.io/${path}`);
  Object.entries(params).forEach(([k, v]) =>
    url.searchParams.append(k, clean(v))
  );
  console.log("API_FOOTBALL_HTTP_URL", url.toString());

  const res = await fetch(url, {
    headers: {
      "x-apisports-key": API_FOOTBALL_KEY,
      "Accept": "application/json",
      "User-Agent": "WinAgain/1.0",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API_Football error ${res.status}: ${text}`);
  }

  return res.json();
}

serve(async () => {
  console.log("FIXTURES-REFRESH VERSION = SEASONS + STATUS=FT", new Date().toISOString());
  try {
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

    let checked = 0;
    let updated = 0;
    const errors: any[] = [];

    for (const comp of competitions ?? []) {
      for (const season of SEASONS) {
        try {
          console.log("API_FOOTBALL_CALL", { league: comp.id, season, status: "FT" });
          const apiResponse = await fetchApiFootball("fixtures", {
            league: String(comp.id).trim(),
            season: String(season).trim(),
            status: "FT", // API-Football attend des statuts en MAJ (FT, NS, etc.)
          });
          console.log("API_FOOTBALL_RESPONSE_META", {
            league: comp.id,
            season,
            results: apiResponse?.results,
            paging: apiResponse?.paging,
          });

          const matches = apiResponse?.response ?? [];
          for (const fx of matches) {
            const id = fx.fixture?.id;
            const dateUtc = fx.fixture?.date ?? null;
            if (!id) continue;

            checked++;

            const { data: existing, error: selectError } = await supabase
              .from("fixtures")
              .select("*")
              .eq("id", id)
              .maybeSingle();

            if (selectError) {
              errors.push({ id, leagueId: comp.id, season, error: selectError.message });
              continue;
            }
            if (!existing) continue; // on ignore les fixtures inconnues en base

            const halftimeHome = fx.score?.halftime?.home ?? null;
            const halftimeAway = fx.score?.halftime?.away ?? null;
            const nextFields = {
              status_short: fx.fixture?.status?.short ?? null,
              status_long: fx.fixture?.status?.long ?? null,
              goals_home: fx.goals?.home ?? null,
              goals_away: fx.goals?.away ?? null,
              goals_home_ht: halftimeHome,
              goals_away_ht: halftimeAway,
              round: fx.league?.round ?? null,
              date_utc: dateUtc,
            };

            const changed =
              existing.status_short !== nextFields.status_short ||
              existing.status_long !== nextFields.status_long ||
              existing.goals_home !== nextFields.goals_home ||
              existing.goals_away !== nextFields.goals_away ||
              existing.goals_home_ht !== nextFields.goals_home_ht ||
              existing.goals_away_ht !== nextFields.goals_away_ht ||
              existing.round !== nextFields.round ||
              existing.date_utc !== nextFields.date_utc;

            if (!changed) continue;

            const { error: updateError } = await supabase
              .from("fixtures")
              .update(nextFields)
              .eq("id", id);

            if (updateError) {
              errors.push({ id, leagueId: comp.id, season, error: updateError.message });
            } else {
              updated++;
            }
          }
        } catch (err: any) {
          errors.push({ leagueId: comp.id, season, error: err?.message ?? String(err) });
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: errors.length === 0,
        seasons: SEASONS,
        checked,
        updated,
        errorCount: errors.length,
        errors,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message ?? "unknown" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
