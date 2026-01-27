"use client";

import { useState } from "react";
import CiblePanel from "./CiblePanel";
import { useCibleSelections } from "./useCibleSelections";

export default function CibleFab() {
  const { selections } = useCibleSelections();
  const [open, setOpen] = useState(false);

  if (selections.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-50 md:hidden rounded-full border border-white/10 bg-blue-600/80 backdrop-blur-sm text-white shadow-lg w-12 h-12 flex items-center justify-center"
        aria-label="Cible selections"
        title="Cible selections"
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
        <span className="absolute -top-1 -right-1 rounded-full bg-white text-[10px] text-blue-900 px-1.5 py-0.5">
          {selections.length}
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            aria-label="Fermer"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full max-w-md">
            <CiblePanel variant="modal" onClose={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
