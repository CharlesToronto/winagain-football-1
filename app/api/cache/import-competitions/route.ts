export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCompetitionList } from "@/lib/football";

export async function GET() {
  const supabase = createClient();

  try {
    const competitions = await getCompetitionList();

    const { error: wipeError } = await supabase.from("competitions").delete().neq("id", 0);
    if (wipeError) {
      throw wipeError;
    }

    if (competitions.length > 0) {
      const { error: insertError } = await supabase.from("competitions").insert(competitions);
      if (insertError) {
        throw insertError;
      }
    }

    return NextResponse.json({
      ok: true,
      competitionsInserted: competitions.length
    });
  } catch (e: any) {
    console.error("❌ import-competitions error", e);
    return NextResponse.json({ error: e?.message ?? "Failed to import competitions" }, { status: 500 });
  }
}
