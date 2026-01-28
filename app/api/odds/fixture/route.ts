import { NextResponse } from "next/server";
import { fetchFixtureOddsFromApi } from "@/lib/odds/fixtureOdds";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const fixture = Number(url.searchParams.get("fixture"));
    const league = Number(url.searchParams.get("league"));
    const season = Number(url.searchParams.get("season"));
    const bookmakerParam = url.searchParams.get("bookmaker") ?? "1";
    const bookmakerId = Number(bookmakerParam);

    if (!Number.isFinite(fixture) || !Number.isFinite(league) || !Number.isFinite(season)) {
      return NextResponse.json(
        { error: "Missing fixture/league/season params." },
        { status: 400 }
      );
    }

    const result = await fetchFixtureOddsFromApi({
      fixtureId: fixture,
      leagueId: league,
      season,
      bookmakerId: Number.isFinite(bookmakerId) ? bookmakerId : null,
      bookmakerName: bookmakerParam,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: true, details: err?.message ?? "Odds API error" },
      { status: 500 }
    );
  }
}
