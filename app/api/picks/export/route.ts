import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PickRow = {
  id: string;
  snapshot_date: string | null;
  fixture_date_utc: string | null;
  fixture_id: number | null;
  league_id: number | null;
  competition_name: string | null;
  team_id: number | null;
  pick: string | null;
  market: string | null;
  odd: number | null;
  probability: number | null;
  hit_rate: number | null;
  coverage: number | null;
  picks_count: number | null;
  evaluated_count: number | null;
  meets_algo_criteria: boolean | null;
  meets_odds: boolean | null;
  meets_criteria: boolean | null;
  status: string | null;
  hit: boolean | null;
  goals_home: number | null;
  goals_away: number | null;
  home_id: number | null;
  away_id: number | null;
  home_name: string | null;
  away_name: string | null;
  resolved_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function formatDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseBool(value: string | null, defaultValue: boolean) {
  if (value == null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function escapeCsvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function resolveAlgoTable(value: string | null) {
  const algo = String(value ?? "v3").toLowerCase();
  if (algo === "v1") return { algo: "v1", table: "daily_algo_picks" };
  if (algo === "v2") return { algo: "v2", table: "daily_algo_picks_v2" };
  return { algo: "v3", table: "daily_algo_picks_v3" };
}

function asFiniteInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeStatsRow(row: any, includeRawStats: boolean) {
  if (includeRawStats) return row;
  if (row == null || typeof row !== "object") return row;
  const copy = { ...row };
  delete (copy as any).raw_json;
  return copy;
}

export async function GET(request: Request) {
  const supabase = createClient();

  try {
    const url = new URL(request.url);
    const { algo, table } = resolveAlgoTable(url.searchParams.get("algo"));
    const criteria = url.searchParams.get("criteria") ?? "all";
    const market = url.searchParams.get("market") ?? "all";
    const format = (url.searchParams.get("format") ?? "json").toLowerCase();
    const includeTeamStats = parseBool(url.searchParams.get("include_team_stats"), true);
    const includeRawStats = parseBool(url.searchParams.get("include_raw_stats"), false);

    const daysParamRaw = url.searchParams.get("days");
    const daysParam = daysParamRaw == null ? 36500 : Number(daysParamRaw);
    const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 36500;
    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromKey = formatDateKey(from);

    const buildPicksQuery = (offset: number, limit: number) => {
      let query = supabase
        .from(table)
        .select("*")
        .or(`snapshot_date.gte.${fromKey},snapshot_date.is.null`)
        .order("fixture_date_utc", { ascending: false })
        .range(offset, offset + limit - 1);

      if (criteria === "rose") {
        query = query.eq("meets_criteria", true);
      } else if (criteria === "yellow") {
        query = query.eq("meets_criteria", false);
      }

      if (market !== "all") {
        query = query.eq("market", market);
      }

      return query;
    };

    const picks: PickRow[] = [];
    const batchSize = 1000;
    let offset = 0;

    while (true) {
      const { data, error } = await buildPicksQuery(offset, batchSize);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const rows = (data ?? []) as PickRow[];
      picks.push(...rows);
      if (rows.length < batchSize) break;
      offset += batchSize;
    }

    const leagueIds = Array.from(
      new Set(
        picks
          .map((row) => asFiniteInt(row?.league_id))
          .filter((id): id is number => id != null)
      )
    );
    const fixtureIds = Array.from(
      new Set(
        picks
          .map((row) => asFiniteInt(row?.fixture_id))
          .filter((id): id is number => id != null && id > 0)
      )
    );

    const competitionCountryMap = new Map<number, string | null>();
    if (leagueIds.length > 0) {
      const { data, error } = await supabase
        .from("competitions")
        .select("id,country")
        .in("id", leagueIds);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      (data ?? []).forEach((row: any) => {
        const id = asFiniteInt(row?.id);
        if (id == null) return;
        competitionCountryMap.set(id, row?.country ? String(row.country) : null);
      });
    }

    const fixtureTeamMap = new Map<number, { home_team_id: number | null; away_team_id: number | null }>();
    if (fixtureIds.length > 0) {
      const chunkSize = 1000;
      for (let i = 0; i < fixtureIds.length; i += chunkSize) {
        const chunk = fixtureIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("fixtures")
          .select("id,home_team_id,away_team_id")
          .in("id", chunk);
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        (data ?? []).forEach((row: any) => {
          const fixtureId = asFiniteInt(row?.id);
          if (fixtureId == null) return;
          fixtureTeamMap.set(fixtureId, {
            home_team_id: asFiniteInt(row?.home_team_id),
            away_team_id: asFiniteInt(row?.away_team_id),
          });
        });
      }
    }

    const enrichedPicks = picks.map((row) => {
      const fixtureMeta = row?.fixture_id != null ? fixtureTeamMap.get(Number(row.fixture_id)) : null;
      return {
        ...row,
        competition_country:
          row?.league_id != null ? (competitionCountryMap.get(Number(row.league_id)) ?? null) : null,
        home_team_id: fixtureMeta?.home_team_id ?? null,
        away_team_id: fixtureMeta?.away_team_id ?? null,
      };
    });

    const teamIds = Array.from(
      new Set(
        enrichedPicks
          .flatMap((row) => [
            asFiniteInt(row?.team_id),
            asFiniteInt((row as any)?.home_team_id),
            asFiniteInt((row as any)?.away_team_id),
          ])
          .filter((id): id is number => id != null && id > 0)
      )
    );

    const teamStatsByTeam = new Map<number, any[]>();
    if (includeTeamStats && teamIds.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < teamIds.length; i += chunkSize) {
        const chunk = teamIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("team_stats")
          .select("*")
          .in("team_id", chunk)
          .order("season_from", { ascending: false, nullsFirst: false });

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        (data ?? []).forEach((row: any) => {
          const teamId = asFiniteInt(row?.team_id);
          if (teamId == null) return;
          const current = teamStatsByTeam.get(teamId) ?? [];
          current.push(normalizeStatsRow(row, includeRawStats));
          teamStatsByTeam.set(teamId, current);
        });
      }
    }

    if (format === "csv") {
      const columns = [
        "id",
        "snapshot_date",
        "fixture_date_utc",
        "fixture_id",
        "league_id",
        "competition_name",
        "competition_country",
        "team_id",
        "home_team_id",
        "away_team_id",
        "home_name",
        "away_name",
        "pick",
        "market",
        "odd",
        "probability",
        "hit_rate",
        "coverage",
        "picks_count",
        "evaluated_count",
        "meets_algo_criteria",
        "meets_odds",
        "meets_criteria",
        "status",
        "hit",
        "goals_home",
        "goals_away",
        "pick_team_stats_history_json",
        "home_team_stats_history_json",
        "away_team_stats_history_json",
      ];

      const rows = enrichedPicks.map((row: any) => {
        const pickTeamStats = teamStatsByTeam.get(asFiniteInt(row?.team_id) ?? -1) ?? [];
        const homeTeamStats = teamStatsByTeam.get(asFiniteInt(row?.home_team_id) ?? -1) ?? [];
        const awayTeamStats = teamStatsByTeam.get(asFiniteInt(row?.away_team_id) ?? -1) ?? [];

        const valueByColumn: Record<string, unknown> = {
          ...row,
          pick_team_stats_history_json: JSON.stringify(pickTeamStats),
          home_team_stats_history_json: JSON.stringify(homeTeamStats),
          away_team_stats_history_json: JSON.stringify(awayTeamStats),
        };

        return columns.map((column) => escapeCsvCell(valueByColumn[column])).join(",");
      });

      const csvContent = [columns.join(","), ...rows].join("\n");
      const fileDate = new Date().toISOString().slice(0, 10);
      const filename = `picks_${algo}_${fileDate}.csv`;

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=\"${filename}\"`,
          "Cache-Control": "no-store, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
          "Surrogate-Control": "no-store",
        },
      });
    }

    const teamStatsHistory = Array.from(teamStatsByTeam.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([teamId, history]) => ({ team_id: teamId, history }));

    const res = NextResponse.json({
      meta: {
        generated_at: new Date().toISOString(),
        algo,
        table,
        criteria,
        market,
        days,
        total_picks: enrichedPicks.length,
        total_teams: teamIds.length,
      },
      picks: enrichedPicks,
      team_stats_history: teamStatsHistory,
    });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    res.headers.set("Pragma", "no-cache");
    res.headers.set("Expires", "0");
    res.headers.set("Surrogate-Control", "no-store");
    return res;
  } catch (err: any) {
    return NextResponse.json(
      { error: true, details: err?.message ?? "Export error" },
      { status: 500 }
    );
  }
}
