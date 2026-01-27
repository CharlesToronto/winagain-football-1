import { NextResponse } from "next/server";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type Payload = {
  analysis?: string;
  payload?: Record<string, any> | null;
  messages?: ChatMessage[];
  teamName?: string | null;
  opponentName?: string | null;
  filter?: string | null;
};

function normalizeMessages(messages: any): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (msg) =>
        msg &&
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.content === "string"
    )
    .map((msg) => ({ role: msg.role, content: msg.content }));
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "OPENAI_API_KEY is not set." },
      { status: 500 }
    );
  }

  let body: Payload = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const analysis = typeof body.analysis === "string" ? body.analysis : "";
  if (!analysis) {
    return NextResponse.json(
      { ok: false, error: "Missing analysis." },
      { status: 400 }
    );
  }

  const messages = normalizeMessages(body.messages).slice(-12);
  const contextParts = [
    `Analyse précédente:\n${analysis}`,
    body.payload ? `Données JSON:\n${JSON.stringify(body.payload)}` : "",
    `Équipe: ${body.teamName ?? "Inconnue"} | Adversaire: ${
      body.opponentName ?? "Inconnu"
    } | Filtre: ${body.filter ?? "FT"}`,
  ].filter(Boolean);

  const systemPrompt =
    "Tu es un analyste football. Réponds en français, concis, utile, " +
    "en te basant sur le contexte. " +
    "Priorise la recherche d'enchaînements (2+ matchs consécutifs, 2/3/4/5...) et " +
    "les opportunités de contre-tendance quand elles sont justifiées. " +
    "Si l'utilisateur demande une liste, réponds en liste Markdown. " +
    "Utilise des titres en Markdown (##) quand tu structures la réponse. " +
    "Si une info manque, dis-le clairement. " +
    "Si pertinent, mets en avant uniquement les stats entre 68% et 100%. " +
    "Les listes de matchs sont ordonnées du plus récent au plus ancien. " +
    "Utilise recentFixtures/recentStats (50 matchs) pour les comparaisons si besoin.";

  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: contextParts.join("\n\n") },
        ...messages,
      ],
      temperature: 0.4,
      max_tokens: 500,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errorText = await upstream.text();
    return NextResponse.json(
      { ok: false, error: "OpenAI request failed.", details: errorText },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";
      let closed = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.replace(/^data:\s*/, "");
            if (data === "[DONE]") {
              closed = true;
              controller.close();
              return;
            }
            try {
              const json = JSON.parse(data);
              const delta = json?.choices?.[0]?.delta?.content;
              if (delta) {
                controller.enqueue(encoder.encode(delta));
              }
            } catch {
              // Ignore malformed chunks
            }
          }
        }
      } catch (error) {
        closed = true;
        controller.error(error);
      } finally {
        if (!closed) {
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
