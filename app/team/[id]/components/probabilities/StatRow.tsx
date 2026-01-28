"use client";

import React, { useEffect, useState } from "react";
import { useCible } from "@/app/components/cible/CibleContext";

function useMobileMode() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const coarse = window.matchMedia("(hover: none) and (pointer: coarse)");
    const narrow = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(coarse.matches || narrow.matches);
    update();

    if (coarse.addEventListener) {
      coarse.addEventListener("change", update);
      narrow.addEventListener("change", update);
      return () => {
        coarse.removeEventListener("change", update);
        narrow.removeEventListener("change", update);
      };
    }
    coarse.addListener(update);
    narrow.addListener(update);
    return () => {
      coarse.removeListener(update);
      narrow.removeListener(update);
    };
  }, []);

  return isMobile;
}

export default function StatRow({
  label,
  count,
  percentGreen,
  percentOrange,
  highlight,
  selectionCategory,
  selectionLabel,
  odd,
  showOdd,
}: any) {
  const isMobile = useMobileMode();
  const [showCount, setShowCount] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const cible = useCible();
  const cibleActive = Boolean(cible?.active);
  const resolvedSelectionLabel = selectionLabel ?? label;
  const rowSelectable = Boolean(cibleActive && selectionCategory && resolvedSelectionLabel);

  const resolvePercent = (value: unknown) => {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value !== "string") return null;
    const parsed = Number.parseFloat(value.replace("%", "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const handleSelect = () => {
    if (!rowSelectable || !cible) return;
    cible.addSelection({
      marketLabel: resolvedSelectionLabel,
      marketCategory: selectionCategory,
      percentGreen: resolvePercent(percentGreen),
      percentOrange: resolvePercent(percentOrange),
    });
  };

  const rowClass = `flex justify-between items-center text-sm py-1 px-2 -mx-2 rounded-md ${
    highlight ? "bg-yellow-400/10 ring-1 ring-yellow-300/40" : ""
  } ${rowSelectable ? "cursor-pointer hover:bg-blue-500/10" : ""}`;
  const labelClass = highlight ? "text-yellow-100" : "";
  const countClass = highlight ? "text-yellow-200" : "text-white/25";
  const greenClass = "text-green-400";
  const orangeClass = "text-blue-400";

  useEffect(() => {
    if (!isMobile && showCount) {
      setShowCount(false);
    }
  }, [isMobile, showCount]);

  const handleToggle = () => {
    if (!isMobile || rowSelectable) return;
    setShowCount((prev) => !prev);
  };

  const percentBaseClass = `${isMobile && !rowSelectable ? "cursor-pointer" : ""} font-semibold`;
  const showTooltip = rowSelectable ? false : isMobile ? showCount : isHovered;

  return (
    <div
      className={rowClass}
      role={rowSelectable ? "button" : undefined}
      tabIndex={rowSelectable ? 0 : undefined}
      onClick={rowSelectable ? handleSelect : undefined}
      onKeyDown={
        rowSelectable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleSelect();
              }
            }
          : undefined
      }
    >
      <div className="flex items-center gap-2">
        <span className={labelClass}>{label}</span>
        <span className={`${countClass} hidden`}>{count}</span>
      </div>
      <div
        className="flex gap-2 items-center relative"
        onMouseEnter={() => {
          if (!rowSelectable) setIsHovered(true);
        }}
        onMouseLeave={() => {
          if (!rowSelectable) setIsHovered(false);
        }}
      >
        <span className={`${greenClass} ${percentBaseClass}`} onClick={handleToggle}>
          {percentGreen}
        </span>
        {percentOrange != null ? (
          <span className={`${orangeClass} ${percentBaseClass}`} onClick={handleToggle}>
            {percentOrange}
          </span>
        ) : null}
        {showOdd ? (
          <span className="text-pink-300 font-semibold tabular-nums">
            {odd ?? "-"}
          </span>
        ) : null}
        {showTooltip ? (
          <span className="absolute -top-6 right-0 rounded-full border border-white/10 bg-black/70 px-2 py-0.5 text-[10px] text-white shadow">
            {count}
          </span>
        ) : null}
      </div>
    </div>
  );
}
