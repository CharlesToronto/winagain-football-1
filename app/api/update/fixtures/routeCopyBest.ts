import dayjs from "dayjs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchApi } from "@/lib/football";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();

  let checked = 0;
  let updated = 0;
  const errors: any[] = [];
  const leaguesUpdated = new Set<number>();

  const { data: fixtures, error: selectError } = await supabase
    .from("fixtures")
    .select(
      "id,competition_id,season,round,date_utc,status_short,status_long,home_team_id,away_team_id,goals_home,goals_away,is_neutral_venue"
    )
    .eq("season", 2025);

  if (selectError) {
    return NextResponse.json(
      {
        ok: false,
        mode: "REFRESH_STATUS_SEASON_2025",
        checked: 0,
        updated: 0,
        errorCount: 1,
        errors: [{ error: selectError.message }],
      },
      { status: 500 }
    );
  }

  for (const fixture of fixtures ?? []) {
    checked++;

    try {
      const apiData = await fetchApi("fixtures", {
        id: fixture.id,
        league: fixture.competition_id ?? undefined,
      });
      const apiFixture = apiData?.response?.[0];

      if (!apiFixture?.fixture?.id) {
        errors.push({
          fixtureId: fixture.id,
          error: "No fixture data returned from API",
        });
        continue;
      }

      const newStatusShort = apiFixture?.fixture?.status?.short ?? null;
      const newStatusLong = apiFixture?.fixture?.status?.long ?? null;
      const newGoalsHome = apiFixture?.goals?.home ?? null;
      const newGoalsAway = apiFixture?.goals?.away ?? null;

      const statusChanged = fixture.status_short !== newStatusShort;
      const goalsChanged =
        fixture.goals_home !== newGoalsHome || fixture.goals_away !== newGoalsAway;

      if (!statusChanged && !goalsChanged) {
        continue;
      }

      const { error: updateError } = await supabase
        .from("fixtures")
        .update({
          status_short: newStatusShort,
          status_long: newStatusLong,
          goals_home: newGoalsHome,
          goals_away: newGoalsAway,
        })
        .eq("id", fixture.id);

      if (updateError) {
        errors.push({
          fixtureId: fixture.id,
          error: updateError.message,
        });
      } else {
        updated++;
        if (fixture.competition_id) {
          leaguesUpdated.add(fixture.competition_id);
        }
      }
    } catch (error: any) {
      errors.push({
        fixtureId: fixture.id,
        error: error?.message ?? String(error),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    mode: "REFRESH_STATUS_SEASON_2025",
    checked,
    updated,
    errorCount: errors.length,
    leaguesUpdated: Array.from(leaguesUpdated),
    errors,
  });
}
