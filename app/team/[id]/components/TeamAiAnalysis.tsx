"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { getProbabilityEngines } from "@/lib/adapters/probabilities";
import { getTeamFixturesAllSeasons } from "@/lib/queries/fixtures";
import CharlyLottie from "./CharlyLottie";

type FilterKey = "FT" | "HT" | "2H";

type TextBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

type InlineChunk = {
  text: string;
  bold: boolean;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type Props = {
  team: Record<string, any> | null;
  league: Record<string, any> | null;
  nextMatch: Record<string, any> | null;
  fixtures: Record<string, any>[];
  opponentFixtures: Record<string, any>[];
  filter: FilterKey;
  range?: number | "season";
  nextOpponentName?: string | null;
  nextOpponentId?: number | null;
  analysisEndpoint?: string;
  chatEndpoint?: string;
  payloadExtra?: Record<string, any> | null;
  autoPrompt?: string;
};

const CHAT_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CHAT_MESSAGES = 12;
const AI_FIXTURES_LIMIT = 50;
const PENDING_PROMPT_KEY = "team-ai-pending-prompt";
const PLACEHOLDER_VARIANTS = [
  "Ecris ta question",
  "Demande moi une analyse",
  "Tu veux mon avis sur une tendance?",
];

function createMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getFixtureTimestamp(fixture: any) {
  const raw =
    fixture?.date_utc ??
    fixture?.date ??
    fixture?.fixture?.date ??
    fixture?.timestamp ??
    null;
  if (raw == null) return 0;
  if (typeof raw === "number") {
    return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  }
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getFixtureTeamIds(fixture: any) {
  const homeId =
    fixture?.home_team_id ??
    fixture?.fixture?.teams?.home?.id ??
    fixture?.teams?.home?.id ??
    null;
  const awayId =
    fixture?.away_team_id ??
    fixture?.fixture?.teams?.away?.id ??
    fixture?.teams?.away?.id ??
    null;
  return { homeId, awayId };
}

function normalizeFixtures(fixtures: any[], teamId: number, limit = AI_FIXTURES_LIMIT) {
  const played = (fixtures ?? []).filter(
    (f) => f?.goals_home != null && f?.goals_away != null
  );
  const sorted = [...played].sort(
    (a, b) => getFixtureTimestamp(b) - getFixtureTimestamp(a)
  );
  return sorted.slice(0, limit).map((f) => {
    const isHome = f.home_team_id === teamId;
    return {
      ...f,
      isHome,
      home_team_name: f.teams?.name ?? f.home_team_name ?? "Unknown",
      home_team_logo: f.teams?.logo ?? f.home_team_logo ?? null,
      away_team_name: f.opp?.name ?? f.away_team_name ?? "Unknown",
      away_team_logo: f.opp?.logo ?? f.away_team_logo ?? null,
    };
  });
}

function buildAiFixtures(fixtures: any[], teamId?: number | null) {
  if (!teamId) return [];
  return (fixtures ?? []).map((f) => {
    const isHome = typeof f.isHome === "boolean" ? f.isHome : f.home_team_id === teamId;
    const goalsFor = isHome ? f.goals_home : f.goals_away;
    const goalsAgainst = isHome ? f.goals_away : f.goals_home;
    const opponent = isHome
      ? f.away_team_name ?? f.opp?.name ?? null
      : f.home_team_name ?? f.teams?.name ?? null;
    const totalGoals = Number(goalsFor ?? 0) + Number(goalsAgainst ?? 0);
    const result = goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
    return {
      date: f.date_utc ?? f.date ?? f.fixture?.date ?? null,
      isHome,
      opponent,
      goalsFor,
      goalsAgainst,
      totalGoals,
      result,
      flags: {
        over35: totalGoals > 3.5,
        under35: totalGoals <= 3.5,
        draw: goalsFor === goalsAgainst,
        btts: Number(goalsFor ?? 0) > 0 && Number(goalsAgainst ?? 0) > 0,
      },
    };
  });
}

function stripMathFromText(text: string) {
  let cleaned = text ?? "";
  cleaned = cleaned.replace(/<\/?trend>/g, "");
  cleaned = cleaned.replace(/^\s*[-*]\s*Encha[iî]nements?\s+r[eé]cents?\s*:?\s*$/gim, "");
  cleaned = cleaned.replace(/\\\[[\s\S]*?\\\]/g, "");
  cleaned = cleaned.replace(/\\\([\s\S]*?\\\)/g, "");
  cleaned = cleaned.replace(/\\(frac|left|right|times|approx|text)\b[^\n]*/g, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}

function parseAiText(text: string): TextBlock[] {
  const lines = stripMathFromText(text).split(/\r?\n/);
  const blocks: TextBlock[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (listType && listItems.length) {
      blocks.push({ type: listType, items: listItems });
    }
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const headingMatch = line.match(/^#{1,3}\s+(.*)$/);
    if (headingMatch) {
      flushList();
      blocks.push({ type: "heading", text: headingMatch[1].trim() });
      continue;
    }

    if (line.endsWith(":") && line.length <= 40) {
      flushList();
      blocks.push({ type: "heading", text: line.slice(0, -1).trim() });
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listItems.push(bulletMatch[1].trim());
      continue;
    }

    const orderedMatch = line.match(/^\d+[\).]\s+(.*)$/);
    if (orderedMatch) {
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listItems.push(orderedMatch[1].trim());
      continue;
    }

    flushList();
    const last = blocks[blocks.length - 1];
    if (last?.type === "paragraph") {
      last.text = `${last.text} ${line}`.trim();
    } else {
      blocks.push({ type: "paragraph", text: line });
    }
  }

  flushList();
  return blocks;
}

function splitBoldSegments(text: string): InlineChunk[] {
  const chunks: InlineChunk[] = [];
  let current = "";
  let bold = false;
  let i = 0;

  while (i < text.length) {
    if (text[i] === "*" && text[i + 1] === "*") {
      if (current) {
        chunks.push({ text: current, bold });
        current = "";
      }
      bold = !bold;
      i += 2;
      continue;
    }
    current += text[i];
    i += 1;
  }

  if (current) {
    chunks.push({ text: current, bold });
  }

  return chunks;
}

function splitKeyPointItem(item: string) {
  const trimmed = item.trim();
  const boldMatch = trimmed.match(/^\*\*(.+?)\*\*\s*:\s*(.+)$/);
  if (boldMatch) {
    return { title: boldMatch[1].trim(), body: boldMatch[2].trim() };
  }
  const simpleMatch = trimmed.match(/^([^:]+):\s*(.+)$/);
  if (simpleMatch) {
    return { title: simpleMatch[1].trim(), body: simpleMatch[2].trim() };
  }
  return { title: null, body: trimmed };
}

function highlightPercentages(text: string) {
  const parts = text.split(/(\d+(?:[.,]\d+)?%)/g);
  return parts.map((part, idx) => {
    if (/^\d+(?:[.,]\d+)?%$/.test(part)) {
      return (
        <span key={`pct-${idx}`} className="text-orange-400 font-bold">
          {part}
        </span>
      );
    }
    return <span key={`txt-${idx}`}>{part}</span>;
  });
}

function renderInlineText(text: string) {
  const chunks = splitBoldSegments(text);
  return chunks.map((chunk, idx) => {
    const content = highlightPercentages(chunk.text);
    if (chunk.bold) {
      return (
        <strong key={`bold-${idx}`} className="font-semibold">
          {content}
        </strong>
      );
    }
    return <span key={`txt-${idx}`}>{content}</span>;
  });
}

function renderAiContent(text: string) {
  const blocks = parseAiText(text);
  return (
    <div className="space-y-1 leading-snug text-justify">
      {blocks.map((block, idx) => {
        if (block.type === "heading") {
          return (
            <div
              key={`heading-${idx}`}
              className="text-emerald-300 font-semibold tracking-wide"
            >
              {renderInlineText(block.text)}
            </div>
          );
        }
        if (block.type === "ul") {
          const items: React.ReactNode[] = [];
          let pendingTitle: string | null = null;

          block.items.forEach((item, itemIdx) => {
            const trimmed = item.trim();
            const isTitleOnly =
              trimmed.endsWith(":") && trimmed.replace(/[:\s]/g, "").length > 0;
            if (isTitleOnly) {
              pendingTitle = trimmed.slice(0, -1).trim();
              return;
            }

            const { title, body } = splitKeyPointItem(item);
            const resolvedTitle = title ?? pendingTitle;
            pendingTitle = null;
            items.push(
              <li
                key={`ul-${idx}-${itemIdx}`}
                className="rounded-lg border border-white/10 bg-black/35 p-3 leading-snug"
              >
                {resolvedTitle ? (
                  <div className="text-xs uppercase tracking-wide text-white/60">
                    {renderInlineText(resolvedTitle)}
                  </div>
                ) : null}
                <div className={resolvedTitle ? "mt-1" : ""}>
                  {renderInlineText(body)}
                </div>
              </li>
            );
          });

          return (
            <ul
              key={`ul-${idx}`}
              className="grid gap-2 text-white/90 list-none sm:grid-cols-2"
            >
              {items}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol
              key={`ol-${idx}`}
              className="space-y-1 text-white/90 list-none sm:list-decimal sm:list-inside"
            >
              {block.items.map((item, itemIdx) => {
                const { title, body } = splitKeyPointItem(item);
                return (
                  <li key={`ol-${idx}-${itemIdx}`} className="leading-snug">
                    <div className="flex flex-col gap-1 sm:hidden">
                      {title ? (
                        <span className="text-sky-300 font-semibold">
                          {renderInlineText(title)}
                        </span>
                      ) : null}
                      <span>{renderInlineText(body)}</span>
                    </div>
                    <div className="hidden sm:block">{renderInlineText(item)}</div>
                  </li>
                );
              })}
            </ol>
          );
        }
        return (
          <p key={`p-${idx}`} className="text-white/90">
            {renderInlineText(block.text)}
          </p>
        );
      })}
    </div>
  );
}

export default function TeamAiAnalysis({
  team,
  league,
  nextMatch,
  fixtures,
  opponentFixtures,
  filter,
  range,
  nextOpponentName,
  nextOpponentId,
  analysisEndpoint,
  chatEndpoint,
  payloadExtra,
  autoPrompt,
}: Props) {
  const [analysis, setAnalysis] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(null);
  const [fullFixtures, setFullFixtures] = useState<any[]>([]);
  const [fullOpponentFixtures, setFullOpponentFixtures] = useState<any[]>([]);
  const [isAnalysisCollapsed, setIsAnalysisCollapsed] = useState(false);
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState(
    PLACEHOLDER_VARIANTS[0]
  );
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const hasAutoCollapsedRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const pendingPromptRef = useRef<string | null>(null);
  const hasSentPendingRef = useRef(false);
  const hasSentAutoPromptRef = useRef(false);
  const placeholderStateRef = useRef({
    index: 0,
    char: 0,
    direction: 1,
    pause: 6,
  });
  const analysisUrl = analysisEndpoint ?? "/api/ai/team-analysis";
  const chatUrl = chatEndpoint ?? "/api/ai/team-chat";

  const { engines, computeStreaks } = getProbabilityEngines();
  const computeEngine = engines[filter];

  const stats = useMemo(() => computeEngine(fixtures ?? []), [computeEngine, fixtures]);
  const streaks = useMemo(() => computeStreaks(fixtures ?? []), [computeStreaks, fixtures]);
  const opponentStats = useMemo(
    () => (opponentFixtures?.length ? computeEngine(opponentFixtures) : null),
    [computeEngine, opponentFixtures]
  );
  const opponentStreaks = useMemo(
    () => (opponentFixtures?.length ? computeStreaks(opponentFixtures) : null),
    [computeStreaks, opponentFixtures]
  );
  const fullStats = useMemo(
    () => (fullFixtures?.length ? computeEngine(fullFixtures) : null),
    [computeEngine, fullFixtures]
  );
  const fullStreaks = useMemo(
    () => (fullFixtures?.length ? computeStreaks(fullFixtures) : null),
    [computeStreaks, fullFixtures]
  );
  const opponentFullStats = useMemo(
    () => (fullOpponentFixtures?.length ? computeEngine(fullOpponentFixtures) : null),
    [computeEngine, fullOpponentFixtures]
  );
  const opponentFullStreaks = useMemo(
    () => (fullOpponentFixtures?.length ? computeStreaks(fullOpponentFixtures) : null),
    [computeStreaks, fullOpponentFixtures]
  );

  const recentFixtures = useMemo(
    () => buildAiFixtures(fullFixtures ?? [], team?.id),
    [fullFixtures, team?.id]
  );
  const opponentRecentFixtures = useMemo(
    () => buildAiFixtures(fullOpponentFixtures ?? [], nextOpponentId),
    [fullOpponentFixtures, nextOpponentId]
  );
  const h2hRawFixtures = useMemo(() => {
    const teamId = Number(team?.id);
    const opponentId = Number(nextOpponentId);
    if (!Number.isFinite(teamId) || !Number.isFinite(opponentId)) return [];
    const matches = (fullFixtures ?? []).filter((fixture) => {
      const { homeId, awayId } = getFixtureTeamIds(fixture);
      if (!homeId || !awayId) return false;
      return (
        (homeId === teamId && awayId === opponentId) ||
        (homeId === opponentId && awayId === teamId)
      );
    });
    matches.sort((a, b) => getFixtureTimestamp(b) - getFixtureTimestamp(a));
    return matches.slice(0, 20);
  }, [fullFixtures, team?.id, nextOpponentId]);
  const h2hFixtures = useMemo(
    () => buildAiFixtures(h2hRawFixtures ?? [], team?.id),
    [h2hRawFixtures, team?.id]
  );
  const h2hStats = useMemo(
    () => (h2hRawFixtures.length ? computeEngine(h2hRawFixtures) : null),
    [computeEngine, h2hRawFixtures]
  );
  const h2hStreaks = useMemo(
    () => (h2hRawFixtures.length ? computeStreaks(h2hRawFixtures) : null),
    [computeStreaks, h2hRawFixtures]
  );

  useEffect(() => {
    let active = true;
    const teamId = Number(team?.id);
    if (!Number.isFinite(teamId)) {
      setFullFixtures([]);
      return () => {
        active = false;
      };
    }
    const load = async () => {
      try {
        const raw = await getTeamFixturesAllSeasons(teamId);
        if (!active) return;
        setFullFixtures(normalizeFixtures(raw ?? [], teamId));
      } catch {
        if (active) setFullFixtures([]);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [team?.id]);

  useEffect(() => {
    let active = true;
    const opponentId = Number(nextOpponentId);
    if (!Number.isFinite(opponentId)) {
      setFullOpponentFixtures([]);
      return () => {
        active = false;
      };
    }
    const load = async () => {
      try {
        const raw = await getTeamFixturesAllSeasons(opponentId);
        if (!active) return;
        setFullOpponentFixtures(normalizeFixtures(raw ?? [], opponentId));
      } catch {
        if (active) setFullOpponentFixtures([]);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [nextOpponentId]);

  const payload = useMemo(
    () => ({
      filter,
      range,
      team: {
        id: team?.id ?? null,
        name: team?.name ?? null,
        league: league?.name ?? null,
      },
      nextOpponent: {
        name: nextOpponentName ?? null,
        id: nextOpponentId ?? null,
      },
      nextMatch: nextMatch
        ? {
            date: nextMatch?.fixture?.date ?? nextMatch?.fixture?.timestamp ?? null,
            venue: nextMatch?.fixture?.venue?.name ?? null,
            status: nextMatch?.fixture?.status?.short ?? null,
          }
        : null,
      fixturesCount: fixtures?.length ?? 0,
      opponentFixturesCount: opponentFixtures?.length ?? 0,
      recentFixturesCount: recentFixtures?.length ?? 0,
      recentFixturesOrder: "desc",
      recentFixtures,
      stats,
      streaks,
      opponentStats,
      opponentStreaks,
      recentStats: fullStats,
      recentStreaks: fullStreaks,
      opponentRecentStats: opponentFullStats,
      opponentRecentStreaks: opponentFullStreaks,
      opponentRecentFixtures,
      h2hFixturesCount: h2hFixtures?.length ?? 0,
      h2hFixtures,
      h2hStats,
      h2hStreaks,
      extra: payloadExtra ?? null,
    }),
    [
      filter,
      range,
      team,
      league,
      nextOpponentName,
      nextOpponentId,
      nextMatch,
      fixtures,
      opponentFixtures,
      recentFixtures,
      stats,
      streaks,
      opponentStats,
      opponentStreaks,
      fullStats,
      fullStreaks,
      opponentFullStats,
      opponentFullStreaks,
      opponentRecentFixtures,
      h2hFixtures,
      h2hStats,
      h2hStreaks,
      payloadExtra,
    ]
  );

  const fixturesCount = fixtures?.length ?? 0;
  const opponentFixturesCount = opponentFixtures?.length ?? 0;
  const rangeKey = range === "season" ? "season" : `${range ?? "all"}`;
  const cacheKey = useMemo(() => {
    if (!team?.id) return null;
    return `team-ai-chat:${team.id}:${filter}:${rangeKey}:${fixturesCount}:${opponentFixturesCount}`;
  }, [team?.id, filter, rangeKey, fixturesCount, opponentFixturesCount]);

  useEffect(() => {
    if (!cacheKey) return;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) {
        setAnalysis("");
        setMessages([]);
        setCacheTimestamp(null);
        return;
      }
      const parsed = JSON.parse(raw);
      const updatedAt = Number(parsed?.updatedAt ?? 0);
      if (!updatedAt || Date.now() - updatedAt > CHAT_CACHE_TTL_MS) {
        localStorage.removeItem(cacheKey);
        setAnalysis("");
        setMessages([]);
        setCacheTimestamp(null);
        return;
      }
      setAnalysis(typeof parsed?.analysis === "string" ? parsed.analysis : "");
      setMessages(Array.isArray(parsed?.messages) ? parsed.messages : []);
      setCacheTimestamp(updatedAt);
    } catch {
      setAnalysis("");
      setMessages([]);
      setCacheTimestamp(null);
    }
  }, [cacheKey]);

  useEffect(() => {
    if (!cacheKey) return;
    if (!analysis && messages.length === 0) {
      localStorage.removeItem(cacheKey);
      setCacheTimestamp(null);
      return;
    }
    const updatedAt = Date.now();
    const cached = { analysis, messages, updatedAt };
    localStorage.setItem(cacheKey, JSON.stringify(cached));
    setCacheTimestamp(updatedAt);
  }, [cacheKey, analysis, messages]);

  useEffect(() => {
    if (hasAutoCollapsedRef.current) return;
    if (messages.some((msg) => msg.role === "user")) {
      setIsAnalysisCollapsed(true);
      hasAutoCollapsedRef.current = true;
    }
  }, [messages]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    let active = true;
    let timeout: number | null = null;

    const tick = () => {
      if (!active) return;
      const state = placeholderStateRef.current;
      const phrase = PLACEHOLDER_VARIANTS[state.index];

      if (state.pause > 0) {
        state.pause -= 1;
        timeout = window.setTimeout(tick, 200);
        return;
      }

      if (state.direction === 1) {
        state.char += 1;
        if (state.char >= phrase.length) {
          state.char = phrase.length;
          state.direction = -1;
          state.pause = 8;
        }
      } else {
        state.char -= 1;
        if (state.char <= 0) {
          state.char = 0;
          state.direction = 1;
          state.index = (state.index + 1) % PLACEHOLDER_VARIANTS.length;
          state.pause = 4;
        }
      }

      const next = phrase.slice(0, state.char);
      setAnimatedPlaceholder(next || " ");
      timeout = window.setTimeout(tick, state.direction === 1 ? 70 : 40);
    };

    timeout = window.setTimeout(tick, 400);
    return () => {
      active = false;
      if (timeout) window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, streaming]);

  const requestAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(analysisUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Echec de l'analyse IA");
      }
      const analysisText = json?.analysis ?? "";
      setAnalysis(analysisText);
      setIsAnalysisCollapsed(false);
      hasAutoCollapsedRef.current = false;
      return analysisText;
    } catch (err: any) {
      setAnalysis("");
      setError(err?.message ?? "Erreur inconnue");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const sendChatMessage = async (text: string, analysisOverride?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (streaming) return;
    const analysisText = analysisOverride ?? analysis;
    if (!analysisText) {
      setChatError("Lance l'analyse avant de poser une question.");
      return;
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };
    const assistantMessage: ChatMessage = {
      id: createMessageId(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
    setStreaming(true);
    setChatError(null);

    const contextMessages = [...messagesRef.current, userMessage]
      .slice(-MAX_CHAT_MESSAGES)
      .map((msg) => ({ role: msg.role, content: msg.content }));

    try {
      const res = await fetch(chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis: analysisText,
          payload,
          messages: contextMessages,
          filter,
          teamName: team?.name ?? null,
          opponentName: nextOpponentName ?? null,
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(text || "Erreur IA.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessage.id
              ? { ...msg, content: assistantText }
              : msg
          )
        );
      }
    } catch (err: any) {
      setChatError(err?.message ?? "Erreur inconnue.");
      setMessages((prev) => prev.filter((msg) => msg.id !== assistantMessage.id));
    } finally {
      setStreaming(false);
    }
  };

  const handleAnalyze = async () => {
    try {
      await requestAnalysis();
    } catch {
      // Errors handled in requestAnalysis.
    }
  };

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    await sendChatMessage(trimmed);
  };

  useEffect(() => {
    if (!team?.id) return;
    if (pendingPromptRef.current || hasSentPendingRef.current) return;
    try {
      const raw = localStorage.getItem(PENDING_PROMPT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.teamId !== team.id) return;
      if (typeof parsed?.prompt !== "string" || !parsed.prompt.trim()) return;
      pendingPromptRef.current = parsed.prompt.trim();
    } catch {
      // Ignore invalid cached prompt.
    }
  }, [team?.id]);

  useEffect(() => {
    const pending = pendingPromptRef.current;
    if (!pending || hasSentPendingRef.current) return;
    if (streaming) return;
    const run = async () => {
      hasSentPendingRef.current = true;
      pendingPromptRef.current = null;
      try {
        localStorage.removeItem(PENDING_PROMPT_KEY);
      } catch {
        // Ignore storage failures.
      }
      let analysisText = analysis;
      if (!analysisText) {
        try {
          analysisText = await requestAnalysis();
        } catch (err: any) {
          setChatError(err?.message ?? "Erreur inconnue.");
          return;
        }
      }
      await sendChatMessage(pending, analysisText);
    };
    run();
  }, [analysis, streaming]);

  useEffect(() => {
    if (!autoPrompt || hasSentAutoPromptRef.current) return;
    if (!team?.id) return;
    if (streaming) return;
    if (messagesRef.current.some((msg) => msg.role === "user")) return;
    const run = async () => {
      hasSentAutoPromptRef.current = true;
      let analysisText = analysis;
      if (!analysisText) {
        try {
          analysisText = await requestAnalysis();
        } catch (err: any) {
          setChatError(err?.message ?? "Erreur inconnue.");
          return;
        }
      }
      await sendChatMessage(autoPrompt, analysisText);
    };
    run();
  }, [autoPrompt, analysis, streaming, team?.id]);

  return (
    <div className="w-full">
      <div className="rounded-xl p-6 text-white space-y-4 bg-[linear-gradient(135deg,_#1a3cff_0%,_#2d5bff_20%,_#3556b8_36%,_#6f6bd6_52%,_#f06bc5_70%,_#ff4f70_84%,_#ff6a2d_100%)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:justify-start">
            <CharlyLottie className="w-12 h-12 shrink-0" />
            <div className="text-center sm:text-left">
              <h2 className="text-lg font-semibold">Charly IA</h2>
              <p className="text-xs text-white/70">By WinAgain Pronostic</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={loading}
            className={`px-4 py-2 rounded-md text-sm font-semibold ${
              loading
                ? "bg-white/20 text-white/60"
                : "bg-transparent border border-white/60 text-white/90 hover:bg-white/10"
            }`}
          >
            {loading ? "Analyse..." : "Analyser"}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-emerald-200/80">
            <span>Analyse en cours</span>
            <span className="flex items-center gap-1">
              <span
                className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-bounce"
                style={{ animationDelay: "120ms" }}
              />
              <span
                className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-bounce"
                style={{ animationDelay: "240ms" }}
              />
            </span>
          </div>
        ) : null}

        {error ? (
          <div className="text-red-300 text-sm bg-red-900/30 border border-red-500/20 rounded-lg p-3">
            {error}
          </div>
        ) : null}

        {analysis ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-white/60">
              <span>{isAnalysisCollapsed ? "Analyse reduite" : "Analyse complete"}</span>
              <button
                type="button"
                onClick={() => setIsAnalysisCollapsed((prev) => !prev)}
                className="text-emerald-300 hover:text-emerald-200 font-semibold"
              >
                {isAnalysisCollapsed ? "Lire l'analyse" : "Reduire"}
              </button>
            </div>
            {!isAnalysisCollapsed ? (
              <div className="text-sm text-white/90">
                {renderAiContent(analysis)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="border-t border-white/10 pt-4 space-y-3">
          <div className="max-h-80 overflow-y-auto space-y-3 pr-1" ref={chatScrollRef}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`w-full sm:w-[60%] rounded-xl px-4 py-3 text-sm break-words leading-snug ${
                    msg.role === "user"
                      ? "bg-gradient-to-br from-sky-500/20 to-indigo-500/20 text-white text-right"
                      : "bg-transparent text-emerald-50 text-left"
                  }`}
                >
                  {msg.role === "assistant" ? renderAiContent(msg.content) : msg.content}
                </div>
              </div>
            ))}
          </div>

          {chatError ? (
            <div className="text-red-300 text-xs bg-red-900/30 border border-red-500/20 rounded-lg p-2">
              {chatError}
            </div>
          ) : null}

          <form onSubmit={handleSend} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={animatedPlaceholder}
                rows={4}
                className="w-full rounded-md bg-black/70 border border-white/10 px-3 py-2 pr-12 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/60"
                disabled={streaming}
              />
              <button
                type="submit"
                disabled={streaming || !analysis}
                aria-label="Envoyer"
                className={`absolute top-1/2 -translate-y-1/2 right-2 w-9 h-9 rounded-md text-sm font-semibold flex items-center justify-center ${
                  streaming || !analysis
                    ? "bg-white/20 text-white/50"
                    : "bg-emerald-500 hover:bg-emerald-400 text-white"
                }`}
              >
                {streaming ? (
                  "..."
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M22 2L11 13" />
                    <path d="M22 2L15 22l-4-9-9-4 20-7z" />
                  </svg>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
