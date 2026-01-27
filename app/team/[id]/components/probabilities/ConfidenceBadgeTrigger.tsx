"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  activeCount: number;
  totalCount: number;
  visible?: boolean;
  align?: "left" | "right";
};

export default function ConfidenceBadgeTrigger({
  activeCount,
  totalCount,
  visible = true,
  align = "right",
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  if (!visible) return null;

  const alignClass = align === "left" ? "left-0" : "right-0";

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-white/10 bg-white/5 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.6)] ring-1 ring-emerald-400/30"
      >
        <svg
          viewBox="0 0 24 24"
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 19V5m0 0l-6 6m6-6l6 6"
          />
        </svg>
      </button>
      {open ? (
        <div
          role="dialog"
          className={`absolute ${alignClass} top-full mt-2 z-20 min-w-[8.5rem] rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-white/90 backdrop-blur-md shadow-lg`}
        >
          <div className="font-semibold text-white">Confiance</div>
          <div className="text-white/80">
            Badges actifs: {activeCount}/{totalCount}
          </div>
        </div>
      ) : null}
    </div>
  );
}
