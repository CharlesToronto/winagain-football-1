import { createClient } from "@/lib/supabase/server";

export async function shouldRefresh(key: string, ttlMinutes: number) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("meta_cache")
    .select("last_update")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    console.error("Cache error:", error);
    return true; // on ne bloque jamais en cas d’erreur
  }

  if (!data || !data.last_update) {
    return true; // jamais mis à jour → on doit rafraîchir
  }

  const last = new Date(data.last_update).getTime();
  const now = Date.now();
  const diffMinutes = (now - last) / 1000 / 60;

  return diffMinutes >= ttlMinutes;
}

export async function updateRefresh(key: string) {
  const supabase = createClient();

  await supabase.from("meta_cache").upsert({
    key,
    last_update: new Date().toISOString(),
  });
}