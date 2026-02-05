import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

const DENY_TABLES = new Set(["profiles", "daily_algo_picks", "daily_algo_picks_v2"]);
const MAX_ROWS = 5000;

const systemPrompt =
  "Tu es Charly IA. Tu réponds en français, clair et concis. " +
  "Tu peux lire la base via l'outil read_table. " +
  "Ne demande jamais d'infos personnelles. " +
  "Si une requête concerne des tables interdites (profiles, daily_algo_picks, daily_algo_picks_v2), refuse. " +
  "Utilise le contexte de page pour répondre quand la question concerne l'écran ouvert.";

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function handleReadTable(args: any) {
  const table = String(args?.table ?? "").trim();
  if (!table) {
    return { error: "Table manquante." };
  }
  if (DENY_TABLES.has(table)) {
    return { error: `Accès interdit à la table ${table}.` };
  }

  const columns =
    Array.isArray(args?.columns) && args.columns.length
      ? args.columns.map((col: any) => String(col)).join(",")
      : "*";

  const limitRaw = Number(args?.limit ?? 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), MAX_ROWS) : 200;
  const countOnly = Boolean(args?.count);

  const supabase = createClient();
  let query = supabase.from(table).select(columns, {
    count: countOnly ? "exact" : undefined,
    head: countOnly,
  });

  const filters = Array.isArray(args?.filters) ? args.filters : [];
  filters.forEach((filter: any) => {
    const column = String(filter?.column ?? "");
    const op = String(filter?.op ?? "eq");
    const value = filter?.value;
    if (!column) return;
    if (op === "eq") query = query.eq(column, value);
    if (op === "ilike") query = query.ilike(column, String(value ?? ""));
    if (op === "gte") query = query.gte(column, value);
    if (op === "lte") query = query.lte(column, value);
    if (op === "in" && Array.isArray(value)) query = query.in(column, value);
  });

  if (args?.orderBy?.column) {
    query = query.order(String(args.orderBy.column), {
      ascending: Boolean(args.orderBy.ascending ?? false),
    });
  }

  if (!countOnly) {
    query = query.range(0, limit - 1);
  }

  const { data, error, count } = await query;
  if (error) {
    return { error: error.message };
  }
  return { rows: data ?? [], count: count ?? null };
}

async function callOpenAI(messages: Message[], tools: any[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { error: "OPENAI_API_KEY is not set." };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      tools,
      temperature: 0.2,
      max_tokens: 600,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { error: "OpenAI request failed.", details: errorText };
  }

  const data = await response.json();
  return { data };
}

export async function POST(req: Request) {
  let body: { messages?: Message[]; context?: Record<string, any> } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const context = body.context ?? {};
  const lastUserMessage = [...incoming].reverse().find((msg) => msg.role === "user");
  const lastTextRaw = String(lastUserMessage?.content ?? "");
  const lastText = normalizeText(lastTextRaw);
  const path = String(context?.path ?? "");
  const teamIdMatch = path.match(/\/team\/(\d+)/);
  const teamId = teamIdMatch ? Number(teamIdMatch[1]) : null;

  if (
    teamId &&
    Number.isFinite(teamId) &&
    lastText.includes("dernier") &&
    (lastText.includes("resultat") || lastText.includes("score"))
  ) {
    const supabase = createClient();
    const { data: fixtures, error } = await supabase
      .from("fixtures")
      .select("id,date_utc,status_short,goals_home,goals_away,home_team_id,away_team_id")
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .eq("status_short", "FT")
      .order("date_utc", { ascending: false })
      .limit(1);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    const fixture = fixtures?.[0];
    if (!fixture) {
      return NextResponse.json({
        ok: true,
        reply: "Je ne trouve pas encore de match terminé pour cette équipe.",
      });
    }

    const teamIds = [fixture.home_team_id, fixture.away_team_id].filter(
      (id) => Number.isFinite(id)
    );
    const { data: teams } = await supabase
      .from("teams")
      .select("id,name")
      .in("id", teamIds);
    const teamMap = new Map<number, string>();
    (teams ?? []).forEach((row: any) => {
      const id = Number(row?.id);
      if (Number.isFinite(id)) teamMap.set(id, String(row?.name ?? ""));
    });

    const homeName = teamMap.get(fixture.home_team_id) ?? "Domicile";
    const awayName = teamMap.get(fixture.away_team_id) ?? "Extérieur";
    const score = `${fixture.goals_home ?? "-"} - ${fixture.goals_away ?? "-"}`;
    const dateLabel = fixture.date_utc
      ? new Date(fixture.date_utc).toLocaleDateString("fr-FR")
      : "date inconnue";

    return NextResponse.json({
      ok: true,
      reply: `Dernier résultat: ${homeName} ${score} ${awayName} (${dateLabel}).`,
    });
  }

  const tools = [
    {
      type: "function",
      function: {
        name: "read_table",
        description: "Lire des données en base (lecture seule).",
        parameters: {
          type: "object",
          properties: {
            table: { type: "string" },
            columns: { type: "array", items: { type: "string" } },
            filters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  column: { type: "string" },
                  op: { type: "string", enum: ["eq", "ilike", "gte", "lte", "in"] },
                  value: {},
                },
                required: ["column", "op", "value"],
              },
            },
            orderBy: {
              type: "object",
              properties: {
                column: { type: "string" },
                ascending: { type: "boolean" },
              },
            },
            limit: { type: "number" },
            count: { type: "boolean" },
          },
          required: ["table"],
        },
      },
    },
  ];

  const chatMessages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "system", content: `Contexte page: ${JSON.stringify(context)}` },
    ...incoming.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
  ];

  let toolIterations = 0;
  while (toolIterations < 3) {
    const result = await callOpenAI(chatMessages, tools);
    if (result.error) {
      return NextResponse.json({ ok: false, error: result.error, details: result.details }, { status: 500 });
    }
    const data = result.data;
    const message = data?.choices?.[0]?.message;
    const toolCalls: ToolCall[] = message?.tool_calls ?? [];
    const content = message?.content ?? "";

    if (!toolCalls.length) {
      return NextResponse.json({ ok: true, reply: content });
    }

    chatMessages.push({ role: "assistant", content: content || "", tool_calls: toolCalls });
    for (const call of toolCalls) {
      if (call.function?.name !== "read_table") continue;
      const args = safeJsonParse(call.function.arguments || "{}") || {};
      const resultPayload = await handleReadTable(args);
      chatMessages.push({
        role: "tool",
        tool_call_id: call.id,
        name: "read_table",
        content: JSON.stringify(resultPayload),
      });
    }
    toolIterations += 1;
  }

  return NextResponse.json({
    ok: false,
    error: "Trop d'appels outils, réessaie avec une question plus précise.",
  });
}
