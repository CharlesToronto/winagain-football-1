"use client";

type Point = { x: number; y: number };

type Props = {
  points: Point[];
  label?: string;
  subLabel?: string;
  baseline?: number;
  tickStep?: number;
};

export default function PicksChart({
  points,
  label = "Historique des picks",
  subLabel,
  baseline = 1000,
  tickStep = 50,
}: Props) {
  if (!points.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white/70 text-sm">
        Pas encore de données pour la courbe.
      </div>
    );
  }

  const width = 960;
  const height = 320;
  const padding = 22;

  const minX = 0;
  const maxX = Math.max(points.length - 1, 1);
  const safeStep = Number.isFinite(tickStep) && tickStep > 0 ? tickStep : 50;
  const dataMinY = Math.min(...points.map((p) => p.y), baseline);
  const dataMaxY = Math.max(...points.map((p) => p.y), baseline);
  const minY = Math.floor(dataMinY / safeStep) * safeStep;
  const maxY = Math.ceil(dataMaxY / safeStep) * safeStep;
  const rangeY = maxY - minY || safeStep;

  const mapX = (x: number) =>
    padding + (points.length === 1 ? (width - 2 * padding) / 2 : (x / maxX) * (width - 2 * padding));
  const mapY = (y: number) =>
    height - padding - ((y - minY) / rangeY) * (height - padding * 2);

  const mapped = points.map((p) => ({ x: mapX(p.x), y: mapY(p.y) }));
  const buildSmoothPath = (pts: { x: number; y: number }[]) => {
    if (!pts.length) return "";
    if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const p0 = i > 0 ? pts[i - 1] : pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = i !== pts.length - 2 ? pts[i + 2] : p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
    }
    return d;
  };
  const linePath = buildSmoothPath(mapped);
  const areaPath = `${linePath} L ${width - padding},${height - padding} L ${padding},${height - padding} Z`;
  const ySteps: number[] = [];
  for (let value = minY; value <= maxY + 1e-9; value += safeStep) {
    ySteps.push(value);
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-lg flex flex-wrap items-baseline gap-2">
          <span>{label}</span>
          {subLabel ? <span className="text-xs text-white/60 font-normal">{subLabel}</span> : null}
        </h3>
        <span className="text-xs text-white/60">X: picks • Y: capital</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-80">
        <defs>
          <linearGradient id="picksGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.06" />
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
              ${Math.round(val)}
            </text>
          </g>
        ))}

        <path fill="url(#picksGradient)" stroke="none" d={areaPath} />

        <path
          fill="none"
          stroke="#38bdf8"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          d={linePath}
        />

        {mapped.map((p, idx) => (
          <circle key={idx} cx={p.x} cy={p.y} r={3} fill="#38bdf8" />
        ))}
      </svg>
    </div>
  );
}
