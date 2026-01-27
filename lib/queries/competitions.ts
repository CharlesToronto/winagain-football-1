import { createClient } from "@/lib/supabase/server";

export async function getCompetitions() {
  const supabase = createClient();
  const { data } = await supabase.from("competitions").select("*");
  return data ?? [];
}
