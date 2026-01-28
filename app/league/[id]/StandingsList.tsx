"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type StandingRow = {
  rank: number;
  team: { id: number; name: string; logo?: string };
  all?: { played?: number; win?: number; draw?: number; lose?: number };
  points?: number;
  form?: string;
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
      <div className="hidden md:grid grid-cols-[1fr_auto_auto] items-center px-2 text-[10px] text-white/60">
        <div />
        <div className="flex items-center gap-3">
          <div className="w-[96px]" />
          <div className="grid grid-cols-3 gap-2 min-w-[72px] text-right">
            <span>W</span>
            <span>D</span>
            <span>L</span>
          </div>
        </div>
        <div className="min-w-[56px]" />
      </div>
      {table.map((row) => {
        const teamId = row.team?.id;
        const isHovered = hoveredTeam === teamId;
        const isOpponent = hoveredOpponent === teamId;
        const isFocused = focusTeamId != null && focusTeamId === teamId;
        const highlight = isHovered || isOpponent || isFocused;
        const formRaw = typeof row.form === "string" ? row.form.toUpperCase() : "";
        const formClean = formRaw.replace(/[^WDL]/g, "");
        const lastFive = formClean.slice(-5);
        const formCounts = {
          W: lastFive.split("").filter((c) => c === "W").length,
          D: lastFive.split("").filter((c) => c === "D").length,
          L: lastFive.split("").filter((c) => c === "L").length,
        };

        const formIcons = lastFive
          ? lastFive.split("").map((result, idx) => (
              <span
                key={`${teamId}-${idx}-${result}`}
                className={`h-4 w-4 rounded-full text-[9px] font-semibold flex items-center justify-center ${
                  result === "W"
                    ? "bg-emerald-600/70 text-white/90"
                    : result === "D"
                      ? "bg-amber-500/70 text-white/90"
                      : "bg-rose-600/70 text-white/90"
                }`}
              >
                {result}
              </span>
            ))
          : null;

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
            className={`grid grid-cols-[1fr_auto] md:grid-cols-[1fr_auto_auto] items-center gap-2 md:gap-3 rounded-lg border px-1 md:px-2 py-1.5 transition-colors ${
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
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold leading-tight truncate">
                    {row.team?.name}
                  </span>
                </div>
                <div className="text-[10px] text-white/60 leading-tight">
                  Played: {row.all?.played ?? "-"}
                </div>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-3">
              <div className="flex items-center gap-3 text-sm font-semibold text-white/80">
                <div className="flex items-center gap-1 w-[96px] justify-end">
                  {formIcons ?? <span className="text-white/40">--</span>}
                </div>
                <div className="grid grid-cols-3 gap-2 min-w-[72px] text-right">
                  <span className={lastFive ? "" : "text-white/40"}>
                    {lastFive ? formCounts.W : "--"}
                  </span>
                  <span className={lastFive ? "" : "text-white/40"}>
                    {lastFive ? formCounts.D : "--"}
                  </span>
                  <span className={lastFive ? "" : "text-white/40"}>
                    {lastFive ? formCounts.L : "--"}
                  </span>
                </div>
              </div>
            </div>
            <div className="min-w-[48px] md:min-w-[56px] text-right whitespace-nowrap">
              <span className="text-lg md:text-xl font-bold text-white tabular-nums">
                {row.points ?? "-"}
              </span>
              <span className="ml-1 text-[10px] text-white/70">Pts</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
