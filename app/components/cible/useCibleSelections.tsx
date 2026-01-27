"use client";

import { useCallback, useEffect, useState } from "react";
import { CIBLE_EVENT, CIBLE_STORAGE_KEY, CibleSelection } from "@/lib/cible";

function readSelections(): CibleSelection[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CIBLE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.key === "string");
  } catch {
    return [];
  }
}

function writeSelections(next: CibleSelection[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CIBLE_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CIBLE_EVENT));
  } catch {
    // Ignore storage failures
  }
}

export function useCibleSelections() {
  const [selections, setSelections] = useState<CibleSelection[]>([]);

  useEffect(() => {
    setSelections(readSelections());

    const handleStorage = (event: StorageEvent) => {
      if (event.key === CIBLE_STORAGE_KEY) {
        setSelections(readSelections());
      }
    };

    const handleUpdated = () => {
      setSelections(readSelections());
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(CIBLE_EVENT, handleUpdated as EventListener);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(CIBLE_EVENT, handleUpdated as EventListener);
    };
  }, []);

  const addSelection = useCallback((selection: CibleSelection) => {
    setSelections((prev) => {
      if (prev.some((item) => item.key === selection.key)) return prev;
      const next = [...prev, selection];
      writeSelections(next);
      return next;
    });
  }, []);

  const removeSelection = useCallback((key: string) => {
    setSelections((prev) => {
      const next = prev.filter((item) => item.key !== key);
      writeSelections(next);
      return next;
    });
  }, []);

  const clearSelections = useCallback(() => {
    setSelections([]);
    writeSelections([]);
  }, []);

  return {
    selections,
    addSelection,
    removeSelection,
    clearSelections,
  };
}
