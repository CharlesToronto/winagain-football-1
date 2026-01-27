"use client";

import { useState } from "react";
import StatsCards from "./components/StatsCards";
import BankrollChart from "./components/BankrollChart";
import AddBetForm from "./components/AddBetForm";
import BetsTable from "./components/BetsTable";
import { useBankroll } from "./hooks/useBankroll";

export default function BankrollPage() {
  const [addOpen, setAddOpen] = useState(false);
  const {
    betsAsc,
    betsDesc,
    stats,
    startingCapital,
    setStartingCapitalState,
    updateStartingCapital,
    loading,
    error,
    addBet,
    updateBet,
    deleteBet,
  } = useBankroll();

  return (
    <div className="min-h-screen p-6 text-white">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h1 className="text-3xl font-bold">Bankroll</h1>
        <div className="flex items-center gap-3">
          {loading && <span className="text-sm text-white/70">Chargement...</span>}
          <button
            onClick={() => setAddOpen(true)}
            className="px-3 py-2 rounded-lg bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-sm font-semibold text-white transition hover:from-green-400 hover:via-emerald-400 hover:to-lime-400"
          >
            Ajouter un pari
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="p-4 rounded-xl bg-white/10 border border-white/10 text-white flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-sm text-white/70">Capital de base</p>
            <p className="text-2xl font-semibold">{startingCapital.toFixed(2)} CAD</p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
            <input
              type="number"
              step="0.01"
              value={startingCapital}
              onChange={(e) => setStartingCapitalState(parseFloat(e.target.value))}
              className="bg-white/10 border border-white/20 rounded px-3 py-2 text-white w-full sm:w-32"
            />
            <button
              onClick={async () => {
                await updateStartingCapital(startingCapital);
              }}
              className="px-3 py-2 rounded-lg bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-sm font-semibold text-white transition hover:from-green-400 hover:via-emerald-400 hover:to-lime-400 w-full sm:w-auto"
            >
              Mettre à jour
            </button>
          </div>
        </div>

        <StatsCards
          bankroll={stats.bankrollCurrent}
          totalProfit={stats.totalProfit}
          roi={stats.roi}
          count={stats.count}
          winrate={stats.winrate}
        />

        <BankrollChart bets={betsAsc} />

        {error ? (
          <div className="p-4 rounded-lg bg-red-500/20 border border-red-500/40 text-red-100">
            {error}
          </div>
        ) : null}

        <BetsTable bets={betsDesc} onUpdate={updateBet} onDelete={deleteBet} />
      </div>

      {addOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            aria-label="Fermer le menu"
            onClick={() => setAddOpen(false)}
          />
          <div className="relative h-full w-full max-w-xl bg-[#120a24] border-l border-white/10 shadow-2xl p-6 overflow-y-auto">
            <div className="flex items-center justify-end mb-4">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="text-white/70 hover:text-white"
              >
                Fermer
              </button>
            </div>
            <AddBetForm
              onSubmit={async (payload) => {
                await addBet(payload);
                setAddOpen(false);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
