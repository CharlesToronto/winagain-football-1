import { NextResponse } from "next/server";
import { apiFootball } from "@/lib/apiFootball";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const team = params.id;

    if (!team) {
      return NextResponse.json({ error: "Missing team" }, { status: 400 });
    }

    // Endpoint dédié aux 5 derniers matchs
    const data = await apiFootball(`fixtures?team=${team}&last=5`);
    const fixtures = data?.response ?? [];

    const form = fixtures
      .filter((fx: any) => {
        const homeId = fx?.teams?.home?.id;
        const awayId = fx?.teams?.away?.id;
        return String(homeId) === String(team) || String(awayId) === String(team);
      })
      .map((fx: any) => {
        const isHome = String(fx?.teams?.home?.id) === String(team);
        const homeWinner = fx?.teams?.home?.winner === true;
        const awayWinner = fx?.teams?.away?.winner === true;
        const homeGoals = fx?.goals?.home;
        const awayGoals = fx?.goals?.away;

        if (homeWinner) return isHome ? "W" : "L";
        if (awayWinner) return isHome ? "L" : "W";
        if (typeof homeGoals === "number" && typeof awayGoals === "number") {
          if (homeGoals === awayGoals) return "D";
          return homeGoals > awayGoals ? (isHome ? "W" : "L") : (isHome ? "L" : "W");
        }
        return "D";
      });

    return NextResponse.json(form);
  } catch (e) {
    return NextResponse.json({ error: "Failed to load form" }, { status: 500 });
  }
}
