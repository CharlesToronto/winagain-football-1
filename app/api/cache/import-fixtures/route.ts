export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchFixtures, getCompetitions } from "@/lib/football";

type NormalizedFixture = {
  id: number;
  competition_id: number;
  season: number | string | null;
  date: string | null;
  timestamp: number | null;
  status: string;
  round: string;
  home_id: number | null;
  home_name: string | null;
  home_logo: string | null;
  away_id: number | null;
  away_name: string | null;
  away_logo: string | null;
  goals_home: number | null;
  goals_away: number | null;
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

          const normalized: NormalizedFixture = {
            id: fixture.id,
            competition_id: Number(competition.id),
            season: league.season ?? season,
            date: fixture.date ?? null,
            timestamp: fixture.timestamp ?? null,
            status: fixture.status?.short ?? "",
            round: league.round ?? "",
            home_id: teams.home?.id ?? null,
            home_name: teams.home?.name ?? null,
            home_logo: teams.home?.logo ?? null,
            away_id: teams.away?.id ?? null,
            away_name: teams.away?.name ?? null,
            away_logo: teams.away?.logo ?? null,
            goals_home: goals.home ?? null,
            goals_away: goals.away ?? null
          };

          if (normalized.id) {
            allFixtures.push(normalized);
          }
        }
      }

      if (allFixtures.length === 0) continue;

      const sorted = allFixtures.sort((a, b) => {
        const aTime = a.timestamp ?? new Date(a.date ?? 0).getTime();
        const bTime = b.timestamp ?? new Date(b.date ?? 0).getTime();
        return bTime - aTime;
      });

      const kept: NormalizedFixture[] = [];
      const teamCounts = new Map<number, number>();

      for (const fx of sorted) {
        const homeId = fx.home_id ?? undefined;
        const awayId = fx.away_id ?? undefined;
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
