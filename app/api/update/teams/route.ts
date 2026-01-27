import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchApi } from "@/lib/football";
import { COMPETITION_IDS_BY_COUNTRY, ALL_COMPETITION_IDS } from "@/app/lib/data/competitionIds";

export const dynamic = "force-dynamic";

const SEASONS = [2024, 2025];

export async function GET() {
  const supabase = createClient();

  let inserted = 0;
  let updated = 0;
  const errors: any[] = [];

  for (const leagueId of ALL_COMPETITION_IDS) {
    for (const season of SEASONS) {
      try {
        const data = await fetchApi("teams", {
          league: leagueId,
          season,
        });

        if (!data?.response) continue;

        for (const item of data.response) {
          const team = item.team;

          const { data: existing, error: selectError } = await supabase
            .from("teams")
            .select("id")
            .eq("id", team.id)
            .maybeSingle();

          if (selectError) {
            errors.push({
              leagueId,
              season,
              teamId: team.id,
              error: selectError.message,
            });
            continue;
          }

          const { error: upsertError } = await supabase.from("teams").upsert({
            id: team.id,
            name: team.name,
            country: team.country,
            logo: team.logo,
            competition_id: leagueId,
            is_active: true,
          });

          if (upsertError) {
            errors.push({
              leagueId,
              season,
              teamId: team.id,
              error: upsertError.message,
            });
          } else {
            if (existing) updated++;
            else inserted++;
          }
        }
      } catch (e: any) {
        errors.push({
          leagueId,
          season,
          error: e?.message ?? String(e),
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    totalCompetitions: ALL_COMPETITION_IDS.length,
    seasons: SEASONS,
    inserted,
    updated,
    errorCount: errors.length,
    errors,
  });
}
