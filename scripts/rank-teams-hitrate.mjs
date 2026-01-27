import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_LINES = [1.5, 2.5, 3.5];
const BASELINE_HOME = 1.35;
const BASELINE_AWAY = 1.15;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const idx = args.indexOf(`--${name}`);
    if (idx === -1) return undefined;
    return args[idx + 1];
  };
  const has = (name) => args.includes(`--${name}`);

  return {
    help: has("help"),
    league: get("league"),
    season: get("season"),
    from: get("from"),
    to: get("to"),
    window: Number(get("window") || 10),
    minMatches: Number(get("minMatches") || 5),
    minLeagueMatches: Number(get("minLeagueMatches") || 10),
    threshold: Number(get("threshold") || 0.65),
    minPicks: Number(get("minPicks") || 20),
    limit: Number(get("limit") || 0),
  };
}

function printHelp() {
  console.log(`\nRank Teams by Hit Rate (Over/Under)

Usage:
  node scripts/rank-teams-hitrate.mjs --league 39 --season 2024

Options:
  --league <id>            Competition id (fixtures.competition_id)
  --season <year>          Season (fixtures.season)
  --from <YYYY-MM-DD>      Start date (inclusive)
  --to <YYYY-MM-DD>        End date (inclusive)
  --window <n>             Rolling window per team (default 10)
  --minMatches <n>         Min home/away matches per team (default 5)
  --minLeagueMatches <n>   Min matches to trust league avg (default 10)
  --threshold <n>          Min probability to count a pick (default 0.65)
  --minPicks <n>           Min picks per team to appear (default 20)
  --limit <n>              Limit fixtures
`);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function poissonCdf(lambda, k) {
  if (k < 0) return 0;
  const L = Math.exp(-lambda);
  let sum = L;
  let p = L;
  for (let i = 1; i <= k; i += 1) {
    p = (p * lambda) / i;
    sum += p;
  }
  return sum;
}

function getEnvValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

function makeRolling(windowSize) {
  return { gf: 0, ga: 0, items: [], windowSize };
}

function addRolling(rolling, gf, ga) {
  rolling.items.push({ gf, ga });
  rolling.gf += gf;
  rolling.ga += ga;
  if (rolling.items.length > rolling.windowSize) {
    const removed = rolling.items.shift();
    if (removed) {
      rolling.gf -= removed.gf;
      rolling.ga -= removed.ga;
    }
  }
}

function rollingAvg(rolling) {
  const n = rolling.items.length;
  if (!n) return { gf: 0, ga: 0, n: 0 };
  return { gf: rolling.gf / n, ga: rolling.ga / n, n };
}

function shrink(avg, n, priorAvg, priorN) {
  if (!n) return priorAvg;
  return (avg * n + priorAvg * priorN) / (n + priorN);
}

async function fetchFixtures({ supabase, league, season, from, to, limit }) {
  let query = supabase
    .from("fixtures")
    .select(
      "id,competition_id,season,date_utc,home_team_id,away_team_id,goals_home,goals_away"
    )
    .not("goals_home", "is", null)
    .not("goals_away", "is", null)
    .not("date_utc", "is", null)
    .order("date_utc", { ascending: true });

  if (league) query = query.eq("competition_id", Number(league));
  if (season) query = query.eq("season", Number(season));
  if (from) query = query.gte("date_utc", `${from}T00:00:00Z`);
  if (to) query = query.lte("date_utc", `${to}T23:59:59Z`);

  const pageSize = 1000;
  const rows = [];
  let fromIndex = 0;

  while (true) {
    const { data, error } = await query.range(fromIndex, fromIndex + pageSize - 1);
    if (error) {
      throw new Error(`Supabase fixtures error: ${error.message}`);
    }
    if (!data?.length) break;
    rows.push(...data);
    fromIndex += pageSize;
    if (data.length < pageSize) break;
    if (limit && rows.length >= limit) break;
  }

  if (limit && rows.length > limit) {
    return rows.slice(0, limit);
  }

  return rows;
}

async function fetchTeams({ supabase, league }) {
  let query = supabase.from("teams").select("id,name");
  if (league) query = query.eq("competition_id", Number(league));
  const { data, error } = await query;
  if (error) {
    throw new Error(`Supabase teams error: ${error.message}`);
  }
  return data ?? [];
}

function runRanking(fixtures, teams, config) {
  const teamHistory = new Map();
  const leagueHistory = new Map();
  const teamStats = new Map();

  for (const team of teams) {
    teamStats.set(Number(team.id), {
      id: Number(team.id),
      name: team.name ?? `Team ${team.id}`,
      picks: 0,
      hits: 0,
    });
  }

  for (const fixture of fixtures) {
    const leagueId = Number(fixture.competition_id || 0);
    const homeId = Number(fixture.home_team_id || 0);
    const awayId = Number(fixture.away_team_id || 0);
    const goalsHome = Number(fixture.goals_home || 0);
    const goalsAway = Number(fixture.goals_away || 0);

    if (!teamHistory.has(homeId)) {
      teamHistory.set(homeId, {
        home: makeRolling(config.window),
        away: makeRolling(config.window),
      });
    }
    if (!teamHistory.has(awayId)) {
      teamHistory.set(awayId, {
        home: makeRolling(config.window),
        away: makeRolling(config.window),
      });
    }
    if (!leagueHistory.has(leagueId)) {
      leagueHistory.set(leagueId, { homeGoals: 0, awayGoals: 0, matches: 0 });
    }

    const leagueAgg = leagueHistory.get(leagueId);
    const leagueHomeAvg =
      leagueAgg.matches >= config.minLeagueMatches
        ? leagueAgg.homeGoals / leagueAgg.matches
        : BASELINE_HOME;
    const leagueAwayAvg =
      leagueAgg.matches >= config.minLeagueMatches
        ? leagueAgg.awayGoals / leagueAgg.matches
        : BASELINE_AWAY;

    const homeStats = teamHistory.get(homeId).home;
    const awayStats = teamHistory.get(awayId).away;

    const homeAvg = rollingAvg(homeStats);
    const awayAvg = rollingAvg(awayStats);

    if (homeAvg.n >= config.minMatches && awayAvg.n >= config.minMatches) {
      const adjHomeGF = shrink(homeAvg.gf, homeAvg.n, leagueHomeAvg, config.window);
      const adjHomeGA = shrink(homeAvg.ga, homeAvg.n, leagueAwayAvg, config.window);
      const adjAwayGF = shrink(awayAvg.gf, awayAvg.n, leagueAwayAvg, config.window);
      const adjAwayGA = shrink(awayAvg.ga, awayAvg.n, leagueHomeAvg, config.window);

      const attackHome = adjHomeGF / leagueHomeAvg;
      const defenseHome = adjHomeGA / leagueAwayAvg;
      const attackAway = adjAwayGF / leagueAwayAvg;
      const defenseAway = adjAwayGA / leagueHomeAvg;

      const xGHome = clamp(attackHome * defenseAway * leagueHomeAvg, 0.1, 6);
      const xGAway = clamp(attackAway * defenseHome * leagueAwayAvg, 0.1, 6);
      const lambda = xGHome + xGAway;

      let bestPick = null;
      for (const line of DEFAULT_LINES) {
        const thresholdLine = Math.floor(line);
        const pUnder = poissonCdf(lambda, thresholdLine);
        const pOver = 1 - pUnder;
        if (!bestPick || pOver > bestPick.probability) {
          bestPick = { side: "over", line, probability: pOver };
        }
        if (pUnder > bestPick.probability) {
          bestPick = { side: "under", line, probability: pUnder };
        }
      }

      if (bestPick && bestPick.probability >= config.threshold) {
        const totalGoals = goalsHome + goalsAway;
        const hit =
          bestPick.side === "over"
            ? totalGoals > bestPick.line
            : totalGoals <= bestPick.line;

        for (const teamId of [homeId, awayId]) {
          if (!teamStats.has(teamId)) {
            teamStats.set(teamId, {
              id: teamId,
              name: `Team ${teamId}`,
              picks: 0,
              hits: 0,
            });
          }
          const record = teamStats.get(teamId);
          record.picks += 1;
          if (hit) record.hits += 1;
        }
      }
    }

    addRolling(teamHistory.get(homeId).home, goalsHome, goalsAway);
    addRolling(teamHistory.get(awayId).away, goalsAway, goalsHome);
    leagueAgg.homeGoals += goalsHome;
    leagueAgg.awayGoals += goalsAway;
    leagueAgg.matches += 1;
  }

  const ranked = Array.from(teamStats.values())
    .filter((row) => row.picks >= config.minPicks)
    .map((row) => ({
      ...row,
      hitRate: row.picks ? row.hits / row.picks : 0,
    }))
    .sort((a, b) => b.hitRate - a.hitRate);

  return ranked;
}

async function main() {
  const config = parseArgs();
  if (config.help) {
    printHelp();
    return;
  }

  const envPath = path.join(process.cwd(), ".env.local");
  loadEnvFile(envPath);

  const supabaseUrl = getEnvValue("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const supabaseKey = getEnvValue("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase env vars (SUPABASE_URL / SUPABASE_ANON_KEY)");
  }
  if (!config.league || !config.season) {
    throw new Error("Please provide --league and --season");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const fixtures = await fetchFixtures({
    supabase,
    league: config.league,
    season: config.season,
    from: config.from,
    to: config.to,
    limit: config.limit,
  });
  const teams = await fetchTeams({ supabase, league: config.league });

  if (!fixtures.length) {
    console.log("No fixtures found for the given filters.");
    return;
  }

  const ranked = runRanking(fixtures, teams, config);

  console.log(`\nRanking (league ${config.league}, season ${config.season})`);
  console.log(`Threshold >= ${config.threshold}, min picks ${config.minPicks}`);
  console.log("--------------------------------------------------------");
  ranked.slice(0, 20).forEach((row, index) => {
    const hitRate = (row.hitRate * 100).toFixed(1);
    console.log(
      `${String(index + 1).padStart(2, " ")}. ${row.name} | hit ${hitRate}% | picks ${row.picks}`
    );
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
