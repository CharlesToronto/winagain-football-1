import { NextResponse, NextRequest } from "next/server";
import { apiFootball } from "@/lib/apiFootball";

export async function GET(request: NextRequest, { params }: { params: any }) {
  try {
    const team = params.id;
    const league = request.nextUrl.searchParams.get("league");

    if (!team || !league) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    const seasons = ["2025", "2024", "2023"];

    const results = await Promise.all(
      seasons.map((season) => apiFootball(`fixtures?team=${team}&league=${league}&season=${season}`))
    );

    const allMatches = results.flatMap((res: any) => res?.response ?? []);

    allMatches.sort((a: any, b: any) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime());

    return NextResponse.json(allMatches);
  } catch (e) {
    return NextResponse.json({ error: "Failed to load matches" }, { status: 500 });
  }
}
