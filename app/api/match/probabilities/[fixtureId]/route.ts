import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const factorial = (n: number): number => {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
};

const poisson = (x: number, k: number) => {
  return (Math.pow(x, k) * Math.exp(-x)) / factorial(k);
};

/**
 * Compute match probabilities for a specific fixtureId using:
 * - EA Stats (team_stats)
 * - Modified Poisson model
 * - Expected Goals based on attack/defense strength
 */
export async function GET(
  _req: Request,
  context: { params: { fixtureId: string } }
) {
  try {
    const fixtureId = Number(context.params.fixtureId);
    const supabase = createClient();

    // Load fixture data
    const { data: fixture, error: fxErr } = await supabase
      .from("fixtures")
      .select("*")
      .eq("id", fixtureId)
      .maybeSingle();

    if (fxErr || !fixture) {
      return NextResponse.json({ error: "Fixture not found" }, { status: 404 });
    }

    const homeId = fixture.home_id;
    const awayId = fixture.away_id;

    // Load EA team stats
    const { data: homeStats, error: hErr } = await supabase
      .from("team_stats")
      .select("*")
      .eq("team_id", homeId)
      .maybeSingle();

    const { data: awayStats, error: aErr } = await supabase
      .from("team_stats")
      .select("*")
      .eq("team_id", awayId)
      .maybeSingle();

    if (hErr || aErr || !homeStats || !awayStats) {
      return NextResponse.json({ error: "Missing team stats" }, { status: 500 });
    }

    // Build attack & defense ratings
    const attackHome = homeStats.avg_goals_for * (homeStats.ea_index + 1);
    const attackAway = awayStats.avg_goals_for * (awayStats.ea_index + 1);

    const defenseHome = homeStats.avg_goals_against * (2 - homeStats.clean_sheet_rate);
    const defenseAway = awayStats.avg_goals_against * (2 - awayStats.clean_sheet_rate);

    // Expected Goals
    const xGF_home = Math.max(0.1, attackHome * defenseAway);
    const xGF_away = Math.max(0.1, attackAway * defenseHome);

    // Compute match matrix (0 to 5 goals)
    const maxGoals = 5;
    const matrix: number[][] = [];

    for (let i = 0; i <= maxGoals; i++) {
      matrix[i] = [];
      for (let j = 0; j <= maxGoals; j++) {
        matrix[i][j] = poisson(xGF_home, i) * poisson(xGF_away, j);
      }
    }

    // Compute probabilities
    let homeWin = 0;
    let draw = 0;
    let awayWin = 0;
    let btts = 0;
    let over25 = 0;

    for (let i = 0; i <= maxGoals; i++) {
      for (let j = 0; j <= maxGoals; j++) {
        const p = matrix[i][j];

        if (i > j) homeWin += p;
        else if (i === j) draw += p;
        else awayWin += p;

        if (i > 0 && j > 0) btts += p;
        if (i + j >= 3) over25 += p;
      }
    }

    return NextResponse.json({
      ok: true,
      fixtureId,
      xGF_home,
      xGF_away,
      probabilities: {
        homeWin,
        draw,
        awayWin,
        btts,
        over25,
      },
    });
  } catch (e: any) {
    console.error("❌ Probability error", e);
    return NextResponse.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}
