"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type StandingRow = {
  rank: number;
  team: { id: number; name: string; logo?: string };
  all?: { played?: number; win?: number; draw?: number; lose?: number };
  points?: number;
};

type Props = {
  table: StandingRow[];
  opponentByTeam: Record<number, number | undefined>;
  focusTeamId?: number | null;
  autoScroll?: boolean;
};

export default function StandingsList({
  table,
  opponentByTeam,
  focusTeamId,
  autoScroll = true,
}: Props) {
  const [hoveredTeam, setHoveredTeam] = useState<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLAnchorElement | null>());
  const lastFocusRef = useRef<number | null>(null);

  const hoveredOpponent = useMemo(() => {
    if (!hoveredTeam) return null;
    return opponentByTeam[hoveredTeam] ?? null;
  }, [hoveredTeam, opponentByTeam]);

  useEffect(() => {
    if (!autoScroll) return;
    if (!focusTeamId) return;
    if (lastFocusRef.current === focusTeamId) return;
    const target = rowRefs.current.get(focusTeamId);
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      lastFocusRef.current = focusTeamId;
    }
  }, [autoScroll, focusTeamId, table]);

  return (
    <div className="grid gap-2">
      {table.map((row) => {
        const teamId = row.team?.id;
        const isHovered = hoveredTeam === teamId;
        const isOpponent = hoveredOpponent === teamId;
        const isFocused = focusTeamId != null && focusTeamId === teamId;
        const highlight = isHovered || isOpponent || isFocused;

        return (
          <Link
            href={`/team/${teamId}`}
            key={teamId}
            onMouseEnter={() => setHoveredTeam(teamId ?? null)}
            onMouseLeave={() => setHoveredTeam(null)}
            ref={(node) => {
              if (!teamId) return;
              rowRefs.current.set(teamId, node);
            }}
            className={`flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between rounded-lg border px-2 py-1.5 transition-colors ${
              highlight
                ? "bg-white/10 border-white/30"
                : "border-white/10 hover:border-white/20 hover:bg-white/5"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold w-5 text-center">{row.rank}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {row.team?.logo && (
                <img
                  src={row.team.logo}
                  alt={row.team.name}
                  className="h-6 w-6 object-contain"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold leading-tight truncate">
                    {row.team?.name}
                  </span>
                  <span className="text-xs font-semibold text-white/80 tabular-nums whitespace-nowrap">
                    Pts: {row.points ?? "-"}
                  </span>
                </div>
                <div className="text-[10px] text-white/60 leading-tight">
                  Played: {row.all?.played ?? "-"}
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
