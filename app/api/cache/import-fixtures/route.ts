export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchFixtures, getCompetitions } from "@/lib/football";

type NormalizedFixture = {
  id: number;
  competition_id: number;
  season: number | string | null;
  date_utc: string | null;
  status_short: string | null;
  status_long: string | null;
  round: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  goals_home: number | null;
  goals_away: number | null;
  goals_home_ht: number | null;
  goals_away_ht: number | null;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function GET() {
  const supabase = createClient();

  try {
    const competitions = await getCompetitions();

    if (!competitions || competitions.length === 0) {
      return NextResponse.json({ error: "No competitions found" }, { status: 400 });
    }

    const { data: existingFixtures, error: existingErr } = await supabase.from("fixtures").select("id");
    if (existingErr) throw existingErr;
    const existingIds = new Set((existingFixtures ?? []).map((f: any) => f.id));

    let inserted = 0;
    let updated = 0;

    for (const competition of competitions) {
      const seasons = [2024, 2025];
      const allFixtures: NormalizedFixture[] = [];

      for (const season of seasons) {
        const fixtures = await fetchFixtures({ league: Number(competition.id), season });
        if (!fixtures || fixtures.length === 0) continue;

        for (const f of fixtures) {
          const fixture = f.fixture ?? {};
          const league = f.league ?? {};
          const teams = f.teams ?? {};
          const goals = f.goals ?? {};
          const score = f.score ?? {};

          const normalized: NormalizedFixture = {
            id: fixture.id,
            competition_id: Number(competition.id),
            season: league.season ?? season,
            date_utc: fixture.date ?? null,
            status_short: fixture.status?.short ?? null,
            status_long: fixture.status?.long ?? null,
            round: league.round ?? null,
            home_team_id: teams.home?.id ?? null,
            away_team_id: teams.away?.id ?? null,
            goals_home: goals.home ?? null,
            goals_away: goals.away ?? null,
            goals_home_ht: score?.halftime?.home ?? null,
            goals_away_ht: score?.halftime?.away ?? null,
          };

          if (normalized.id) {
            allFixtures.push(normalized);
          }
        }
      }

      if (allFixtures.length === 0) continue;

      const sorted = allFixtures.sort((a, b) => {
        const aTime = a.date_utc ? new Date(a.date_utc).getTime() : 0;
        const bTime = b.date_utc ? new Date(b.date_utc).getTime() : 0;
        return bTime - aTime;
      });

      const kept: NormalizedFixture[] = [];
      const teamCounts = new Map<number, number>();

      for (const fx of sorted) {
        const homeId = fx.home_team_id ?? undefined;
        const awayId = fx.away_team_id ?? undefined;
        const homeCount = homeId ? teamCounts.get(homeId) || 0 : 0;
        const awayCount = awayId ? teamCounts.get(awayId) || 0 : 0;

        if (homeId && homeCount >= 50 && awayId && awayCount >= 50) continue;

        kept.push(fx);
        if (homeId) teamCounts.set(homeId, homeCount + 1);
        if (awayId) teamCounts.set(awayId, awayCount + 1);
      }

      if (kept.length === 0) continue;

      for (const batch of chunkArray(kept, 500)) {
        const { error: upsertError } = await supabase.from("fixtures").upsert(batch, { onConflict: "id" });
        if (upsertError) throw upsertError;

        for (const fx of batch) {
          const already = existingIds.has(fx.id);
          if (already) {
            updated++;
          } else {
            inserted++;
            existingIds.add(fx.id);
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      competitions: competitions.length,
      fixturesInserted: inserted,
      fixturesUpdated: updated
    });
  } catch (e: any) {
    console.error("❌ import-fixtures error", e);
    return NextResponse.json({ error: e?.message ?? "Failed to import fixtures" }, { status: 500 });
  }
}
