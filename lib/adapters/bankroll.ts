import { supabase } from "@/lib/supabase/client";
import { Bet } from "@/app/bankroll/utils/bankroll";

const ANON_USER_ID = "00000000-0000-0000-0000-000000000000";
const SETTINGS_TABLE = "bankroll_settings";

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

export async function fetchBankrollBets(): Promise<Bet[]> {
  const userId = await getUserId();

  const { data, error } = await supabase
    .from("bankroll_bets")
    .select("*")
    .eq("user_id", userId)
    .order("bet_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as Bet[];
}

export async function fetchBankrollSettings(): Promise<number | null> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .select("starting_capital")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error, SETTINGS_TABLE)) {
      return null;
    }
    throw new Error(error.message);
  }

  if (!data || data.starting_capital == null) return null;
  const numeric = Number(data.starting_capital);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function upsertBankrollSettings(startingCapital: number): Promise<void> {
  const userId = await getUserId();
  const { error } = await supabase
    .from(SETTINGS_TABLE)
    .upsert(
      {
        user_id: userId,
        starting_capital: startingCapital,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  if (error) {
    throw new Error(error.message);
  }
}

export async function upsertBankrollBets(bets: Bet[]): Promise<void> {
  const userId = await getUserId();
  const payload = bets.map((bet) => ({
    ...bet,
    user_id: bet.user_id ?? userId,
  }));
  const { error } = await supabase
    .from("bankroll_bets")
    .upsert(payload, { onConflict: "id" });
  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteBankrollBet(id: string): Promise<void> {
  const userId = await getUserId();
  const { error } = await supabase
    .from("bankroll_bets")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) {
    throw new Error(error.message);
  }
}
