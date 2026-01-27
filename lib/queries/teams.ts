import { createClient } from "@/lib/supabase/server";

export async function getTeam(teamId: number | string) {
  const supabase = createClient();
  const { data } = await supabase.from("teams").select("*").eq("id", Number(teamId));
  return data ?? [];
}

export async function getTeamsByLeague(leagueId: number | string) {
  const supabase = createClient();
  const { data } = await supabase.from("teams").select("*").eq("competition_id", Number(leagueId));
  return data ?? [];
}
