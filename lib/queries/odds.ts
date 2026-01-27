import { createClient } from "@/lib/supabase/server";

export async function getOddsForFixture(fixtureId: number | string) {
  const supabase = createClient();
  const { data } = await supabase.from("fixture_odds").select("*").eq("fixture_id", Number(fixtureId));
  return data ?? [];
}
