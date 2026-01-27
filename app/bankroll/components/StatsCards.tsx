"use client";

type Props = {
  bankroll: number;
  totalProfit: number;
  roi: number;
  count: number;
  winrate: number;
};

const cards = [
  { key: "bankroll", label: "Bankroll actuelle" },
  { key: "profit", label: "Profit total" },
  { key: "roi", label: "ROI" },
  { key: "bets", label: "Nombre de paris" },
  { key: "winrate", label: "Winrate" },
];

export default function StatsCards({ bankroll, totalProfit, roi, count, winrate }: Props) {
  const values: Record<string, string> = {
    bankroll: `${bankroll.toFixed(2)} €`,
    profit: `${totalProfit.toFixed(2)} €`,
    roi: `${roi.toFixed(2)} %`,
    bets: `${count}`,
    winrate: `${winrate.toFixed(1)} %`,
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {cards.map((card) => (
        <div
          key={card.key}
          className="p-4 rounded-xl bg-white/10 border border-white/10 text-white flex flex-col gap-1"
        >
          <span className="text-xs uppercase tracking-wide text-white/70">{card.label}</span>
          <span className="text-xl font-semibold">{values[card.key]}</span>
        </div>
      ))}
    </div>
  );
}
