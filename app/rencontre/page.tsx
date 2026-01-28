import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
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
  return formatDateKey(date);
}

function formatTime(value?: string | null) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
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
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setDate(today.getDate() + 2);

  const todayKey = formatDateKey(today);
  const tomorrowKey = formatDateKey(tomorrow);
  const activeDay =
    searchParams?.day === "today"
      ? "today"
      : searchParams?.day === "tomorrow"
        ? "tomorrow"
        : "all";

  const supabase = createClient();
  const { data, error } = await supabase
    .from("fixtures")
    .select(
      `
      id,
      date_utc,
      status_short,
      round,
      competition_id,
      home:home_team_id ( id, name, logo ),
      away:away_team_id ( id, name, logo )
    `
    )
    .gte("date_utc", today.toISOString())
    .lt("date_utc", dayAfterTomorrow.toISOString())
    .order("date_utc", { ascending: true });

  const fixtures: FixtureRow[] = (data ?? []).map((row: any) => ({
    id: row.id,
    date_utc: row.date_utc ?? null,
    status_short: row.status_short ?? null,
    round: row.round ?? null,
    competition_id: row.competition_id ?? null,
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
      ({
        id: compId,
        name: compId ? `Compétition ${compId}` : "Compétition",
        country: null,
        logo: null,
      } as CompetitionInfo);

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
    activeDay === "today"
      ? [{ key: todayKey, title: "Aujourd'hui" }]
      : activeDay === "tomorrow"
        ? [{ key: tomorrowKey, title: "Demain" }]
        : [
            { key: todayKey, title: "Aujourd'hui" },
            { key: tomorrowKey, title: "Demain" },
          ];

  const todayHref = activeDay === "today" ? "/rencontre" : "/rencontre?day=today";
  const tomorrowHref =
    activeDay === "tomorrow" ? "/rencontre" : "/rencontre?day=tomorrow";
  const headerSubtitle =
    activeDay === "today"
      ? "Aujourd'hui"
      : activeDay === "tomorrow"
        ? "Demain"
        : "Aujourd'hui & Demain";

  return (
    <div className="min-h-screen p-6 text-white">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Rencontre</h1>
          <div className="text-sm text-white/70">{headerSubtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={todayHref}
            className={`px-3 py-1 text-xs rounded-md border transition ${
              activeDay === "today"
                ? "border-white text-white"
                : "border-transparent text-white/60 hover:text-white/80"
            }`}
          >
            Aujourd'hui
          </Link>
          <Link
            href={tomorrowHref}
            className={`px-3 py-1 text-xs rounded-md border transition ${
              activeDay === "tomorrow"
                ? "border-white text-white"
                : "border-transparent text-white/60 hover:text-white/80"
            }`}
          >
            Demain
          </Link>
        </div>
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
              <div className="text-lg font-semibold">{section.title}</div>
              {groups.length === 0 ? (
                <div className="text-sm text-white/60">Aucun match prévu.</div>
              ) : (
                <div className="space-y-12">
                  {groups.map((group) => {
                    const competitionLabel = formatCompetitionLabel(group.competition);
                    const roundLabels = group.fixtures
                      .map((fixture) => fixture.round)
                      .filter(Boolean) as string[];
                    const uniqueRounds = Array.from(new Set(roundLabels));
                    const competitionRound =
                      uniqueRounds.length === 1 ? uniqueRounds[0] : null;
                    return (
                      <details
                        key={`competition-${section.key}-${group.competition.id}`}
                        className="rounded-xl border border-white/10 bg-white/5"
                        open
                      >
                        <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none">
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
                            <div className="font-semibold truncate">{competitionLabel}</div>
                            <div className="text-xs text-white/60 flex items-center gap-2">
                              <span>{group.fixtures.length} matchs</span>
                              {competitionRound ? (
                                <>
                                  <span className="text-white/40">•</span>
                                  <span className="truncate">{competitionRound}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <span className="text-xs text-white/50">Réduire</span>
                        </summary>

                        <div className="px-4 pb-4 space-y-2">
                          {group.fixtures.map((fixture) => {
                            const homeHref = Number.isFinite(fixture.home?.id)
                              ? `/team/${fixture.home?.id}`
                              : null;
                            const homePercent = getTeamUnderPercent(fixture.home?.id);
                            const awayPercent = getTeamUnderPercent(fixture.away?.id);
                            const roundLabel =
                              fixture.round && fixture.round === competitionRound
                                ? null
                                : fixture.round ?? "Marché -3.5";
                            const showMeta =
                              Boolean(roundLabel) || homePercent != null || awayPercent != null;
                            const row = (
                              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 transition hover:bg-white/10">
                                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:grid-cols-[48px_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-sm">
                                  <div className="hidden md:block text-white/70 tabular-nums">
                                    {formatTime(fixture.date_utc)}
                                  </div>
                                  <div className="flex items-center gap-2 min-w-0">
                                    {fixture.home?.logo ? (
                                      <img
                                        src={fixture.home.logo}
                                        alt={fixture.home.name ?? "Home"}
                                        className="w-5 h-5 md:w-7 md:h-7 object-contain"
                                      />
                                    ) : null}
                                    <span className="truncate text-sm md:text-lg font-semibold">
                                      {fixture.home?.name ?? "Home"}
                                    </span>
                                  </div>
                                  <div className="text-base sm:text-lg md:text-xl font-semibold text-white/80 leading-none">
                                    VS
                                  </div>
                                  <div className="flex items-center justify-end gap-2 min-w-0 text-right">
                                    <span className="truncate text-sm md:text-lg font-semibold">
                                      {fixture.away?.name ?? "Away"}
                                    </span>
                                    {fixture.away?.logo ? (
                                      <img
                                        src={fixture.away.logo}
                                        alt={fixture.away.name ?? "Away"}
                                        className="w-5 h-5 md:w-7 md:h-7 object-contain"
                                      />
                                    ) : null}
                                  </div>
                                </div>
                                {showMeta ? (
                                  <div className="mt-1 text-xs text-white/50 flex items-center justify-between gap-3">
                                    <span className="truncate flex items-center gap-2">
                                      {roundLabel ? <span>{roundLabel}</span> : null}
                                      <span className="md:hidden text-white/60 tabular-nums">
                                        {formatTime(fixture.date_utc)}
                                      </span>
                                    </span>
                                    <span className="flex items-center gap-3 font-semibold tabular-nums">
                                      <span className="text-emerald-300">
                                        {homePercent != null ? `${homePercent}%` : "--"}
                                      </span>
                                      <span className="text-orange-300">
                                        {awayPercent != null ? `${awayPercent}%` : "--"}
                                      </span>
                                    </span>
                                  </div>
                                ) : null}
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
