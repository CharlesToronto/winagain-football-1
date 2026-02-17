import { fetchApi } from "@/lib/football";

const DEFAULT_TIMEZONE = "America/Toronto";

type SupabaseLike = {
  from: (table: string) => any;
};

type CompetitionRow = { id: number | null };

type ApiFixture = {
  fixture?: {
    id?: number;
    date?: string;
    status?: { short?: string; long?: string };
  };
  league?: {
    id?: number;
    season?: number;
    round?: string;
  };
  teams?: {
    home?: { id?: number };
    away?: { id?: number };
  };
  goals?: { home?: number | null; away?: number | null };
  score?: { halftime?: { home?: number | null; away?: number | null } };
};

export type RefreshFixturesWindowOptions = {
  dateKeys: string[]; // YYYY-MM-DD in timezone provided
  ttlMinutes?: number;
  force?: boolean;
  timeZone?: string;
  includeTeams?: boolean;
};

export type RefreshFixturesWindowReport = {
  dateKey: string;
  refreshed: boolean;
  apiFixtures: number;
  trackedFixtures: number;
  upsertedFixtures: number;
  upsertedTeams: number;
  error?: string;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function shouldRefreshWithClient(
  supabase: SupabaseLike,
  key: string,
  ttlMinutes: number
) {
  const { data, error } = await supabase
    .from("meta_cache")
    .select("last_update")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    console.error("Cache error:", error);
    return true;
  }

  if (!data?.last_update) return true;

  const last = new Date(data.last_update).getTime();
  const now = Date.now();
  const diffMinutes = (now - last) / 1000 / 60;
  return diffMinutes >= ttlMinutes;
}

async function updateRefreshWithClient(supabase: SupabaseLike, key: string) {
  await supabase.from("meta_cache").upsert({
    key,
    last_update: new Date().toISOString(),
  });
}

async function loadTrackedCompetitionIds(supabase: SupabaseLike) {
  const { data, error } = await supabase.from("competitions").select("id");
  if (error) throw new Error(error.message);
  const ids = new Set<number>();
  (data as CompetitionRow[] | null | undefined)?.forEach((row) => {
    const id = Number(row?.id);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  });
  return ids;
}

function normalizeFixtureRow(fx: ApiFixture) {
  const fixtureId = fx?.fixture?.id;
  if (!fixtureId || !Number.isFinite(Number(fixtureId))) return null;
  const leagueId = fx?.league?.id;
  if (!leagueId || !Number.isFinite(Number(leagueId))) return null;

  return {
    id: Number(fixtureId),
    competition_id: Number(leagueId),
    season: fx?.league?.season ?? null,
    date_utc: fx?.fixture?.date ?? null,
    status_short: fx?.fixture?.status?.short ?? null,
    status_long: fx?.fixture?.status?.long ?? null,
    round: fx?.league?.round ?? null,
    home_team_id: fx?.teams?.home?.id ?? null,
    away_team_id: fx?.teams?.away?.id ?? null,
    goals_home: fx?.goals?.home ?? null,
    goals_away: fx?.goals?.away ?? null,
    goals_home_ht: fx?.score?.halftime?.home ?? null,
    goals_away_ht: fx?.score?.halftime?.away ?? null,
  };
}

function normalizeTeamRows(fixtures: ApiFixture[]) {
  const teams = new Map<number, { id: number; name?: string | null; logo?: string | null }>();

  fixtures.forEach((fx: any) => {
    const home = fx?.teams?.home;
    const away = fx?.teams?.away;
    if (home?.id && Number.isFinite(Number(home.id))) {
      teams.set(Number(home.id), {
        id: Number(home.id),
        name: typeof home.name === "string" ? home.name : null,
        logo: typeof home.logo === "string" ? home.logo : null,
      });
    }
    if (away?.id && Number.isFinite(Number(away.id))) {
      teams.set(Number(away.id), {
        id: Number(away.id),
        name: typeof away.name === "string" ? away.name : null,
        logo: typeof away.logo === "string" ? away.logo : null,
      });
    }
  });

  return Array.from(teams.values()).filter((t) => t.id && t.name);
}

export async function refreshFixturesWindow(
  supabase: SupabaseLike,
  options: RefreshFixturesWindowOptions
) {
  const timeZone = options.timeZone ?? DEFAULT_TIMEZONE;
  const ttlMinutes = typeof options.ttlMinutes === "number" ? options.ttlMinutes : 10;
  const force = Boolean(options.force);
  const includeTeams = Boolean(options.includeTeams);

  let trackedCompetitions: Set<number> | null = null;
  const reports: RefreshFixturesWindowReport[] = [];

  for (const dateKey of options.dateKeys) {
    const cacheKey = `winagain:fixtures:window:${timeZone}:${dateKey}`;
    try {
      const needsRefresh = force || (await shouldRefreshWithClient(supabase, cacheKey, ttlMinutes));
      if (!needsRefresh) {
        reports.push({
          dateKey,
          refreshed: false,
          apiFixtures: 0,
          trackedFixtures: 0,
          upsertedFixtures: 0,
          upsertedTeams: 0,
        });
        continue;
      }

      if (!trackedCompetitions) {
        trackedCompetitions = await loadTrackedCompetitionIds(supabase);
      }

      const apiData = await fetchApi("fixtures", { date: dateKey, timezone: timeZone });
      const apiFixtures = (apiData?.response ?? []) as ApiFixture[];

      const filtered = apiFixtures.filter((fx) => {
        const leagueId = Number((fx as any)?.league?.id);
        return (
          Number.isFinite(leagueId) &&
          Boolean(trackedCompetitions) &&
          trackedCompetitions.has(leagueId)
        );
      });

      const normalizedFixtures = filtered
        .map((fx) => normalizeFixtureRow(fx))
        .filter(Boolean) as any[];

      let upsertedFixtures = 0;
      for (const batch of chunkArray(normalizedFixtures, 500)) {
        if (batch.length === 0) continue;
        const { error: upsertError } = await supabase
          .from("fixtures")
          .upsert(batch, { onConflict: "id" });
        if (upsertError) throw new Error(upsertError.message);
        upsertedFixtures += batch.length;
      }

      let upsertedTeams = 0;
      if (includeTeams) {
        const teams = normalizeTeamRows(filtered);
        for (const batch of chunkArray(teams, 500)) {
          if (batch.length === 0) continue;
          const { error: teamError } = await supabase
            .from("teams")
            .upsert(batch, { onConflict: "id" });
          if (teamError) throw new Error(teamError.message);
          upsertedTeams += batch.length;
        }
      }

      await updateRefreshWithClient(supabase, cacheKey);

      reports.push({
        dateKey,
        refreshed: true,
        apiFixtures: apiFixtures.length,
        trackedFixtures: filtered.length,
        upsertedFixtures,
        upsertedTeams,
      });
    } catch (err: any) {
      reports.push({
        dateKey,
        refreshed: false,
        apiFixtures: 0,
        trackedFixtures: 0,
        upsertedFixtures: 0,
        upsertedTeams: 0,
        error: err?.message ?? String(err),
      });
    }
  }

  return {
    ok: reports.every((r) => !r.error),
    timeZone,
    ttlMinutes,
    forced: force,
    reports,
  };
}
