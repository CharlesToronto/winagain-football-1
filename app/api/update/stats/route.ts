import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchApi } from "@/lib/football";
import { COMPETITION_IDS_BY_COUNTRY, ALL_COMPETITION_IDS } from "@/app/lib/data/competitionIds";
import { shouldRefresh, updateRefresh } from "@/lib/cache";

const SEASONS = [2024, 2025];
const CACHE_KEY = "stats-all";
const TTL_MINUTES = 15; // match stats do not move often

export async function GET() {
  const supabase = createClient();

  // ========== CACHE CHECK ==========
  const allowRefresh = await shouldRefresh(CACHE_KEY, TTL_MINUTES);
  if (!allowRefresh) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Cache active",
    });
  }

  let inserted = 0;
  let updated = 0;
  const errors: any[] = [];

  for (const compId of ALL_COMPETITION_IDS) {
    for (const season of SEASONS) {
      try {
        const fixtures = await fetchApi("fixtures", {
          league: compId,
          season,
        });

        if (!fixtures?.response) continue;

        for (const fx of fixtures.response) {
          const fixtureId = fx.fixture?.id;
          if (!fixtureId) continue;

          // Fetch statistics for each fixture
          const statsData = await fetchApi("fixtures/statistics", {
            fixture: fixtureId,
          });

          if (!statsData?.response) continue;

          for (const entry of statsData.response) {
            const team = entry.team;
            const stats = entry.statistics || [];

            for (const s of stats) {
              const type = s.type;
              const value = s.value;

              const { data: existing } = await supabase
                .from("team_stats")
                .select("id")
                .eq("fixture_id", fixtureId)
                .eq("team_id", team.id)
                .eq("type", type)
                .maybeSingle();

              const { error } = await supabase.from("team_stats").upsert({
                fixture_id: fixtureId,
                league_id: compId,
                season,
                team_id: team.id,
                type,
                value,
                updated_at: new Date().toISOString(),
              });

              if (error) {
                errors.push({
                  fixtureId,
                  compId,
                  season,
                  error,
                });
              } else {
                if (existing) updated++;
                else inserted++;
              }
            }
          }
        }
      } catch (err: any) {
        errors.push({
          compId,
          season,
          error: err.message,
        });
      }
    }
  }

  await updateRefresh(CACHE_KEY);

  return NextResponse.json({
    ok: true,
    competitions: ALL_COMPETITION_IDS.length,
    seasons: SEASONS,
    inserted,
    updated,
    errors: errors.length,
    details: errors,
  });
}
