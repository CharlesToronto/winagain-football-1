"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bet, INITIAL_BANKROLL, computeStats, recomputeSequence } from "../utils/bankroll";
import {
  deleteBankrollBet,
  fetchBankrollBets,
  fetchBankrollSettings,
  upsertBankrollBets,
  upsertBankrollSettings,
} from "@/lib/adapters/bankroll";

type BetInput = Omit<
  Bet,
  | "id"
  | "profit"
  | "bankroll_after"
  | "created_at"
  | "updated_at"
  | "user_id"
  | "odds"
  | "starting_capital"
> & { odds?: number };

export function useBankroll() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingCapital, setStartingCapital] = useState<number>(1000);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let storedCapital: number | null = null;
      try {
        storedCapital = await fetchBankrollSettings();
      } catch (err: any) {
        setError(err?.message ?? "Failed to load bankroll settings");
      }
      const typed = await fetchBankrollBets();
      const base =
        storedCapital ??
        (typed.length > 0 ? typed[0].starting_capital ?? INITIAL_BANKROLL : INITIAL_BANKROLL);
      setStartingCapital(base);
      const recalculated = recomputeSequence(typed, base);
      setBets(recalculated);
    } catch (err: any) {
      setError(err.message ?? "Failed to load bets");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const persistSequence = useCallback(async (updated: Bet[]) => {
    if (updated.length === 0) return;
    await upsertBankrollBets(
      updated.map((bet) => ({
        ...bet,
        starting_capital: bet.starting_capital ?? startingCapital,
        updated_at: new Date().toISOString(),
      }))
    );
  }, [startingCapital]);

  const addBet = useCallback(
    async (input: BetInput) => {
      setError(null);
      const newBet: Bet = {
        id: crypto.randomUUID(),
        user_id: undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...input,
        odds: input.odds ?? 1,
        profit: 0,
        bankroll_after: 0,
        result: input.result ?? "pending",
        starting_capital: startingCapital,
      };

      const previous = bets;
      const recalculated = recomputeSequence([...bets, newBet], startingCapital);
      setBets(recalculated);
      try {
        await upsertBankrollBets(recalculated);
      } catch (err: any) {
        setError(err?.message ?? "Failed to save bet");
        setBets(previous);
      }
    },
    [bets, startingCapital]
  );

  const updateStartingCapital = useCallback(
    async (value: number) => {
      setError(null);
      setStartingCapital(value);
      try {
        await upsertBankrollSettings(value);
      } catch (err: any) {
        setError(err?.message ?? "Failed to save bankroll settings");
      }
      if (!bets.length) return;
      const recalculated = recomputeSequence(
        bets.map((b) => ({ ...b, starting_capital: value })),
        value
      );
      setBets(recalculated);
      try {
        await persistSequence(recalculated);
      } catch (err: any) {
        setError(err?.message ?? "Failed to save bets");
      }
    },
    [bets, persistSequence]
  );

  const updateBet = useCallback(
    async (id: string, patch: Partial<BetInput>) => {
      setError(null);
      const existing = bets.find((b) => b.id === id);
      if (!existing) return;
      const previous = bets;
      const updatedBet: Bet = {
        ...existing,
        ...patch,
        bet_date: patch.bet_date ?? existing.bet_date,
        updated_at: new Date().toISOString(),
      };
      const recalculated = recomputeSequence(
        bets.map((b) => (b.id === id ? updatedBet : b)),
        startingCapital
      );
      setBets(recalculated);
      try {
        await upsertBankrollBets(recalculated);
      } catch (err: any) {
        setError(err?.message ?? "Failed to update bet");
        setBets(previous);
      }
    },
    [bets, startingCapital]
  );

  const deleteBet = useCallback(
    async (id: string) => {
      setError(null);
      const previous = bets;
      try {
        await deleteBankrollBet(id);
        const recalculated = recomputeSequence(
          bets.filter((b) => b.id !== id),
          startingCapital
        );
        setBets(recalculated);
        await persistSequence(recalculated);
      } catch (err: any) {
        setError(err?.message ?? "Failed to delete bet");
        setBets(previous);
      }
    },
    [bets, persistSequence, startingCapital]
  );

  const stats = useMemo(() => computeStats(bets, startingCapital), [bets, startingCapital]);
  const orderedDesc = useMemo(
    () => [...bets].sort((a, b) => (a.bet_date < b.bet_date ? 1 : -1)),
    [bets]
  );

  return {
    betsAsc: bets,
    betsDesc: orderedDesc,
    stats,
    startingCapital,
    setStartingCapitalState: setStartingCapital,
    updateStartingCapital,
    persistSequence,
    loading,
    error,
    addBet,
    updateBet,
    deleteBet,
    reload: load,
  };
}
