"use client";

import { Bet } from "../utils/bankroll";

type Props = {
  bets: Bet[];
};

export default function BankrollChart({ bets }: Props) {
  if (!bets.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white/70 text-sm">
        Pas encore de données pour la courbe.
      </div>
    );
  }

  const width = 800;
  const height = 240;
  const padding = 28;

  const points = bets.map((b, idx) => ({
    x: idx,
    y: b.bankroll_after,
  }));

  const minX = 0;
  const maxX = Math.max(points.length - 1, 1);
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const rangeY = maxY - minY || 1;

  const mapX = (x: number) =>
    padding + (points.length === 1 ? (width - 2 * padding) / 2 : (x / maxX) * (width - 2 * padding));
  const mapY = (y: number) =>
    height - padding - ((y - minY) / rangeY) * (height - padding * 2);

  const path = points.map((p) => `${mapX(p.x)},${mapY(p.y)}`).join(" ");

  const ticks = 6;
  const ySteps = Array.from({ length: ticks }, (_, i) => minY + (rangeY / (ticks - 1)) * i);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-lg">Progression de bankroll</h3>
        <span className="text-xs text-white/60">
          X: paris • Y: $
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-60">
        <defs>
          <linearGradient id="bankrollGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {ySteps.map((val, idx) => (
          <g key={idx}>
            <line
              x1={padding}
              x2={width - padding}
              y1={mapY(val)}
              y2={mapY(val)}
              stroke="white"
              strokeOpacity={0.08}
              strokeWidth={1}
            />
            <text
              x={padding - 6}
              y={mapY(val) + 4}
              fontSize="10"
              textAnchor="end"
              fill="rgba(255,255,255,0.6)"
            >
              {val.toFixed(0)} $
            </text>
          </g>
        ))}

        {/* Area fill */}
        <polyline
          fill="url(#bankrollGradient)"
          stroke="none"
          points={`${padding},${height - padding} ${path} ${width - padding},${height - padding}`}
        />

        {/* Line */}
        <polyline
          fill="none"
          stroke="#22c55e"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={path}
        />

        {points.map((p, idx) => (
          <circle key={idx} cx={mapX(p.x)} cy={mapY(p.y)} r={3} fill="#22c55e" />
        ))}

        {/* X labels: indices */}
        {points.map((p, idx) => (
          <text
            key={`label-${idx}`}
            x={mapX(p.x)}
            y={height - padding + 14}
            fontSize="10"
            textAnchor="middle"
            fill="rgba(255,255,255,0.6)"
          >
            {idx + 1}
          </text>
        ))}
      </svg>
    </div>
  );
}
