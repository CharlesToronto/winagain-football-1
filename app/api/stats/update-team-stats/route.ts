import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Compute EA Stats for all teams:
 * - Form last 5
 * - Avg goals for / against
 * - Home / away performance
 * - Clean sheet rate
 * - EA index (WinAgain custom rating)
 */
export async function GET() {
  try {
    const supabase = createClient();

    // Load all teams
    const { data: teams, error: teamsErr } = await supabase
      .from("teams")
      .select("id, name");

    if (teamsErr) {
      console.error("Teams error", teamsErr);
      return NextResponse.json({ error: "Cannot load teams" }, { status: 500 });
    }

    // Load all fixtures
    const { data: fixtures, error: fixturesErr } = await supabase
      .from("fixtures")
      .select(
        "id,home_team_id,away_team_id,status_short,goals_home,goals_away,date_utc"
      );

    if (fixturesErr) {
      console.error("Fixtures error", fixturesErr);
      return NextResponse.json({ error: "Cannot load fixtures" }, { status: 500 });
    }

    const fixturesByTeam: Record<number, any[]> = {};

    // Group fixtures by team
    for (const fx of fixtures ?? []) {
      const homeId = Number((fx as any).home_team_id);
      const awayId = Number((fx as any).away_team_id);
      if (!Number.isFinite(homeId) || !Number.isFinite(awayId)) continue;

      if (!fixturesByTeam[homeId]) fixturesByTeam[homeId] = [];
      if (!fixturesByTeam[awayId]) fixturesByTeam[awayId] = [];

      fixturesByTeam[homeId].push({
        isHome: true,
        goalsFor: (fx as any).goals_home,
        goalsAgainst: (fx as any).goals_away,
        status: (fx as any).status_short,
        date: (fx as any).date_utc,
      });

      fixturesByTeam[awayId].push({
        isHome: false,
        goalsFor: (fx as any).goals_away,
        goalsAgainst: (fx as any).goals_home,
        status: (fx as any).status_short,
        date: (fx as any).date_utc,
      });
    }

    let updated = 0;

    for (const team of teams ?? []) {
      const list = fixturesByTeam[team.id] || [];

      // Only finished matches count for stats
      const finished = list.filter((m: any) =>
        ["FT", "AET", "PEN"].includes(m.status)
      );

      // Sort by date DESC
      finished.sort(
        (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      // Last 5 matches
      const last5 = finished.slice(0, 5);

      const formStrings = last5.map((m: any) => {
        if (m.goalsFor > m.goalsAgainst) return "W";
        if (m.goalsFor < m.goalsAgainst) return "L";
        return "D";
      });

      const avg = (arr: number[]) =>
        arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

      const avgGF = avg(finished.map((m: any) => m.goalsFor));
      const avgGA = avg(finished.map((m: any) => m.goalsAgainst));

      const home = finished.filter((m: any) => m.isHome);
      const away = finished.filter((m: any) => !m.isHome);

      const homeAvgGF = avg(home.map((m: any) => m.goalsFor));
      const homeAvgGA = avg(home.map((m: any) => m.goalsAgainst));

      const awayAvgGF = avg(away.map((m: any) => m.goalsFor));
      const awayAvgGA = avg(away.map((m: any) => m.goalsAgainst));

      const cleanSheets =
        finished.filter((m: any) => m.goalsAgainst === 0).length /
        (finished.length || 1);

      // EA Index: quick formula combining main stats
      const eaIndex =
        avgGF * 0.35 +
        (1 - avgGA) * 0.25 +
        cleanSheets * 0.20 +
        (formStrings.filter((x) => x === "W").length / 5) * 0.20;

      // Save stats
      await supabase.from("team_stats").upsert(
        {
          team_id: team.id,
          updated_at: new Date().toISOString(),
          form_last5: formStrings.join(""),
          avg_goals_for: avgGF,
          avg_goals_against: avgGA,
          clean_sheet_rate: cleanSheets,
          home_avg_goals_for: homeAvgGF,
          home_avg_goals_against: homeAvgGA,
          away_avg_goals_for: awayAvgGF,
          away_avg_goals_against: awayAvgGA,
          ea_index: eaIndex,
        },
        { onConflict: "team_id" }
      );

      updated++;
    }

    return NextResponse.json({ ok: true, updated });
  } catch (e: any) {
    console.error("EA Stats error", e);
    return NextResponse.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}
