import { NextResponse } from "next/server";
import { fetchApi } from "@/lib/football";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("ids") ?? "";
  const ids = raw
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!ids.length) {
    return NextResponse.json({ items: [] });
  }

  const items: Array<{ id: number; name: string | null; country: string | null }> = [];

  for (const leagueId of ids) {
    try {
      const data = await fetchApi("leagues", { id: leagueId });
      const leagueWrapper = data?.response?.[0];
      const league = leagueWrapper?.league;
      const country = leagueWrapper?.country;
      items.push({
        id: leagueId,
        name: league?.name ?? null,
        country: country?.name ?? null,
      });
    } catch {
      items.push({ id: leagueId, name: null, country: null });
    }
  }

  return NextResponse.json({ items });
}
