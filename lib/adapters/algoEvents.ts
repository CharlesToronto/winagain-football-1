import { supabase } from "@/lib/supabase/client";

const EVENTS_TABLE = "algo_events";
const ANON_USER_ID = "00000000-0000-0000-0000-000000000000";

type AlgoEventInput = {
  eventType: string;
  teamId?: number | null;
  leagueId?: number | null;
  payload?: Record<string, any> | null;
};

function isMissingTableError(error: any, table: string) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes(`relation \"${table}\"`) && message.includes("does not exist");
}

async function getUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? ANON_USER_ID;
}

export async function logAlgoEvent({
  eventType,
  teamId,
  leagueId,
  payload,
}: AlgoEventInput): Promise<void> {
  try {
    const userId = await getUserId();
    const { error } = await supabase.from(EVENTS_TABLE).insert({
      user_id: userId,
      event_type: eventType,
      team_id: Number.isFinite(teamId) ? teamId : null,
      league_id: Number.isFinite(leagueId) ? leagueId : null,
      payload: payload ?? null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      if (isMissingTableError(error, EVENTS_TABLE)) return;
      throw new Error(error.message);
    }
  } catch {
    // Ignore logging errors to avoid blocking UX
  }
}
