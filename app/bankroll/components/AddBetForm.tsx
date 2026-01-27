"use client";

import { useMemo, useState } from "react";
import { BetResult } from "../utils/bankroll";

type Selection = { description: string; odds: number };

type Props = {
  onSubmit: (payload: {
    bet_date: string;
    description: string;
    bet_type: string;
    bet_kind: "simple" | "combined";
    odds: number;
    stake: number;
    result: BetResult;
    selections?: Selection[];
  }) => Promise<void>;
};

export default function AddBetForm({ onSubmit }: Props) {
  const [mode, setMode] = useState<"combined" | "simple">("combined");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [betType, setBetType] = useState("Victoire");
  const [odds, setOdds] = useState(1.9);
  const [stake, setStake] = useState(10);
  const [result, setResult] = useState<BetResult>("pending");
  const [selections, setSelections] = useState<Selection[]>([
    { description: "Sélection 1", odds: 1.9 },
    { description: "Sélection 2", odds: 1.6 },
  ]);
  const [loading, setLoading] = useState(false);

  const combinedOdds = useMemo(
    () => selections.reduce((acc, sel) => acc * (sel.odds || 1), 1),
    [selections]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await onSubmit({
      bet_date: date,
      description,
      bet_type: betType,
      bet_kind: mode,
      odds: mode === "combined" ? combinedOdds : Number(odds),
      stake: Number(stake),
      result,
      selections: mode === "combined" ? selections : undefined,
    });
    setLoading(false);
    setDescription("");
    setBetType("1X2");
    setOdds(1.9);
    setStake(10);
    setResult("pending");
    setSelections([
      { description: "Sélection 1", odds: 1.9 },
      { description: "Sélection 2", odds: 1.6 },
    ]);
    setMode("combined");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-4 rounded-xl bg-white/10 border border-white/10 text-white flex flex-col gap-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-semibold text-lg">Ajouter un pari</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm bg-white/10 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setMode("combined")}
            className={`px-3 py-1 rounded-md ${
              mode === "combined"
                ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                : "text-white/70"
            }`}
          >
            Paris combiné
          </button>
          <button
            type="button"
            onClick={() => setMode("simple")}
            className={`px-3 py-1 rounded-md ${
              mode === "simple"
                ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                : "text-white/70"
            }`}
          >
            Paris simple
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/70">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-white/10 border border-white/20 rounded px-3 py-2 text-white"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/70">Description</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="bg-white/10 border border-white/20 rounded px-3 py-2 text-white"
            placeholder="Ex: PSG vs OM - +2.5"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/70">Type de pari</span>
          <select
            value={betType}
            onChange={(e) => setBetType(e.target.value)}
            className="bg-[#1f0f3a] border border-white/20 rounded px-3 py-2 text-white"
          >
            <optgroup label="Résultat (1X2)">
              <option value="Victoire">Victoire</option>
              <option value="Nul">Nul</option>
              <option value="Défaite">Défaite</option>
              <option value="Double Chance 1X">Double Chance 1X</option>
              <option value="Double Chance X2">Double Chance X2</option>
              <option value="Double Chance 12">Double Chance 12</option>
              <option value="Draw No Bet Home">Draw No Bet Home</option>
              <option value="Draw No Bet Away">Draw No Bet Away</option>
            </optgroup>
            <optgroup label="+ / -">
              <option value="Over 0.5">+0.5</option>
              <option value="Under 0.5">-0.5</option>
              <option value="Over 1.5">+1.5</option>
              <option value="Under 1.5">-1.5</option>
              <option value="Over 2.5">+2.5</option>
              <option value="Under 2.5">-2.5</option>
              <option value="Over 3.5">+3.5</option>
              <option value="Under 3.5">-3.5</option>
              <option value="Over 4.5">+4.5</option>
              <option value="Under 4.5">-4.5</option>
              <option value="Over 5.5">+5.5</option>
              <option value="Under 5.5">-5.5</option>
            </optgroup>
          </select>
        </label>
        {mode === "simple" && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-white/70">Cote</span>
            <input
              type="number"
              step="0.01"
              min="1"
              value={odds}
              onChange={(e) => setOdds(parseFloat(e.target.value))}
              className="bg-white/10 border border-white/20 rounded px-3 py-2 text-white"
              required
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/70">Mise (€)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={stake}
            onChange={(e) => setStake(parseFloat(e.target.value))}
            className="bg-white/10 border border-white/20 rounded px-3 py-2 text-white"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/70">Résultat</span>
          <select
            value={result}
            onChange={(e) => setResult(e.target.value as BetResult)}
            className="bg-[#1f0f3a] border border-white/20 rounded px-3 py-2 text-white"
          >
            <option value="pending">En attente</option>
            <option value="win">Gagné</option>
            <option value="loss">Perdu</option>
            <option value="void">Void</option>
          </select>
        </label>
      </div>

      {mode === "combined" && (
        <div className="border border-white/10 rounded-lg p-3 bg-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-white/80">Sélections</div>
            <div className="text-xs text-white/60">Cote totale : {combinedOdds.toFixed(2)}</div>
          </div>
          <div className="flex flex-col gap-2">
            {selections.map((sel, idx) => (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                <input
                  value={sel.description}
                  onChange={(e) =>
                    setSelections((prev) =>
                      prev.map((s, i) => (i === idx ? { ...s, description: e.target.value } : s))
                    )
                  }
                  className="md:col-span-8 bg-white/10 border border-white/20 rounded px-3 py-2 text-white"
                  placeholder={`Sélection ${idx + 1}`}
                />
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={sel.odds}
                  onChange={(e) =>
                    setSelections((prev) =>
                      prev.map((s, i) =>
                        i === idx ? { ...s, odds: parseFloat(e.target.value) } : s
                      )
                    )
                  }
                  className="md:col-span-3 bg-white/10 border border-white/20 rounded px-3 py-2 text-white"
                  placeholder="Cote"
                />
                <button
                  type="button"
                  onClick={() => setSelections((prev) => prev.filter((_, i) => i !== idx))}
                  className="md:col-span-1 text-red-400 hover:underline text-sm"
                  disabled={selections.length <= 1}
                >
                  Suppr.
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setSelections((prev) => [
                ...prev,
                { description: `Sélection ${prev.length + 1}`, odds: 1.5 },
              ])
            }
            className="px-3 py-1 rounded-md bg-white/10 border border-white/20 text-sm hover:bg-white/20"
          >
            Ajouter une sélection
          </button>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="self-start px-4 py-2 rounded-lg bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white text-sm font-semibold transition hover:from-green-400 hover:via-emerald-400 hover:to-lime-400 disabled:opacity-70"
      >
        {loading ? "Ajout..." : "Ajouter"}
      </button>
    </form>
  );
}
