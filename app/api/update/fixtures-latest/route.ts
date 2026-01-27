import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchApi } from "@/lib/football";
import { ALL_COMPETITION_IDS } from "@/app/lib/data/competitionIds";

export const dynamic = "force-dynamic";

const SEASON = 2025;

export async function GET() {
  const supabase = createClient();

  let checked = 0;
  let updated = 0;
  let errors: any[] = [];

  for (const leagueId of ALL_COMPETITION_IDS) {
    try {
      // Fetch all finished matches for that league
      const apiData = await fetchApi("fixtures", {
        league: leagueId,
        season: SEASON,
        status: "FT",
      });

      const matches = apiData?.response ?? [];
      checked += matches.length;

      for (const fx of matches) {
        const id = fx.fixture?.id;
        if (!id) continue;

        // Fetch our stored match
        const { data: existing, error: selectError } = await supabase
          .from("fixtures")
          .select("*")
          .eq("id", id)
          .single();

        // Ignore unknown fixtures
        if (!existing || selectError) continue;

        // Extract API values
        const newStatusShort = fx.fixture?.status?.short ?? null;
        const newStatusLong = fx.fixture?.status?.long ?? null;
        const newGoalsHome = fx.goals?.home ?? null;
        const newGoalsAway = fx.goals?.away ?? null;
        const newRound = fx.league?.round ?? null;
        const newDateUtc = fx.fixture?.date ?? null;

        // Determine if update is needed
        const changed =
          existing.status_short !== newStatusShort ||
          existing.status_long !== newStatusLong ||
          existing.goals_home !== newGoalsHome ||
          existing.goals_away !== newGoalsAway ||
          existing.round !== newRound ||
          existing.date_utc !== newDateUtc;

        if (!changed) continue;

        // Update in Supabase
        const { error: updateError } = await supabase
          .from("fixtures")
          .update({
            status_short: newStatusShort,
            status_long: newStatusLong,
            goals_home: newGoalsHome,
            goals_away: newGoalsAway,
            round: newRound,
            date_utc: newDateUtc,
          })
          .eq("id", id);

        if (updateError) {
          errors.push({ id, leagueId, error: updateError.message });
        } else {
          updated++;
        }
      }
    } catch (err: any) {
      errors.push({ leagueId, error: err?.message });
    }
  }

  return NextResponse.json({
    ok: true,
    mode: "SYNC_FINISHED_FIXTURES",
    season: SEASON,
    checked,
    updated,
    errorCount: errors.length,
    errors,
  });
}
