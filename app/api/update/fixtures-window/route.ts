import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshFixturesWindow } from "@/lib/fixtures/refreshFixturesWindow";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const TIMEZONE = "America/Toronto";

type Ymd = { year: number; month: number; day: number };

function getTzYmd(date: Date, timeZone: string): Ymd {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function formatKey(value: Ymd) {
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function addDays(value: Ymd, delta: number): Ymd {
  const d = new Date(Date.UTC(value.year, value.month - 1, value.day + delta, 12, 0, 0));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function parseTtlMinutes(raw: string | null) {
  if (!raw) return 10;
  const ttl = Number(raw);
  if (!Number.isFinite(ttl) || ttl < 0) return 10;
  return Math.round(ttl);
}

export async function GET(req: Request) {
  const supabase = createClient();
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const ttlMinutes = parseTtlMinutes(url.searchParams.get("ttl"));
  const force = url.searchParams.get("force") === "1";
  const includeTeams = url.searchParams.get("teams") === "1";

  const dateKeys =
    date && date.trim().length > 0
      ? [date.trim()]
      : (() => {
          const today = getTzYmd(new Date(), TIMEZONE);
          const yesterday = addDays(today, -1);
          const tomorrow = addDays(today, 1);
          return [formatKey(yesterday), formatKey(today), formatKey(tomorrow)];
        })();

  if (dateKeys.some((key) => !/^\d{4}-\d{2}-\d{2}$/.test(key))) {
    return NextResponse.json(
      { ok: false, error: "Invalid date key (expected YYYY-MM-DD)", dateKeys },
      { status: 400 }
    );
  }

  const result = await refreshFixturesWindow(supabase as any, {
    dateKeys,
    ttlMinutes,
    force,
    timeZone: TIMEZONE,
    includeTeams,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

