export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchApi } from "@/lib/football";

export async function GET() {
  const supabase = createClient();

  try {
    const { data: competitions, error: compErr } = await supabase
      .from("competitions")
      .select("*");

    if (compErr || !competitions || competitions.length === 0) {
      return NextResponse.json({ error: "No competitions in DB" }, { status: 400 });
    }

    const { data: existingTeams, error: existingErr } = await supabase.from("teams").select("id");
    if (existingErr) throw existingErr;

    const existingIds = new Set((existingTeams ?? []).map((t: any) => t.id));
    let inserted = 0;
    let updated = 0;

    for (const competition of competitions) {
      for (const season of [2024, 2025]) {
        const teamsResponse = await fetchApi(`teams`, {
          league: competition.id,
          season,
        });
        const teams = teamsResponse?.response || [];
        if (!teams || teams.length === 0) continue;

        for (const entry of teams) {
          const team = entry.team;
          const country = team?.country ?? entry?.country ?? null;

          const payload = {
            id: team?.id,
            name: team?.name,
            country,
            logo: team?.logo,
            competition_id: competition.id
          };

          if (!payload.id || !payload.name) continue;

          const wasExisting = existingIds.has(payload.id);

          const { error: upsertError } = await supabase
            .from("teams")
            .upsert(payload, { onConflict: "id" });

          if (!upsertError) {
            if (wasExisting) {
              updated++;
            } else {
              inserted++;
              existingIds.add(payload.id);
            }
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      competitions: competitions.length,
      teamsInserted: inserted,
      teamsUpdated: updated
    });
  } catch (e: any) {
    console.error("❌ import-teams error", e);
    return NextResponse.json({ error: e?.message ?? "Failed to import teams" }, { status: 500 });
  }
}
