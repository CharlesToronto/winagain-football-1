"use client";

import { useMemo, useState } from "react";
import { useCibleSelections } from "./useCibleSelections";
import {
  fetchBankrollBets,
  fetchBankrollSettings,
  upsertBankrollBets,
} from "@/lib/adapters/bankroll";
import { Bet, INITIAL_BANKROLL, recomputeSequence } from "@/app/bankroll/utils/bankroll";

type Variant = "sidebar" | "modal";

type Props = {
  variant?: Variant;
  onClose?: () => void;
};

function formatMatchLabel(selection: { matchLabel?: string | null }) {
  return selection.matchLabel ?? "Match";
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

export default function CiblePanel({ variant = "sidebar", onClose }: Props) {
  const { selections, removeSelection, clearSelections } = useCibleSelections();
  const [stake, setStake] = useState(10);
  const [odds, setOdds] = useState(1.9);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const panelClass =
    variant === "modal"
      ? "rounded-2xl border border-white/10 bg-[#120a24] p-4 shadow-2xl text-white"
      : "rounded-xl border border-white/10 bg-white/5 p-4 text-white";

  const listClass =
    variant === "modal" ? "max-h-[60vh]" : "max-h-48";

  const selectionCount = selections.length;

  const canSubmit = selectionCount > 0 && !loading;

  const formattedStake = useMemo(() => Number(stake) || 0, [stake]);
  const formattedOdds = useMemo(() => Number(odds) || 1, [odds]);

  const handleAddToBankroll = async () => {
    if (!selectionCount) return;
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      let startingCapital: number | null = null;
      try {
        startingCapital = await fetchBankrollSettings();
      } catch {
        startingCapital = null;
      }
      const existing = await fetchBankrollBets();
      const base =
        startingCapital ??
        (existing.length > 0
          ? existing[0].starting_capital ?? INITIAL_BANKROLL
          : INITIAL_BANKROLL);
      const now = new Date().toISOString();
      const defaultDate = now.slice(0, 10);
      const selectionDetails = selections.map((selection) => ({
        description: `${formatMatchLabel(selection)} - ${selection.marketLabel}`,
        odds: formattedOdds,
      }));
      const combinedDate = selections.reduce((acc, selection) => {
        if (!selection.fixtureDate) return acc;
        const candidate = new Date(selection.fixtureDate);
        if (!Number.isFinite(candidate.getTime())) return acc;
        const current = acc ? new Date(acc) : null;
        if (!current || candidate.getTime() < current.getTime()) {
          return selection.fixtureDate;
        }
        return acc;
      }, "" as string);
      const combinedDateLabel = combinedDate ? combinedDate.slice(0, 10) : defaultDate;

      const newBets: Bet[] =
        selectionCount > 1
          ? [
              {
                id: crypto.randomUUID(),
                user_id: undefined,
                bet_date: combinedDateLabel,
                description: `Combiné (${selectionCount} sélections)`,
                bet_type: "Combiné",
                bet_kind: "combined",
                selections: selectionDetails,
                odds: formattedOdds,
                stake: formattedStake,
                result: "pending",
                profit: 0,
                bankroll_after: 0,
                starting_capital: base,
                created_at: now,
                updated_at: now,
              },
            ]
          : selections.map((selection) => ({
              id: crypto.randomUUID(),
              user_id: undefined,
              bet_date: selection.fixtureDate
                ? selection.fixtureDate.slice(0, 10)
                : defaultDate,
              description: `${formatMatchLabel(selection)} - ${selection.marketLabel}`,
              bet_type: selection.marketLabel,
              bet_kind: "simple",
              selections: null,
              odds: formattedOdds,
              stake: formattedStake,
              result: "pending",
              profit: 0,
              bankroll_after: 0,
              starting_capital: base,
              created_at: now,
              updated_at: now,
            }));

      const recalculated = recomputeSequence([...existing, ...newBets], base);
      await upsertBankrollBets(recalculated);
      clearSelections();
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message ?? "Impossible d'ajouter au bankroll.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={panelClass}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">Cible</div>
        <div className="flex items-center gap-2">
          {selectionCount > 0 ? (
            <span className="text-xs text-white/60">{selectionCount} selection(s)</span>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-white/60 hover:text-white"
            >
              Fermer
            </button>
          ) : null}
        </div>
      </div>

      {selectionCount === 0 ? (
        <div className="text-xs text-white/60">Aucune selection.</div>
      ) : (
        <>
          <div className={`space-y-2 overflow-y-auto pr-1 ${listClass}`}>
            {selections.map((selection) => {
              const dateLabel = formatDate(selection.fixtureDate);
              return (
                <div
                  key={selection.key}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold truncate">
                      {formatMatchLabel(selection)}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSelection(selection.key)}
                      className="text-[10px] text-red-300 hover:text-red-200"
                    >
                      Suppr.
                    </button>
                  </div>
                  <div className="text-xs text-white/60 truncate">
                    {selection.marketCategory} · {selection.marketLabel}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-white/50">
                    <span>{dateLabel ?? ""}</span>
                    <span className="flex items-center gap-2 font-semibold tabular-nums">
                      <span className="text-emerald-300">
                        {selection.percentGreen != null ? `${selection.percentGreen}%` : "--"}
                      </span>
                      <span className="text-orange-300">
                        {selection.percentOrange != null ? `${selection.percentOrange}%` : "--"}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-white/60">Mise</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={stake}
                  onChange={(e) => setStake(parseFloat(e.target.value))}
                  className="bg-white/10 border border-white/20 rounded px-2 py-1 text-white"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-white/60">Cote</span>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={odds}
                  onChange={(e) => setOdds(parseFloat(e.target.value))}
                  className="bg-white/10 border border-white/20 rounded px-2 py-1 text-white"
                />
              </label>
            </div>

            {error ? <div className="text-xs text-red-300">{error}</div> : null}
            {success ? <div className="text-xs text-emerald-300">Ajoute au bankroll.</div> : null}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddToBankroll}
                disabled={!canSubmit}
                className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold hover:bg-blue-500 disabled:opacity-60"
              >
                {loading ? "Ajout..." : "Ajouter au bankroll"}
              </button>
              <button
                type="button"
                onClick={clearSelections}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 hover:text-white"
                disabled={!selectionCount}
              >
                Vider
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
