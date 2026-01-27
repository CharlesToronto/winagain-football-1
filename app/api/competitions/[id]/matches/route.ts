import { NextResponse } from "next/server";
import { apiFootball } from "@/lib/apiFootball";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const leagueId = params.id;
    const url = new URL(req.url);
    const season = url.searchParams.get("season") || "2025";

    const data = await apiFootball(`fixtures?league=${leagueId}&season=${season}`);
    const fixtures = data?.response ?? [];

    const normalized = fixtures.map((fx: any) => {
      const d = new Date(fx.fixture.date);

      return {
        id: fx.fixture.id,
        round: fx.league.round || "",
        status: fx.fixture.status.short,
        timestamp: fx.fixture.timestamp,
        date: d.toLocaleDateString(),
        time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),

        homeTeam: {
          id: fx.teams.home.id,
          name: fx.teams.home.name,
          logo: fx.teams.home.logo
        },

        awayTeam: {
          id: fx.teams.away.id,
          name: fx.teams.away.name,
          logo: fx.teams.away.logo
        }
      };
    });

    return NextResponse.json(normalized);
  } catch (e) {
    console.error("ERROR /matches", e);
    return NextResponse.json([], { status: 200 });
  }
}
