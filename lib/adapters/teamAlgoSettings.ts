import { supabase } from "@/lib/supabase/client";
import {
  AlgoSettings,
  normalizeAlgoSettings,
} from "@/lib/analysisEngine/overUnderModel";

const SETTINGS_TABLE = "team_algo_settings";
const ANON_USER_ID = "00000000-0000-0000-0000-000000000000";

function isMissingTableError(error: any, table: string) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes(`relation "${table}"`) && message.includes("does not exist");
}

async function getUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? ANON_USER_ID;
}

export async function fetchTeamAlgoSettings(teamId: number): Promise<AlgoSettings | null> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .select("settings")
    .eq("user_id", userId)
    .eq("team_id", teamId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error, SETTINGS_TABLE)) {
      return null;
    }
    throw new Error(error.message);
  }

  if (!data?.settings) return null;
  return normalizeAlgoSettings(data.settings as Partial<AlgoSettings>);
}

export async function upsertTeamAlgoSettings(
  teamId: number,
  settings: AlgoSettings
): Promise<void> {
  const userId = await getUserId();
  const { error } = await supabase
    .from(SETTINGS_TABLE)
    .upsert(
      {
        user_id: userId,
        team_id: teamId,
        settings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,team_id" }
    );

  if (error) {
    if (isMissingTableError(error, SETTINGS_TABLE)) {
      return;
    }
    throw new Error(error.message);
  }
}
