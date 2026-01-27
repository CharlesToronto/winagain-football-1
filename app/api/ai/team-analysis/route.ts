import { NextResponse } from "next/server";

type Payload = {
  filter?: string;
  team?: Record<string, any> | null;
  nextOpponent?: Record<string, any> | null;
  nextMatch?: Record<string, any> | null;
  fixturesCount?: number;
  opponentFixturesCount?: number;
  recentFixtures?: Record<string, any>[] | null;
  recentStats?: Record<string, any> | null;
  recentStreaks?: Record<string, any> | null;
  opponentRecentFixtures?: Record<string, any>[] | null;
  opponentRecentStats?: Record<string, any> | null;
  opponentRecentStreaks?: Record<string, any> | null;
  h2hFixturesCount?: number;
  h2hFixtures?: Record<string, any>[] | null;
  h2hStats?: Record<string, any> | null;
  h2hStreaks?: Record<string, any> | null;
  stats?: Record<string, any> | null;
  streaks?: Record<string, any> | null;
  opponentStats?: Record<string, any> | null;
  opponentStreaks?: Record<string, any> | null;
};

type CacheEntry = {
  value: string;
  createdAt: number;
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

const globalForCache = globalThis as typeof globalThis & {
  __teamAnalysisCache?: Map<string, CacheEntry>;
};

const analysisCache =
  globalForCache.__teamAnalysisCache ?? new Map<string, CacheEntry>();

globalForCache.__teamAnalysisCache = analysisCache;

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
    "Tu es un analyste football. Tu dois résumer la situation de l'équipe et du prochain adversaire " +
    "à partir des données JSON. Réponds en français, concis, clair, sans inventer. " +
    "Format Markdown strict (sans libellé 'Enchaînements récents'): " +
    "## Bilan (3-5 phrases) " +
    "## Points clés (3-6 puces avec '-') " +
    "Priorité: repère les enchaînements (2+ matchs consécutifs, 2/3/4/5...) " +
    "sur les événements comme over/under 3.5, résultat X/1/2, BTTS, clean sheet, " +
    "et indique aussi si ces enchaînements existent en H2H (si h2hFixtures est fourni). " +
    "Propose aussi une piste de contre-tendance quand une série est longue ou que " +
    "le taux de continuation est faible dans les streaks; sinon dis qu'il n'y a " +
    "pas de contre-tendance claire. " +
    "Si une liste est demandée, réponds en liste Markdown. " +
    "Si une info manque, dis-le clairement. " +
    "Mets en avant uniquement les stats entre 68% et 100% si elles existent. " +
    "Les listes de matchs sont ordonnées du plus récent au plus ancien. " +
    "Base l'analyse sur stats/streaks (sélection) et utilise recentFixtures/recentStats (50 matchs) pour comparer si besoin.";
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
        temperature: 0.4,
        max_tokens: 500,
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
