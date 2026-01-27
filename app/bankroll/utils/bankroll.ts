export type BetResult = "win" | "loss" | "pending" | "void";

export type BetSelection = { description: string; odds: number };

export type BetKind = "simple" | "combined";

export type Bet = {
  id: string;
  user_id?: string | null;
  bet_date: string; // ISO date
  description: string;
  bet_type: string;
  bet_kind: BetKind;
  selections?: BetSelection[] | null;
  odds: number; // total odds (for combined: produit des cotes)
  stake: number;
  result: BetResult;
  profit: number;
  bankroll_after: number;
  starting_capital?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export const INITIAL_BANKROLL = 0;

export function computeProfit(bet: Pick<Bet, "stake" | "odds" | "result">) {
  switch (bet.result) {
    case "win":
      return bet.stake * (bet.odds - 1);
    case "loss":
      return -bet.stake;
    case "void":
    case "pending":
    default:
      return 0;
  }
}

export function recomputeSequence(
  bets: Bet[],
  initial = INITIAL_BANKROLL,
  startingCapitalOverride?: number
): Bet[] {
  const sorted = [...bets].sort((a, b) => {
    const dateA = new Date(a.bet_date).getTime();
    const dateB = new Date(b.bet_date).getTime();
    if (dateA !== dateB) return dateA - dateB;
    const createdA = new Date(a.created_at || 0).getTime();
    const createdB = new Date(b.created_at || 0).getTime();
    if (createdA !== createdB) return createdA - createdB;
    return a.id.localeCompare(b.id);
  });

  let bankroll = startingCapitalOverride ?? initial;
  const result = sorted.map((bet) => {
    const profit = computeProfit(bet);
    bankroll += profit;
    return {
      ...bet,
      starting_capital: startingCapitalOverride ?? bet.starting_capital ?? initial,
      profit,
      bankroll_after: bankroll,
    };
  });

  return result;
}

export function computeStats(bets: Bet[], initial = INITIAL_BANKROLL) {
  const totalProfit = bets.reduce((sum, bet) => sum + (bet.profit ?? 0), 0);
  const totalStake = bets.reduce((sum, bet) => sum + (bet.stake ?? 0), 0);
  const wins = bets.filter((b) => b.result === "win").length;
  const losses = bets.filter((b) => b.result === "loss").length;
  const resolved = wins + losses;
  const roi = totalStake ? (totalProfit / totalStake) * 100 : 0;
  const winrate = resolved ? (wins / resolved) * 100 : 0;
  const bankrollCurrent = bets.length > 0 ? bets[bets.length - 1].bankroll_after : initial;

  return {
    totalProfit,
    totalStake,
    wins,
    losses,
    resolved,
    roi,
    winrate,
    bankrollCurrent,
    count: bets.length,
  };
}
