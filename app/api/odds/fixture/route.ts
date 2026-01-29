import { NextResponse } from "next/server";
import { fetchFixtureOddsFromApi } from "@/lib/odds/fixtureOdds";

export const dynamic = "force-dynamic";
const CURRENT_SEASON = 2025;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const fixture = Number(url.searchParams.get("fixture"));
    const leagueParam = url.searchParams.get("league");
    const league = leagueParam ? Number(leagueParam) : null;
    const seasonParam = url.searchParams.get("season");
    const season = seasonParam ? Number(seasonParam) : CURRENT_SEASON;
    const bookmakersParam =
      url.searchParams.get("bookmakers") ?? url.searchParams.get("bookmaker") ?? "1";
    const bookmakerIds = String(bookmakersParam)
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value));
    const bookmakerId = bookmakerIds.length ? bookmakerIds[0] : Number(bookmakersParam);

    if (!Number.isFinite(fixture) || !Number.isFinite(season) || season <= 0) {
      return NextResponse.json(
        { error: "Missing fixture/season params." },
        { status: 400 }
      );
    }

    const result = await fetchFixtureOddsFromApi({
      fixtureId: fixture,
      leagueId: Number.isFinite(league) ? league : null,
      season,
      bookmakerId: Number.isFinite(bookmakerId) ? bookmakerId : null,
      bookmakerIds: bookmakerIds.length ? bookmakerIds : undefined,
      bookmakerName: bookmakersParam,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: true, details: err?.message ?? "Odds API error" },
      { status: 500 }
    );
  }
}
