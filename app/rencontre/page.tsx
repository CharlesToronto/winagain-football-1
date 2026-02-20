import { createClient } from "@/lib/supabase/server";
import { refreshFixturesWindow } from "@/lib/fixtures/refreshFixturesWindow";
import { writeFixtureUpdateReport } from "@/lib/fixtures/reporting";
import RencontreClientView from "./components/RencontreClientView";

export const dynamic = "force-dynamic";

type TeamInfo = {
  id: number;
  name: string | null;
  logo: string | null;
};

type CompetitionInfo = {
  id: number;
  name: string | null;
  country: string | null;
  logo: string | null;
};

type FixtureRow = {
  id: number;
  date_utc: string | null;
  status_short: string | null;
  round: string | null;
  competition_id: number | null;
  goals_home?: number | null;
  goals_away?: number | null;
  home?: TeamInfo | null;
  away?: TeamInfo | null;
};

type FixtureGroup = {
  competition: CompetitionInfo;
  fixtures: FixtureRow[];
};

type TeamMarketStats = {
  team_id: number | null;
  season_from: number | string | null;
  sample_size: number | null;
  under_3_5: number | null;
  over_3_5: number | null;
};

type LeagueHistoryRow = {
  league_id: number | null;
  status: string | null;
};

const TIMEZONE = "America/Toronto";

type Ymd = { year: number; month: number; day: number };

function getTzParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function getTimezoneOffset(date: Date, timeZone: string) {
  const parts = getTzParts(date, timeZone);
  const asUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return (asUTC - date.getTime()) / 60000;
}

function formatYmdKey(value: Ymd) {
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function addDays(value: Ymd, delta: number): Ymd {
  const d = new Date(Date.UTC(value.year, value.month - 1, value.day + delta, 12, 0, 0));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function utcStartForYmd(value: Ymd, timeZone: string) {
  const midnightUTC = Date.UTC(value.year, value.month - 1, value.day, 0, 0, 0);
  const offset = getTimezoneOffset(new Date(midnightUTC), timeZone);
  return new Date(midnightUTC - offset * 60000);
}

function formatDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateKey(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = getTzParts(date, TIMEZONE);
  return formatYmdKey({ year: parts.year, month: parts.month, day: parts.day });
}

function formatTime(value?: string | null) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });
}

function safeTime(value?: string | null) {
  if (!value) return 0;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatCompetitionLabel(competition: CompetitionInfo) {
  const parts = [competition.name, competition.country].filter(Boolean);
  return parts.length ? parts.join(" - ") : "Compétition";
}

function resolveUnderPercent(stats?: TeamMarketStats | null) {
  if (!stats) return null;
  const sample = Number(stats.sample_size ?? 0);
  if (!Number.isFinite(sample) || sample <= 0) return null;
  const over = Number(stats.over_3_5 ?? NaN);
  let under = Number(stats.under_3_5 ?? NaN);
  if (!Number.isFinite(under) && Number.isFinite(over)) {
    under = sample - over;
  }
  if (!Number.isFinite(under)) return null;
  const percent = (under / sample) * 100;
  if (!Number.isFinite(percent)) return null;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function normalizeTeamInfo(value: TeamInfo | TeamInfo[] | null | undefined) {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value;
}

export default async function RencontrePage({
  searchParams,
}: {
  searchParams?: { day?: string };
}) {
  const now = new Date();
  const tzNow = getTzParts(now, TIMEZONE);
  const todayYmd: Ymd = { year: tzNow.year, month: tzNow.month, day: tzNow.day };
  const yesterdayYmd = addDays(todayYmd, -1);
  const tomorrowYmd = addDays(todayYmd, 1);
  const dayAfterTomorrowYmd = addDays(todayYmd, 2);

  const startYesterdayUtc = utcStartForYmd(yesterdayYmd, TIMEZONE);
  const startDayAfterTomorrowUtc = utcStartForYmd(dayAfterTomorrowYmd, TIMEZONE);

  const yesterdayKey = formatYmdKey(yesterdayYmd);
  const todayKey = formatYmdKey(todayYmd);
  const tomorrowKey = formatYmdKey(tomorrowYmd);
  const activeDay =
    searchParams?.day === "yesterday"
      ? "yesterday"
      : searchParams?.day === "tomorrow"
        ? "tomorrow"
        : "today";

  const supabase = createClient();

  const refreshStartedAt = Date.now();
  const refreshStartedAtIso = new Date(refreshStartedAt).toISOString();
  try {
    const refreshResult = await refreshFixturesWindow(supabase as any, {
      dateKeys: [yesterdayKey, todayKey, tomorrowKey],
      ttlMinutes: 5,
      timeZone: TIMEZONE,
    });

    const reports = refreshResult.reports ?? [];
    const refreshedCount = reports.filter((report) => report.refreshed).length;
    const errorCount = reports.filter((report) => Boolean(report.error)).length;
    if (refreshedCount > 0 || errorCount > 0) {
      await writeFixtureUpdateReport(supabase as any, {
        jobName: "page_rencontre_fixtures_window",
        source: "page:/rencontre",
        status: errorCount > 0 ? "error" : "success",
        startedAt: refreshStartedAtIso,
        durationMs: Date.now() - refreshStartedAt,
        payload: {
          dateKeys: [yesterdayKey, todayKey, tomorrowKey],
          ttlMinutes: 5,
          timeZone: TIMEZONE,
          refreshedCount,
          errorCount,
          reports,
        },
        error: errorCount > 0 ? `refreshFixturesWindow reported ${errorCount} error(s).` : null,
      });
    }
  } catch (err) {
    console.error("Rencontre fixtures refresh failed", err);
    await writeFixtureUpdateReport(supabase as any, {
      jobName: "page_rencontre_fixtures_window",
      source: "page:/rencontre",
      status: "error",
      startedAt: refreshStartedAtIso,
      durationMs: Date.now() - refreshStartedAt,
      payload: {
        dateKeys: [yesterdayKey, todayKey, tomorrowKey],
        ttlMinutes: 5,
        timeZone: TIMEZONE,
      },
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const { data, error } = await supabase
    .from("fixtures")
    .select(
      `
      id,
      date_utc,
      status_short,
      round,
      goals_home,
      goals_away,
      competition_id,
      home:home_team_id ( id, name, logo ),
      away:away_team_id ( id, name, logo )
    `
    )
    .gte("date_utc", startYesterdayUtc.toISOString())
    .lt("date_utc", startDayAfterTomorrowUtc.toISOString())
    .order("date_utc", { ascending: true });

  const fixtures: FixtureRow[] = (data ?? []).map((row: any) => ({
    id: row.id,
    date_utc: row.date_utc ?? null,
    status_short: row.status_short ?? null,
    round: row.round ?? null,
    competition_id: row.competition_id ?? null,
    goals_home: typeof row.goals_home === "number" ? row.goals_home : null,
    goals_away: typeof row.goals_away === "number" ? row.goals_away : null,
    home: normalizeTeamInfo(row.home),
    away: normalizeTeamInfo(row.away),
  }));
  const competitionIds = Array.from(
    new Set(
      fixtures
        .map((fixture) => fixture.competition_id)
        .filter((id): id is number => Number.isFinite(id))
        .map((id) => Number(id))
    )
  );
  const teamIds = Array.from(
    new Set(
      fixtures
        .flatMap((fixture) => [fixture.home?.id, fixture.away?.id])
        .filter((id): id is number => Number.isFinite(id))
        .map((id) => Number(id))
    )
  );

  const competitionMap = new Map<number, CompetitionInfo>();
  if (competitionIds.length > 0) {
    const { data: competitions } = await supabase
      .from("competitions")
      .select("id,name,country,logo")
      .in("id", competitionIds);

    (competitions ?? []).forEach((competition: CompetitionInfo) => {
      if (!Number.isFinite(competition?.id)) return;
      competitionMap.set(Number(competition.id), {
        id: Number(competition.id),
        name: competition.name ?? null,
        country: competition.country ?? null,
        logo: competition.logo ?? null,
      });
    });
  }

  const leagueHistoryStats = new Map<number, { resolved: number; hits: number; hitRate: number }>();
  if (competitionIds.length > 0) {
    const { data: leagueRows, error: leagueError } = await supabase
      .from("daily_algo_picks_v3")
      .select("league_id,status")
      .in("league_id", competitionIds)
      .in("status", ["hit", "miss"]);

    if (!leagueError) {
      (leagueRows ?? []).forEach((row: LeagueHistoryRow) => {
        const leagueId = Number(row?.league_id);
        if (!Number.isFinite(leagueId) || !leagueId) return;
        const current = leagueHistoryStats.get(leagueId) ?? {
          resolved: 0,
          hits: 0,
          hitRate: 0,
        };
        current.resolved += 1;
        if (row?.status === "hit") current.hits += 1;
        leagueHistoryStats.set(leagueId, current);
      });

      leagueHistoryStats.forEach((value) => {
        value.hitRate = value.resolved ? (value.hits / value.resolved) * 100 : 0;
      });
    }
  }

  const teamStatsMap = new Map<number, TeamMarketStats>();
  if (teamIds.length > 0) {
    const { data: teamStats } = await supabase
      .from("team_stats")
      .select("team_id,season_from,sample_size,under_3_5,over_3_5")
      .in("team_id", teamIds);

    (teamStats ?? []).forEach((row: TeamMarketStats) => {
      const id = Number(row.team_id);
      if (!Number.isFinite(id)) return;
      const season = Number(row.season_from ?? 0);
      const existing = teamStatsMap.get(id);
      const existingSeason = Number(existing?.season_from ?? 0);
      if (!existing || season > existingSeason) {
        teamStatsMap.set(id, row);
      }
    });
  }

  const getTeamUnderPercent = (teamId?: number | null) => {
    if (!Number.isFinite(teamId)) return null;
    return resolveUnderPercent(teamStatsMap.get(Number(teamId)));
  };

  const dayGroups = new Map<string, Map<number, FixtureGroup>>([
    [yesterdayKey, new Map()],
    [todayKey, new Map()],
    [tomorrowKey, new Map()],
  ]);

  fixtures.forEach((fixture) => {
    const key = getDateKey(fixture.date_utc);
    if (!key || !dayGroups.has(key)) return;

    const compId = Number.isFinite(fixture.competition_id)
      ? Number(fixture.competition_id)
      : 0;
    const competition =
      competitionMap.get(compId) ??
      (compId
        ? {
            id: compId,
            name: `Competition ${compId}`,
            country: null,
            logo: null,
          }
        : null);
    if (!competition) return;

    const groups = dayGroups.get(key)!;
    const group = groups.get(compId) ?? { competition, fixtures: [] };
    group.fixtures.push(fixture);
    groups.set(compId, group);
  });

  const sectionData = (key: string) => {
    const groups = Array.from(dayGroups.get(key)?.values() ?? []);
    groups.forEach((group) => {
      group.fixtures.sort((a, b) => safeTime(a.date_utc) - safeTime(b.date_utc));
    });
    groups.sort((a, b) =>
      (a.competition.name ?? "").localeCompare(b.competition.name ?? "")
    );
    return groups;
  };

  const sections =
    activeDay === "yesterday"
      ? [{ key: yesterdayKey, title: "Hier" }]
      : activeDay === "today"
      ? [{ key: todayKey, title: "Aujourd'hui" }]
      : activeDay === "tomorrow"
        ? [{ key: tomorrowKey, title: "Demain" }]
        : [
            { key: todayKey, title: "Aujourd'hui" },
            { key: tomorrowKey, title: "Demain" },
          ];

  const yesterdayHref =
    activeDay === "yesterday" ? "/rencontre" : "/rencontre?day=yesterday";
  const todayHref = activeDay === "today" ? "/rencontre" : "/rencontre?day=today";
  const tomorrowHref =
    activeDay === "tomorrow" ? "/rencontre" : "/rencontre?day=tomorrow";
  const sectionsData = sections.map((section) => {
    const groups = sectionData(section.key).map((group) => {
      const competitionLabel = formatCompetitionLabel(group.competition);
      const roundLabels = group.fixtures
        .map((fixture) => fixture.round)
        .filter(Boolean) as string[];
      const uniqueRounds = Array.from(new Set(roundLabels));
      const competitionRound = uniqueRounds.length === 1 ? uniqueRounds[0] : null;
      const leagueStats = leagueHistoryStats.get(group.competition.id) ?? null;
      const fixturesData = group.fixtures.map((fixture) => {
        const homeHref = Number.isFinite(fixture.home?.id) ? `/team/${fixture.home?.id}` : null;
        const roundLabel =
          fixture.round && fixture.round === competitionRound
            ? null
            : fixture.round ?? "Marché -3.5";
        const hasScore = fixture.goals_home != null && fixture.goals_away != null;
        return {
          id: fixture.id,
          timeLabel: formatTime(fixture.date_utc),
          roundLabel,
          hasScore,
          goalsHome: fixture.goals_home ?? null,
          goalsAway: fixture.goals_away ?? null,
          home: fixture.home ?? null,
          away: fixture.away ?? null,
          homeHref,
        };
      });
      return {
        anchorId: `league-${section.key}-${group.competition.id}-${activeDay}`,
        competition: group.competition,
        competitionLabel,
        competitionRound,
        leagueStats,
        fixtures: fixturesData,
      };
    });
    return {
      key: section.key,
      title: section.title,
      groups,
    };
  });

  return (
    <RencontreClientView
      activeDay={activeDay}
      yesterdayHref={yesterdayHref}
      todayHref={todayHref}
      tomorrowHref={tomorrowHref}
      hasError={Boolean(error)}
      sections={sectionsData}
    />
  );
}
