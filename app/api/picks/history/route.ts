import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function formatDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function GET(request: Request) {
  const supabase = createClient();
  try {
    const url = new URL(request.url);
    const daysParam = Number(url.searchParams.get("days") ?? "30");
    const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30;
    const criteria = url.searchParams.get("criteria") ?? "all";
    const market = url.searchParams.get("market") ?? "all";

    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromKey = formatDateKey(from);

    let query = supabase
      .from("daily_algo_picks")
      .select("*")
      .gte("snapshot_date", fromKey)
      .order("fixture_date_utc", { ascending: true });

    if (criteria === "rose") {
      query = query.eq("meets_criteria", true);
    } else if (criteria === "yellow") {
      query = query.eq("meets_criteria", false);
    }

    if (market === "over_under") {
      query = query.eq("market", "over_under");
    } else if (market === "double_chance") {
      query = query.eq("market", "double_chance");
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: true, details: err?.message ?? "History error" },
      { status: 500 }
    );
  }
}
