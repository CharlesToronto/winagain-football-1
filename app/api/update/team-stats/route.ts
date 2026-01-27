import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchApi } from "@/lib/football";
import { COMPETITION_IDS_BY_COUNTRY, ALL_COMPETITION_IDS } from "@/app/lib/data/competitionIds";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();

  const SEASONS = [2024, 2025];
  let inserted = 0;
  let updated = 0;

  try {
    // Load all teams from Supabase
    const { data: teams, error } = await supabase
      .from("teams")
      .select("id, competition_id");

    if (error) {
      return NextResponse.json({ error: "DB teams error", details: error }, { status: 500 });
    }

    for (const team of teams) {

      for (const season of SEASONS) {
        const api = await fetchApi("teams/statistics", {
          team: team.id,
          season,
          league: team.competition_id,
        });
        console.log("API RAW RESPONSE:", api);

        const stats = api.response;
        console.log("STATS EXTRACTED:", stats);
        if (!stats) continue;

        const payload = {
          team_id: team.id,
          competition_id: team.competition_id,
          season_from: season,
          season_to: season,
          sample_size: stats.fixtures?.played?.total || 0,

          win_rate: stats.fixtures?.wins?.total || 0,
          draw_rate: stats.fixtures?.draws?.total || 0,
          loss_rate: stats.fixtures?.loses?.total || 0,

          btts_yes: stats.goals?.for?.total?.btts || 0,
          btts_no: stats.goals?.against?.total?.btts || 0,
          btts_percent: stats.goals?.for?.percentage?.btts || 0,

          over_0_5: stats.goals?.for?.total?.over_05 || 0,
          over_1_5: stats.goals?.for?.total?.over_15 || 0,
          over_2_5: stats.goals?.for?.total?.over_25 || 0,
          over_3_5: stats.goals?.for?.total?.over_35 || 0,
          over_4_5: stats.goals?.for?.total?.over_45 || 0,
          over_5_5: stats.goals?.for?.total?.over_55 || 0,

          under_0_5: stats.goals?.against?.total?.under_05 || 0,
          under_1_5: stats.goals?.against?.total?.under_15 || 0,
          under_2_5: stats.goals?.against?.total?.under_25 || 0,
          under_3_5: stats.goals?.against?.total?.under_35 || 0,
          under_4_5: stats.goals?.against?.total?.under_45 || 0,
          under_5_5: stats.goals?.against?.total?.under_55 || 0,

          clean_sheet: stats.clean_sheet?.total || 0,
          failed_to_score: stats.failed_to_score?.total || 0,

          streak_wins: stats.biggest?.streak?.wins || 0,
          streak_losses: stats.biggest?.streak?.loses || 0,
          streak_btts: stats.biggest?.streak?.btts || 0,
          streak_over_2_5: stats.biggest?.streak?.over25 || 0,

          ht_win_rate: stats.halftime?.wins || 0,
          ht_draw_rate: stats.halftime?.draws || 0,
          ht_loss_rate: stats.halftime?.loses || 0,

          ht_over_1_5: stats.halftime?.goals?.over15 || 0,
          ht_btts: stats.halftime?.btts || 0,

          corners_avg: stats.corners?.total || 0,
          corners_over_8_5: stats.corners?.over_85 || 0,
          corners_over_9_5: stats.corners?.over_95 || 0,
          corners_over_10_5: stats.corners?.over_105 || 0,

          raw_json: stats,
        };

        const { error: upsertError } = await supabase
          .from("team_stats")
          .upsert(payload, {
            onConflict: "team_id,competition_id,season_from",
          });

        if (upsertError) continue;
        inserted++;
      }
    }

    return NextResponse.json({ ok: true, inserted, updated });
  } catch (err: any) {
    return NextResponse.json({ error: true, details: err.message });
  }
}
