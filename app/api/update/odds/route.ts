import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchApi } from "@/lib/football";
import { ALL_COMPETITION_IDS } from "@/app/lib/data/competitionIds";

export const dynamic = "force-dynamic";

const DEFAULT_SEASON = 2025;

export async function GET(request: Request) {
  const supabase = createClient();

  try {
    const url = new URL(request.url);
    const seasonParam = Number(url.searchParams.get("season"));
    const season = Number.isFinite(seasonParam) ? seasonParam : DEFAULT_SEASON;
    const leagueParam = Number(url.searchParams.get("league"));
    const leagues = Number.isFinite(leagueParam) ? [leagueParam] : ALL_COMPETITION_IDS;

    let upserted = 0;
    let fixturesProcessed = 0;
    let leaguesProcessed = 0;

    for (const leagueId of leagues) {
      if (!Number.isFinite(leagueId)) continue;
      leaguesProcessed += 1;

      let page = 1;
      let totalPages = 1;

      do {
        const api = await fetchApi("odds", {
          league: leagueId,
          season,
          page,
        });

        totalPages = Number(api?.paging?.total ?? 1);
        const fixtures = api?.response ?? [];

        for (const fixture of fixtures) {
          const fixtureId = fixture?.fixture?.id;
          if (!fixtureId) continue;
          fixturesProcessed += 1;

          const fixtureUpdate = fixture?.update ?? null;
          const bookmakers = fixture?.bookmakers ?? [];

          for (const bm of bookmakers) {
            const bookmakerUpdate = bm?.update ?? fixtureUpdate ?? null;
            const bets = bm?.bets ?? [];

            for (const bet of bets) {
              const marketId = bet?.id ?? null;
              const marketName = bet?.name ?? null;
              if (!marketId || !marketName) continue;

              const values = bet?.values ?? [];
              for (const entry of values) {
                const label = entry?.value ?? null;
                const oddValue = Number(entry?.odd ?? entry?.odds ?? null);
                if (!label || !Number.isFinite(oddValue)) continue;

                const updateTime =
                  entry?.updated_at ?? entry?.update ?? bookmakerUpdate ?? fixtureUpdate ?? null;

                const { error: upsertError } = await supabase
                  .from("fixture_odds")
                  .upsert(
                    {
                      fixture_id: fixtureId,
                      league_id: leagueId,
                      season,
                      market_id: marketId,
                      market_name: marketName,
                      bookmaker_id: bm?.id ?? null,
                      bookmaker_name: bm?.name ?? null,
                      label,
                      value: oddValue,
                      update_time: updateTime,
                    },
                    {
                      onConflict: "fixture_id, market_id, bookmaker_id, label",
                    }
                  );

                if (!upsertError) upserted += 1;
              }
            }
          }
        }

        page += 1;
      } while (page <= totalPages);
    }

    return NextResponse.json({
      ok: true,
      season,
      leagues: leaguesProcessed,
      fixtures: fixturesProcessed,
      upserted,
    });
  } catch (err: any) {
    return NextResponse.json({ error: true, details: err.message });
  }
}
