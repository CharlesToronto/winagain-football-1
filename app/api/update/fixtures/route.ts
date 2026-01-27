import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchApi } from "@/lib/football";
import { ALL_COMPETITION_IDS } from "@/app/lib/data/competitionIds";

export const dynamic = "force-dynamic";

const SEASON = 2025;

export async function GET() {
  const startedAt = Date.now();
  const supabase = createClient();

  let apiFixtures = 0;
  let checked = 0; // fixtures trouvées en base et comparées
  let updated = 0;
  let ignored = 0; // fixtures API sans ligne en base ou sans id
  const errors: any[] = [];

  for (const leagueId of ALL_COMPETITION_IDS) {
    try {
      const apiData = await fetchApi("fixtures", {
        league: leagueId,
        season: SEASON,
        status: "FT",
      });

      const fixturesApi = apiData?.response ?? [];
      apiFixtures += fixturesApi.length ?? 0;

      for (const fx of fixturesApi) {
        const id = fx?.fixture?.id;
        if (!id) {
          ignored++;
          continue;
        }

        const { data: existing, error: selectError } = await supabase
          .from("fixtures")
          .select(
            "id,status_short,status_long,goals_home,goals_away,goals_home_ht,goals_away_ht,round,date_utc"
          )
          .eq("id", id)
          .maybeSingle();

        if (selectError) {
          errors.push({ fixtureId: id, leagueId, error: selectError.message });
          continue;
        }

        if (!existing) {
          ignored++;
          continue; // on ne crée pas de nouvelle ligne
        }

        checked++;

        const nextFields = {
          status_short: fx.fixture?.status?.short ?? null,
          status_long: fx.fixture?.status?.long ?? null,
          goals_home: fx.goals?.home ?? null,
          goals_away: fx.goals?.away ?? null,
          goals_home_ht: fx.score?.halftime?.home ?? null,
          goals_away_ht: fx.score?.halftime?.away ?? null,
          round: fx.league?.round ?? null,
          date_utc: fx.fixture?.date ?? null,
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

        if (!changed) {
          continue;
        }

        const { error: updateError } = await supabase
          .from("fixtures")
          .update(nextFields)
          .eq("id", id);

        if (updateError) {
          errors.push({ fixtureId: id, leagueId, error: updateError.message });
        } else {
          updated++;
        }
      }
    } catch (err: any) {
      errors.push({ leagueId, error: err?.message ?? String(err) });
    }
  }

  const durationMs = Date.now() - startedAt;

  return NextResponse.json({
    ok: errors.length === 0,
    mode: "REFRESH_STATUS_SEASON_2025_API_FIRST",
    season: SEASON,
    leagues: ALL_COMPETITION_IDS.length,
    apiFixtures,
    checked,
    updated,
    ignored,
    errorCount: errors.length,
    errors,
    durationMs,
  });
}
