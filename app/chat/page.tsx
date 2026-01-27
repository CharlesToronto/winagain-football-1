"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";

type ChatMessage = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  user_email?: string | null;
  user_display_name?: string | null;
};

const MAX_MESSAGES = 200;

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function shouldAutoScroll(container: HTMLDivElement | null) {
  if (!container) return true;
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
  return distance < 120;
}

export default function ChatPage() {
  const [user, setUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    supabaseBrowser.auth.getUser().then(({ data }) => {
      if (!alive) return;
      setUser(data.user ?? null);
    });
    const { data: listener } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { data, error } = await supabaseBrowser
          .from("chat_messages")
          .select("id,content,created_at,user_id,user_email,user_display_name")
          .order("created_at", { ascending: true })
          .limit(MAX_MESSAGES);
        if (!active) return;
        if (error) {
          setError(error.message);
          setMessages([]);
          return;
        }
        setMessages((data ?? []) as ChatMessage[]);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const channel = supabaseBrowser
      .channel("chat-general")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const next = payload.new as ChatMessage;
          setMessages((prev) => {
            if (prev.some((msg) => msg.id === next.id)) return prev;
            return [...prev, next].slice(-MAX_MESSAGES);
          });
        }
      )
      .subscribe();

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!autoScroll) return;
    const container = listRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, autoScroll]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || !user) return;
    setBusy(true);
    setError(null);
    const payload = {
      content: trimmed,
      user_id: user.id,
      user_email: user.email ?? null,
      user_display_name:
        (user.user_metadata?.display_name as string | undefined) ?? null,
    };
    const { data, error } = await supabaseBrowser
      .from("chat_messages")
      .insert(payload)
      .select("id,content,created_at,user_id,user_email,user_display_name")
      .single();
    if (error) {
      setError(error.message);
    } else if (data) {
      setMessages((prev) => {
        if (prev.some((msg) => msg.id === data.id)) return prev;
        return [...prev, data].slice(-MAX_MESSAGES);
      });
      setInput("");
    }
    setBusy(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const statusLabel = useMemo(() => {
    if (loading) return "Chargement...";
    if (!user) return "Connecte-toi pour participer.";
    return `${messages.length} message${messages.length > 1 ? "s" : ""}`;
  }, [loading, user, messages.length]);

  return (
    <div className="min-h-screen p-6 text-white">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">Chat general</h1>
          <p className="text-sm text-white/70">
            Discussion en direct pour toute la communaute.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-400/50 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="bg-white/5 border border-white/10 rounded-2xl shadow flex flex-col h-[70vh]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="text-sm text-white/70">{statusLabel}</div>
            {user && (
              <div className="text-xs text-white/40">Connecte</div>
            )}
          </div>

          <div
            ref={listRef}
            onScroll={() => setAutoScroll(shouldAutoScroll(listRef.current))}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
          >
            {messages.length === 0 && !loading && (
              <div className="text-sm text-white/60">Aucun message pour le moment.</div>
            )}
            {messages.map((message) => {
              const isMine = user?.id === message.user_id;
              const displayName =
                message.user_display_name ||
                message.user_email ||
                (isMine ? "Moi" : "Utilisateur");
              return (
                <div
                  key={message.id}
                  className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      isMine
                        ? "bg-emerald-500/20 border border-emerald-400/30"
                        : "bg-white/10 border border-white/10"
                    }`}
                  >
                    <div className="text-[11px] text-white/60 mb-1">
                      {displayName}
                    </div>
                    <div className="whitespace-pre-wrap break-words">{message.content}</div>
                    <div className="text-[10px] text-white/40 mt-1 text-right">
                      {formatTime(message.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-white/10 p-4">
            {!user ? (
              <div className="text-sm text-white/60">
                Connecte-toi pour envoyer des messages.
              </div>
            ) : (
              <div className="flex gap-3">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  placeholder="Ecris ton message..."
                  className="flex-1 resize-none rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={busy || !input.trim()}
                  className="rounded-xl px-4 py-2 text-sm font-semibold bg-emerald-500/80 hover:bg-emerald-500 text-white disabled:opacity-50"
                >
                  Envoyer
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
