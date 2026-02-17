import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { refreshFixturesWindow } from "@/lib/fixtures/refreshFixturesWindow";

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

  try {
    await refreshFixturesWindow(supabase as any, {
      dateKeys: [yesterdayKey, todayKey, tomorrowKey],
      ttlMinutes: 5,
      timeZone: TIMEZONE,
    });
  } catch (err) {
    console.error("Rencontre fixtures refresh failed", err);
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

  const leagueHistoryStats = new Map<number, { total: number; hits: number; hitRate: number }>();
  if (competitionIds.length > 0) {
    const { data: leagueRows, error: leagueError } = await supabase
      .from("daily_algo_picks_v3")
      .select("league_id,status")
      .in("league_id", competitionIds);

    if (!leagueError) {
      (leagueRows ?? []).forEach((row: LeagueHistoryRow) => {
        const leagueId = Number(row?.league_id);
        if (!Number.isFinite(leagueId) || !leagueId) return;
        const current = leagueHistoryStats.get(leagueId) ?? { total: 0, hits: 0, hitRate: 0 };
        current.total += 1;
        if (row?.status === "hit") current.hits += 1;
        leagueHistoryStats.set(leagueId, current);
      });

      leagueHistoryStats.forEach((value) => {
        value.hitRate = value.total ? (value.hits / value.total) * 100 : 0;
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

  return (
    <div className="min-h-screen p-6 text-white">
      <div className="flex items-center gap-2 mb-6">
        <Link
          href={yesterdayHref}
          className={`px-3 py-1 rounded-lg text-sm transition ${
            activeDay === "yesterday"
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
        >
          Hier
        </Link>
        <Link
          href={todayHref}
          className={`px-3 py-1 rounded-lg text-sm transition ${
            activeDay === "today"
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
        >
          Aujourd'hui
        </Link>
        <Link
          href={tomorrowHref}
          className={`px-3 py-1 rounded-lg text-sm transition ${
            activeDay === "tomorrow"
              ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
              : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
        >
          Demain
        </Link>
      </div>

      {error ? (
        <div className="p-4 rounded-lg bg-red-500/20 border border-red-500/40 text-red-100">
          Erreur chargement rencontres.
        </div>
      ) : null}

      <div className="space-y-8">
        {sections.map((section) => {
          const groups = sectionData(section.key);
          return (
            <div key={section.key} className="space-y-4">
              <div className="sr-only">{section.title}</div>
              {groups.length === 0 ? (
                <div className="text-sm text-white/60">Aucun match prévu.</div>
              ) : (
                <div className="space-y-4">
                  {groups.map((group) => {
                    const competitionLabel = formatCompetitionLabel(group.competition);
                    const roundLabels = group.fixtures
                      .map((fixture) => fixture.round)
                      .filter(Boolean) as string[];
                    const uniqueRounds = Array.from(new Set(roundLabels));
                    const competitionRound =
                      uniqueRounds.length === 1 ? uniqueRounds[0] : null;
                    const leagueStats = leagueHistoryStats.get(group.competition.id);
                    return (
                      <details
                        key={`competition-${section.key}-${group.competition.id}-${activeDay}`}
                        className="group -mx-4 px-2 rounded-xl bg-transparent"
                      >
                        <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none rounded-xl border border-white/20 bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm group-open:border-transparent group-open:bg-transparent text-[11px]">
                          {group.competition.logo ? (
                            <img
                              src={group.competition.logo}
                              alt={competitionLabel}
                              className="w-8 h-8 rounded-md object-contain bg-white/10"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-md bg-white/10 border border-white/10" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold truncate text-[12px]">{competitionLabel}</div>
                            <div className="text-[10px] text-white/60 flex items-center gap-2">
                              <span>{group.fixtures.length} matchs</span>
                              {leagueStats?.total ? (
                                <>
                                  <span className="text-white/40">•</span>
                                  <span className="tabular-nums text-[11px] font-medium">
                                    Hit rate {leagueStats.hitRate.toFixed(1)}% • {leagueStats.total} picks
                                  </span>
                                </>
                              ) : null}
                              {competitionRound ? (
                                <>
                                  <span className="text-white/40">•</span>
                                  <span className="truncate">{competitionRound}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <span className="text-white/50 transition-transform group-open:rotate-180 animate-pulse group-open:animate-none motion-reduce:animate-none">
                            <svg
                              viewBox="0 0 24 24"
                              width={16}
                              height={16}
                              aria-hidden
                            >
                              <path
                                d="M6 9l6 6 6-6"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        </summary>

                        <div className="-mx-4 px-2 pb-4 space-y-2">
                          {group.fixtures.map((fixture) => {
                            const homeHref = Number.isFinite(fixture.home?.id)
                              ? `/team/${fixture.home?.id}`
                              : null;
                            const roundLabel =
                              fixture.round && fixture.round === competitionRound
                                ? null
                                : fixture.round ?? "Marché -3.5";
                            const hasScore =
                              fixture.goals_home != null && fixture.goals_away != null;
                            const row = (
                              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 transition hover:bg-white/10">
                                <div className="flex items-center justify-between text-[10px] text-white/60">
                                  <span>{formatTime(fixture.date_utc)}</span>
                                  <span className="truncate">{roundLabel ?? ""}</span>
                                </div>
                                <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-xs">
                                  <div className="flex items-center gap-2 min-w-0">
                                    {fixture.home?.logo ? (
                                      <img
                                        src={fixture.home.logo}
                                        alt={fixture.home.name ?? "Home"}
                                        className="w-4 h-4 object-contain"
                                      />
                                    ) : (
                                      <div className="w-4 h-4 rounded-full bg-white/10" />
                                    )}
                                    <span className="truncate font-semibold">
                                      {fixture.home?.name ?? "Home"}
                                    </span>
                                  </div>
                                  <div
                                    className={`text-center ${
                                      activeDay === "yesterday" && hasScore
                                        ? "text-sm font-semibold text-white/90"
                                        : "text-xs text-white/60"
                                    }`}
                                  >
                                    {activeDay === "yesterday" && hasScore
                                      ? `${fixture.goals_home} - ${fixture.goals_away}`
                                      : "VS"}
                                  </div>
                                  <div className="flex items-center justify-end gap-2 min-w-0 text-right">
                                    <span className="truncate font-semibold">
                                      {fixture.away?.name ?? "Away"}
                                    </span>
                                    {fixture.away?.logo ? (
                                      <img
                                        src={fixture.away.logo}
                                        alt={fixture.away.name ?? "Away"}
                                        className="w-4 h-4 object-contain"
                                      />
                                    ) : (
                                      <div className="w-4 h-4 rounded-full bg-white/10" />
                                    )}
                                  </div>
                                </div>
                              </div>
                            );

                            return homeHref ? (
                              <Link key={fixture.id} href={homeHref} className="block">
                                {row}
                              </Link>
                            ) : (
                              <div key={fixture.id}>{row}</div>
                            );
                          })}
                        </div>
                      </details>
                  );
                })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
