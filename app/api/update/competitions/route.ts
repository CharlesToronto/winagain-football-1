import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchApi } from "@/lib/football";
import { COMPETITION_IDS_BY_COUNTRY, ALL_COMPETITION_IDS } from "@/app/lib/data/competitionIds";

/**
 * Import ALL controlled competitions (UEFA List + International + extra-Europe)
 * into the `competitions` table.
 *
 * One UPSERT per league ID to avoid:
 *   "ON CONFLICT DO UPDATE command cannot affect row a second time"
 */
export async function GET() {
  const supabase = createClient();

  let inserted = 0;
  let updated = 0;
  const errors: any[] = [];
  let priority = 1;

  for (const leagueId of ALL_COMPETITION_IDS) {
    try {
      // Fetch league info by ID
      const data = await fetchApi("leagues", { id: leagueId });

      const leagueWrapper = data?.response?.[0];
      if (!leagueWrapper) {
        errors.push({ leagueId, error: "League not found in API-Football" });
        continue;
      }

      const league = leagueWrapper.league;
      const country = leagueWrapper.country;

      // Normalize type (league or cup)
      let type = "league";
      if (league.type && league.type.toLowerCase().includes("cup")) {
        type = "cup";
      }

      // Check if exists
      const { data: existing } = await supabase
        .from("competitions")
        .select("id")
        .eq("id", league.id)
        .maybeSingle();

      // Upsert one row at a time to avoid conflict-on-same-row errors
      const { error } = await supabase.from("competitions").upsert({
        id: league.id,
        name: league.name,
        country: country?.name ?? null,
        type,
        logo: league.logo ?? null,
        priority,
        tier: null, // (we fill later manually for D1/D2)
      });

      if (error) {
        errors.push({ leagueId, error });
      } else {
        if (existing) updated++;
        else inserted++;
      }

      priority++;
    } catch (err: any) {
      errors.push({ leagueId, error: err.message });
    }
  }

  return NextResponse.json({
    ok: true,
    totalLeagueIds: ALL_COMPETITION_IDS.length,
    inserted,
    updated,
    errorCount: errors.length,
    errors,
  });
}
