import { NextResponse } from "next/server";
import { apiFootball } from "@/lib/apiFootball";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const leagueId = params.id;
    const url = new URL(req.url);
    const season = url.searchParams.get("season") || "2025";

    const data = await apiFootball(`standings?league=${leagueId}&season=${season}`);
    const resp = data?.response ?? [];

    const table = resp?.[0]?.league?.standings?.[0] ?? [];

    const normalized = table.map((row: any) => ({
      rank: row.rank,
      teamId: row.team.id,
      teamName: row.team.name,
      teamLogo: row.team.logo,
      played: row.all.played,
      win: row.all.win,
      draw: row.all.draw,
      lose: row.all.lose,
      points: row.points,
      goalsDiff: row.goalsDiff
    }));

    return NextResponse.json(normalized);
  } catch (e) {
    console.error("ERROR /standings", e);
    return NextResponse.json([], { status: 200 });
  }
}
