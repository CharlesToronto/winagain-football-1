import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function parseLimit(raw: string | null) {
  if (!raw) return 50;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(500, Math.round(value)));
}

export async function GET(req: Request) {
  const supabase = createClient();
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"));

  const { data, error } = await supabase
    .from("app_fixture_update_reports")
    .select(
      "id,job_name,source,status,started_at,finished_at,duration_ms,payload,error,created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rows: data ?? [] });
}
