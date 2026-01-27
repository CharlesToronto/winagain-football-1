import { createClient } from "@/lib/supabase/server";

export async function getTeamStats(teamId: number | string, season?: number | string) {
  const supabase = createClient();
  let query = supabase.from("team_stats").select("*").eq("team_id", Number(teamId));

  if (season) {
    query = query.eq("season_from", season);
  }

  const { data } = await query;
  return data ?? [];
}
