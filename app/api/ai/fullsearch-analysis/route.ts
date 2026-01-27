import { NextResponse } from "next/server";

type Payload = {
  meta?: Record<string, any>;
  bestResult?: Record<string, any> | null;
  topResults?: Record<string, any>[];
};

type CacheEntry = {
  value: string;
  createdAt: number;
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

const globalForCache = globalThis as typeof globalThis & {
  __fullsearchAnalysisCache?: Map<string, CacheEntry>;
};

const analysisCache =
  globalForCache.__fullsearchAnalysisCache ?? new Map<string, CacheEntry>();

globalForCache.__fullsearchAnalysisCache = analysisCache;

function pruneCache(now: number) {
  analysisCache.forEach((entry, key) => {
    if (now - entry.createdAt > CACHE_TTL_MS) {
      analysisCache.delete(key);
    }
  });
  if (analysisCache.size <= CACHE_MAX_ENTRIES) return;
  const overflow = analysisCache.size - CACHE_MAX_ENTRIES;
  const keys: string[] = [];
  analysisCache.forEach((_entry, key) => {
    keys.push(key);
  });
  for (let i = 0; i < overflow; i += 1) {
    const key = keys[i];
    if (!key) break;
    analysisCache.delete(key);
  }
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "OPENAI_API_KEY is not set." },
      { status: 500 }
    );
  }

  let body: { payload?: Payload } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const payload = body?.payload ?? {};
  const now = Date.now();
  pruneCache(now);
  const cacheKey = JSON.stringify(payload);
  const cached = analysisCache.get(cacheKey);
  if (cached && now - cached.createdAt <= CACHE_TTL_MS) {
    return NextResponse.json(
      { ok: true, analysis: cached.value, cached: true },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=3600",
          "X-Cache": "HIT",
        },
      }
    );
  }

  const systemPrompt =
    "Tu es Charly IA, analyste d'algorithmes de pronostics. " +
    "Tu reçois des résultats de tests (topResults) et un bestResult. " +
    "Réponds en français, clair, concis, sans inventer. " +
    "Format Markdown strict: " +
    "## Synthèse (2-4 phrases) " +
    "## Configs recommandées (3-5 puces avec '-') " +
    "## Conseils d'ajustement (2-4 puces) " +
    "## Points d'attention (1-3 puces) " +
    "Si les données sont insuffisantes, dis-le clairement. " +
    "Ne propose pas de paris, analyse uniquement les paramètres et les résultats.";

  const userPrompt = `Données JSON:\n${JSON.stringify(payload)}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.35,
        max_tokens: 450,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { ok: false, error: "OpenAI request failed.", details: errorText },
        { status: 500 }
      );
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    analysisCache.set(cacheKey, { value: content, createdAt: now });
    return NextResponse.json(
      { ok: true, analysis: content, cached: false },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=3600",
          "X-Cache": "MISS",
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "OpenAI request error." },
      { status: 500 }
    );
  }
}
