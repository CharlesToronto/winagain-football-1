"use client";

type Point = { x: number; y: number };

type Props = {
  points: Point[];
  label?: string;
  subLabel?: string;
};

export default function PicksChart({ points, label = "Historique des picks", subLabel }: Props) {
  if (!points.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white/70 text-sm">
        Pas encore de données pour la courbe.
      </div>
    );
  }

  const width = 800;
  const height = 240;
  const padding = 28;

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
        <h3 className="font-semibold text-lg flex flex-wrap items-baseline gap-2">
          <span>{label}</span>
          {subLabel ? <span className="text-xs text-white/60 font-normal">{subLabel}</span> : null}
        </h3>
        <span className="text-xs text-white/60">X: picks • Y: capital</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-60">
        <defs>
          <linearGradient id="picksGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ec4899" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#ec4899" stopOpacity="0" />
          </linearGradient>
        </defs>

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
              {val.toFixed(2)}
            </text>
          </g>
        ))}

        <polyline
          fill="url(#picksGradient)"
          stroke="none"
          points={`${padding},${height - padding} ${path} ${width - padding},${height - padding}`}
        />

        <polyline
          fill="none"
          stroke="#ec4899"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={path}
        />

        {points.map((p, idx) => (
          <circle key={idx} cx={mapX(p.x)} cy={mapY(p.y)} r={3} fill="#ec4899" />
        ))}
      </svg>
    </div>
  );
}
