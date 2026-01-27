"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Bet, BetResult, BetSelection } from "../utils/bankroll";

type Props = {
  bets: Bet[];
  onUpdate: (id: string, patch: Partial<Omit<Bet, "id">>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

type BetGroup = {
  date: string;
  items: Bet[];
};

export default function BetsTable({ bets, onUpdate, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Bet>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const indexMap = useMemo(() => {
    const asc = [...bets].sort((a, b) => (a.bet_date > b.bet_date ? 1 : -1));
    const map = new Map<string, number>();
    asc.forEach((b, idx) => map.set(b.id, idx + 1));
    return map;
  }, [bets]);
  const groupedBets = useMemo<BetGroup[]>(() => {
    const map = new Map<string, Bet[]>();
    bets.forEach((bet) => {
      const key = bet.bet_date;
      const list = map.get(key) ?? [];
      list.push(bet);
      map.set(key, list);
    });
    const keys = Array.from(map.keys()).sort(
      (a, b) => new Date(b).getTime() - new Date(a).getTime()
    );
    return keys.map((key) => ({
      date: key,
      items: (map.get(key) ?? []).sort((a, b) => {
        const timeA = new Date(a.created_at ?? a.bet_date).getTime();
        const timeB = new Date(b.created_at ?? b.bet_date).getTime();
        return timeB - timeA;
      }),
    }));
  }, [bets]);

  const startEdit = (bet: Bet) => {
    setEditingId(bet.id);
    setDraft({
      description: bet.description,
      bet_type: bet.bet_type,
      odds: bet.odds,
      stake: bet.stake,
      result: bet.result,
    });
  };

  const save = async (id: string) => {
    setBusyId(id);
    await onUpdate(id, draft);
    setBusyId(null);
    setEditingId(null);
  };

  const cancel = () => {
    setEditingId(null);
    setDraft({});
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white">
      <h3 className="font-semibold text-lg mb-3">Historique des paris</h3>
      {!bets.length ? (
        <div className="text-sm text-white/70">Aucun pari enregistré.</div>
      ) : (
        <div className="space-y-4">
          {groupedBets.map((group) => (
            <div
              key={group.date}
              className="space-y-3"
            >
              <div className="text-sm font-semibold text-white/80">
                {formatDayLabel(group.date)}
              </div>
              <div className="mt-3 space-y-2">
                {group.items.map((bet) => {
                  const isEditing = editingId === bet.id;
                  const resolvedResult = isEditing
                    ? ((draft.result as BetResult | undefined) ?? bet.result)
                    : bet.result;
                  const resultLabel = labelResult(resolvedResult);
                  const resultClass = resultBadgeClass(resolvedResult);
                  const borderClass = resultBorderClass(resolvedResult);
                  const selectionsText = formatSelections(bet.selections);
                  const selectionDisplay = selectionsText || bet.bet_type;
                  const notesText =
                    bet.bet_kind === "combined"
                      ? selectionsText
                      : `${bet.bet_type}${selectionsText ? ` | Selections: ${selectionsText}` : ""}`;
                  return (
                    <div
                      key={bet.id}
                      className={`rounded-lg border ${borderClass} bg-white/5 px-3 py-2`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-4 md:flex-nowrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
                            <span className="rounded-md border border-white/10 bg-white/10 px-2 py-0.5">
                              {bet.bet_kind === "combined" ? "Combiné" : "Simple"}
                            </span>
                            {isEditing ? (
                              <select
                                value={draft.result ?? bet.result}
                                onChange={(e) =>
                                  setDraft((d) => ({
                                    ...d,
                                    result: e.target.value as BetResult,
                                  }))
                                }
                                className="bg-[#1f0f3a] border border-white/20 rounded px-2 py-1 text-xs"
                              >
                                <option value="pending">En attente</option>
                                <option value="win">Gagné</option>
                                <option value="loss">Perdu</option>
                                <option value="void">Void</option>
                              </select>
                            ) : (
                              <span className={`rounded-full px-2 py-0.5 ${resultClass}`}>
                                {resultLabel}
                              </span>
                            )}
                            <span className="text-[10px] text-white/50">
                              #{indexMap.get(bet.id) ?? "-"}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1 text-base font-semibold text-white truncate">
                              {isEditing ? (
                                <input
                                  value={draft.description ?? ""}
                                  onChange={(e) =>
                                    setDraft((d) => ({
                                      ...d,
                                      description: e.target.value,
                                    }))
                                  }
                                  className="w-full bg-white/10 border border-white/20 rounded px-2 py-1"
                                />
                              ) : (
                                bet.description
                              )}
                            </div>
                            <div className="text-sm font-semibold text-white/80 md:hidden">
                              {isEditing ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  value={draft.odds ?? bet.odds}
                                  onChange={(e) =>
                                    setDraft((d) => ({
                                      ...d,
                                      odds: parseFloat(e.target.value),
                                    }))
                                  }
                                  className="w-20 bg-white/10 border border-white/20 rounded px-2 py-1 text-sm"
                                />
                              ) : (
                                `Cote ${bet.odds.toFixed(2)}`
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-white/60 truncate md:hidden">
                            {bet.bet_kind === "combined" && selectionsText
                              ? selectionsText
                              : selectionDisplay}
                          </div>
                          <div className="hidden md:block text-xs text-white/60 truncate">
                            {isEditing ? (
                              <input
                                value={draft.bet_type ?? ""}
                                onChange={(e) =>
                                  setDraft((d) => ({
                                    ...d,
                                    bet_type: e.target.value,
                                  }))
                                }
                                className="w-full bg-white/10 border border-white/20 rounded px-2 py-1"
                              />
                            ) : (
                              notesText
                            )}
                          </div>
                        </div>
                        <div className="hidden md:flex flex-wrap items-center gap-4 md:flex-nowrap">
                          <StatInline label="Cote">
                            {isEditing ? (
                              <input
                                type="number"
                                step="0.01"
                                value={draft.odds ?? bet.odds}
                                onChange={(e) =>
                                  setDraft((d) => ({
                                    ...d,
                                    odds: parseFloat(e.target.value),
                                  }))
                                }
                                className="w-20 bg-white/10 border border-white/20 rounded px-2 py-1 text-sm"
                              />
                            ) : (
                              bet.odds.toFixed(2)
                            )}
                          </StatInline>
                          <StatInline label="Mise">
                            {isEditing ? (
                              <input
                                type="number"
                                step="0.01"
                                value={draft.stake ?? bet.stake}
                                onChange={(e) =>
                                  setDraft((d) => ({
                                    ...d,
                                    stake: parseFloat(e.target.value),
                                  }))
                                }
                                className="w-24 bg-white/10 border border-white/20 rounded px-2 py-1 text-sm"
                              />
                            ) : (
                              formatMoney(bet.stake)
                            )}
                          </StatInline>
                          <StatInline
                            label="Profit"
                            accentClass={bet.profit >= 0 ? "text-emerald-300" : "text-red-300"}
                          >
                            {formatMoney(bet.profit)}
                          </StatInline>
                          <StatInline label="Bankroll">
                            {formatMoney(bet.bankroll_after)}
                          </StatInline>
                        </div>
                        <div className="flex items-center gap-2">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => save(bet.id)}
                                disabled={busyId === bet.id}
                                className="text-green-400 hover:underline disabled:opacity-70"
                              >
                                Sauver
                              </button>
                              <button
                                onClick={cancel}
                                className="text-white/70 hover:underline"
                              >
                                Annuler
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startEdit(bet)}
                                className="p-1.5 rounded-md border border-white/10 text-white/80 hover:text-white hover:bg-white/10"
                                aria-label="Editer"
                                title="Editer"
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  className="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={1.5}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M12 20h9" />
                                  <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                                </svg>
                                <span className="sr-only">Editer</span>
                              </button>
                              <button
                                onClick={() => onDelete(bet.id)}
                                className="p-1.5 rounded-md border border-white/10 text-red-300 hover:text-red-200 hover:bg-red-500/10"
                                aria-label="Supprimer"
                                title="Supprimer"
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  className="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={1.5}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M3 6h18" />
                                  <path d="M8 6V4h8v2" />
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                  <path d="M10 11v6" />
                                  <path d="M14 11v6" />
                                </svg>
                                <span className="sr-only">Supprimer</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function labelResult(result: BetResult) {
  switch (result) {
    case "win":
      return "Gagné";
    case "loss":
      return "Perdu";
    case "pending":
      return "En attente";
    case "void":
    default:
      return "Void";
  }
}

function formatDayLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  const label = date.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit" });
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : value;
}

function formatMoney(value: number) {
  return `${value.toFixed(2)} CAD`;
}

function resultBadgeClass(result: BetResult) {
  switch (result) {
    case "win":
      return "bg-emerald-500/20 text-emerald-200 border border-emerald-400/30";
    case "loss":
      return "bg-red-500/20 text-red-200 border border-red-400/30";
    case "pending":
      return "bg-yellow-500/20 text-yellow-100 border border-yellow-400/30";
    case "void":
    default:
      return "bg-white/10 text-white/70 border border-white/10";
  }
}

function resultBorderClass(result: BetResult) {
  switch (result) {
    case "win":
      return "border-emerald-400/50";
    case "loss":
      return "border-red-400/50";
    case "void":
      return "border-sky-400/50";
    case "pending":
    default:
      return "border-white/10";
  }
}

function formatSelections(selections?: BetSelection[] | null) {
  if (!selections?.length) return "";
  return selections
    .map((sel) => {
      const description = sel.description?.trim();
      const odds = Number.isFinite(sel.odds) ? sel.odds.toFixed(2) : "";
      if (description && odds) return `${description} (${odds})`;
      return description || odds;
    })
    .filter(Boolean)
    .join(" | ");
}

function StatInline({
  label,
  accentClass = "",
  children,
}: {
  label: string;
  accentClass?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-[80px]">
      <div className={`text-base font-semibold ${accentClass}`}>{children}</div>
      <div className="text-[11px] text-white/60">{label}</div>
    </div>
  );
}
