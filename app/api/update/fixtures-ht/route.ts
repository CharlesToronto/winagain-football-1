import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchApi } from "@/lib/football";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();

  const SEASONS = [2025];
  let checked = 0;
  let updated = 0;
  const errors: any[] = [];

  // Pagination pour couvrir toutes les fixtures FT des saisons ciblées
  const batchSize = 1000;
  let offset = 0;
  let fixtures: any[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("fixtures")
      .select("id,season,status_short,goals_home_ht,goals_away_ht")
      .in("season", SEASONS)
      .eq("status_short", "FT")
      .range(offset, offset + batchSize - 1);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          mode: "REFRESH_HT",
          checked: 0,
          updated: 0,
          errorCount: 1,
          errors: [{ error: error.message }],
        },
        { status: 500 }
      );
    }

    fixtures = fixtures.concat(data ?? []);
    if (!data || data.length < batchSize) break;
    offset += batchSize;
  }

  if (fixtures.length === 0) {
    return NextResponse.json({
      ok: true,
      mode: "REFRESH_HT",
      seasons: SEASONS,
      checked: 0,
      updated: 0,
      errorCount: 0,
      errors: [],
    });
  }

  for (const fixture of fixtures ?? []) {
    checked++;
    try {
      const apiData = await fetchApi("fixtures", { id: fixture.id });
      const apiFixture = apiData?.response?.[0];
      if (!apiFixture?.fixture?.id) {
        errors.push({ fixtureId: fixture.id, error: "No fixture data from API" });
        continue;
      }

      const newHtHome = apiFixture?.score?.halftime?.home ?? null;
      const newHtAway = apiFixture?.score?.halftime?.away ?? null;

      const changed =
        fixture.goals_home_ht !== newHtHome || fixture.goals_away_ht !== newHtAway;

      if (!changed) continue;

      const { error: updateError } = await supabase
        .from("fixtures")
        .update({
          goals_home_ht: newHtHome,
          goals_away_ht: newHtAway,
        })
        .eq("id", fixture.id);

      if (updateError) {
        errors.push({ fixtureId: fixture.id, error: updateError.message });
      } else {
        updated++;
      }
    } catch (err: any) {
      errors.push({ fixtureId: fixture.id, error: err?.message ?? String(err) });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    mode: "REFRESH_HT",
    seasons: SEASONS,
    checked,
    updated,
    errorCount: errors.length,
    errors,
  });
}
