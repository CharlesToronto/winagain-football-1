import { NextResponse } from "next/server";
import { apiFootball } from "@/lib/apiFootball";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const team = url.searchParams.get("team");
    const league = url.searchParams.get("league");
    const season = url.searchParams.get("season") || "2025";

    if (!team || !league) {
      return NextResponse.json({ error: "Missing team or league" }, { status: 400 });
    }

    const data = await apiFootball(`teams/statistics?league=${league}&team=${team}&season=${season}`);
    const resp = data?.response ?? {};

    return NextResponse.json(resp);
  } catch (e) {
    console.error("❌ FAILED /api/stats:", e);
    return NextResponse.json({ error: "Failed to load statistics" }, { status: 500 });
  }
}
