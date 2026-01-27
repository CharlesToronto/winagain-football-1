import React from "react";

interface LineChartMockProps {
  data?: number[];
  height?: number;
}

const THEME_GREEN = "#2dd4bf";

export default function LineChartMock({
  data = [2, 3, 1, 4, 2.5, 3.8],
  height = 120,
}: LineChartMockProps) {
  const maxValue = Math.max(...data) + 1;
  const points = data
    .map((value, idx) => {
      const x = (idx / (data.length - 1)) * 100;
      const y = 100 - (value / maxValue) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }} className="w-full">
      <defs>
        <linearGradient id="lineGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={THEME_GREEN} stopOpacity="0.6" />
          <stop offset="100%" stopColor={THEME_GREEN} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <polyline
        fill="none"
        stroke={THEME_GREEN}
        strokeWidth="0.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
      <polygon
        points={`${points} 100,100 0,100`}
        fill="url(#lineGradient)"
        opacity="0.6"
      />
    </svg>
  );
}
