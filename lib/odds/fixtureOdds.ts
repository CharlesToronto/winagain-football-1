import { fetchApi } from "@/lib/football";
import { OVER_UNDER_LINES } from "@/lib/odds/calibration";

export const BET_MARKETS = {
  GOALS_OVER_UNDER: { id: 5, name: "Goals Over/Under" },
  GOALS_OVER_UNDER_1H: { id: 6, name: "Goals Over/Under First Half" },
  GOALS_OVER_UNDER_2H: { id: 26, name: "Goals Over/Under - Second Half" },
  CLEAN_SHEET_HOME: { id: 27, name: "Clean Sheet - Home" },
  CLEAN_SHEET_AWAY: { id: 28, name: "Clean Sheet - Away" },
  BOTH_TEAMS_SCORE: { id: 8, name: "Both Teams Score" },
  DOUBLE_CHANCE: { id: 12, name: "Double Chance" },
  TOTAL_HOME: { id: 16, name: "Total - Home" },
  TOTAL_AWAY: { id: 17, name: "Total - Away" },
  WIN_BOTH_HALVES: { id: 32, name: "Win Both Halves" },
} as const;

const OVER_UNDER_IDS = new Set<number>([BET_MARKETS.GOALS_OVER_UNDER.id]);
const DOUBLE_CHANCE_IDS = new Set<number>([BET_MARKETS.DOUBLE_CHANCE.id]);
const BTTS_IDS = new Set<number>([BET_MARKETS.BOTH_TEAMS_SCORE.id]);
const CLEAN_SHEET_HOME_IDS = new Set<number>([BET_MARKETS.CLEAN_SHEET_HOME.id]);
const CLEAN_SHEET_AWAY_IDS = new Set<number>([BET_MARKETS.CLEAN_SHEET_AWAY.id]);

export type FixtureOdds = {
  overUnder: { over: Record<string, string>; under: Record<string, string> };
  doubleChance: Record<"1X" | "X2" | "12", string>;
  btts: { yes: string; no: string };
  cleanSheet: {
    home: { yes: string; no: string };
    away: { yes: string; no: string };
  };
};

export type FixtureOddsResponse = {
  bookmaker: { id?: number | null; name?: string | null } | null;
  odds: FixtureOdds;
};

function normalizeBookmaker(name?: string | null) {
  return String(name ?? "").trim().toLowerCase();
}

function formatOdd(value: any) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return parsed.toFixed(2);
}

function buildEmptyOdds(): FixtureOdds {
  return {
    overUnder: {
      over: Object.fromEntries(OVER_UNDER_LINES.map((line) => [line, "-"])),
      under: Object.fromEntries(OVER_UNDER_LINES.map((line) => [line, "-"])),
    },
    doubleChance: {
      "1X": "-",
      X2: "-",
      "12": "-",
    },
    btts: {
      yes: "-",
      no: "-",
    },
    cleanSheet: {
      home: { yes: "-", no: "-" },
      away: { yes: "-", no: "-" },
    },
  };
}

export function parseFixtureOddsFromApi(
  apiResponse: any,
  bookmakerId?: number | null,
  bookmakerName?: string | null
): FixtureOddsResponse {
  const response = Array.isArray(apiResponse?.response) ? apiResponse.response : [];
  const fixtureRow = response[0] ?? null;
  const bookmakers = Array.isArray(fixtureRow?.bookmakers) ? fixtureRow.bookmakers : [];

  const byId =
    Number.isFinite(bookmakerId) && bookmakerId != null
      ? bookmakers.find((bm: any) => Number(bm?.id) === Number(bookmakerId))
      : null;
  const byName = bookmakerName
    ? bookmakers.find(
        (bm: any) =>
          normalizeBookmaker(bm?.name) === normalizeBookmaker(bookmakerName)
      )
    : null;
  const targetBookmaker = byId ?? byName ?? null;

  const odds = buildEmptyOdds();
  if (!targetBookmaker) {
    return { bookmaker: null, odds };
  }

  const bets = Array.isArray(targetBookmaker?.bets) ? targetBookmaker.bets : [];
  bets.forEach((bet: any) => {
    const betId = Number(bet?.id);
    const betName = normalizeBookmaker(bet?.name);
    const values = Array.isArray(bet?.values) ? bet.values : [];
    const hasBetId = Number.isFinite(betId);

    if (
      (hasBetId && OVER_UNDER_IDS.has(betId)) ||
      (!hasBetId && (betName.includes("over/under") || betName.includes("goals over/under")))
    ) {
      values.forEach((entry: any) => {
        const raw = String(entry?.value ?? "");
        const match = raw.match(/^(Over|Under)\s*([0-9.]+)/i);
        if (!match) return;
        const line = match[2];
        if (!OVER_UNDER_LINES.includes(line as (typeof OVER_UNDER_LINES)[number])) return;
        const formatted = formatOdd(entry?.odd ?? entry?.odds);
        if (match[1].toLowerCase() === "over") {
          odds.overUnder.over[line] = formatted;
        } else {
          odds.overUnder.under[line] = formatted;
        }
      });
    }

    if (
      (hasBetId && DOUBLE_CHANCE_IDS.has(betId)) ||
      (!hasBetId && betName.includes("double chance"))
    ) {
      values.forEach((entry: any) => {
        const raw = normalizeBookmaker(entry?.value ?? "");
        const formatted = formatOdd(entry?.odd ?? entry?.odds);
        if (raw === "home/draw" || raw === "1x") {
          odds.doubleChance["1X"] = formatted;
        } else if (raw === "draw/away" || raw === "x2") {
          odds.doubleChance.X2 = formatted;
        } else if (raw === "home/away" || raw === "12") {
          odds.doubleChance["12"] = formatted;
        }
      });
    }

    if (
      (hasBetId && BTTS_IDS.has(betId)) ||
      (!hasBetId && betName.includes("both teams score"))
    ) {
      values.forEach((entry: any) => {
        const raw = normalizeBookmaker(entry?.value ?? "");
        const formatted = formatOdd(entry?.odd ?? entry?.odds);
        if (raw === "yes") odds.btts.yes = formatted;
        if (raw === "no") odds.btts.no = formatted;
      });
    }

    if (
      (hasBetId && CLEAN_SHEET_HOME_IDS.has(betId)) ||
      (!hasBetId && betName.includes("clean sheet - home"))
    ) {
      values.forEach((entry: any) => {
        const raw = normalizeBookmaker(entry?.value ?? "");
        const formatted = formatOdd(entry?.odd ?? entry?.odds);
        if (raw === "yes") odds.cleanSheet.home.yes = formatted;
        if (raw === "no") odds.cleanSheet.home.no = formatted;
      });
    }

    if (
      (hasBetId && CLEAN_SHEET_AWAY_IDS.has(betId)) ||
      (!hasBetId && betName.includes("clean sheet - away"))
    ) {
      values.forEach((entry: any) => {
        const raw = normalizeBookmaker(entry?.value ?? "");
        const formatted = formatOdd(entry?.odd ?? entry?.odds);
        if (raw === "yes") odds.cleanSheet.away.yes = formatted;
        if (raw === "no") odds.cleanSheet.away.no = formatted;
      });
    }
  });

  return {
    bookmaker: {
      id: targetBookmaker?.id ?? null,
      name: targetBookmaker?.name ?? null,
    },
    odds,
  };
}

export async function fetchFixtureOddsFromApi(params: {
  fixtureId: number;
  leagueId: number;
  season: number;
  bookmakerId?: number | null;
  bookmakerName?: string | null;
}): Promise<FixtureOddsResponse> {
  const api = await fetchApi("odds", {
    fixture: params.fixtureId,
    league: params.leagueId,
    season: params.season,
  });

  return parseFixtureOddsFromApi(api, params.bookmakerId, params.bookmakerName);
}
