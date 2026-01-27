import { NextResponse, NextRequest } from "next/server";
import { apiFootball } from "@/lib/apiFootball";

export async function GET(request: NextRequest, { params }: { params: any }) {
  try {
    const team = params.id;
    const league = request.nextUrl.searchParams.get("league");
    const season = request.nextUrl.searchParams.get("season") || "2025";

    if (!team || !league) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    const data = await apiFootball(`teams/statistics?league=${league}&team=${team}&season=${season}`);

    const resp = data?.response ?? {};

    return NextResponse.json(resp);
  } catch (e) {
    return NextResponse.json({ error: "Failed to load team statistics" }, { status: 500 });
  }
}
