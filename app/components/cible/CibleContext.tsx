"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { CibleSelection, CibleTeam } from "@/lib/cible";
import { useCibleSelections } from "./useCibleSelections";

type CibleMarketMeta = {
  marketLabel: string;
  marketCategory: string;
  percentGreen?: number | null;
  percentOrange?: number | null;
};

type CibleMatchContext = {
  fixtureId?: number | null;
  fixtureDate?: string | null;
  home?: CibleTeam | null;
  away?: CibleTeam | null;
};

type CibleContextValue = {
  active: boolean;
  match: CibleMatchContext | null;
  addSelection: (meta: CibleMarketMeta) => void;
};

const CibleContext = createContext<CibleContextValue | null>(null);

function buildMatchLabel(match: CibleMatchContext | null) {
  const homeName = match?.home?.name ?? null;
  const awayName = match?.away?.name ?? null;
  if (homeName && awayName) return `${homeName} vs ${awayName}`;
  return homeName || awayName || null;
}

export function CibleProvider({
  active,
  match,
  children,
}: {
  active: boolean;
  match: CibleMatchContext | null;
  children: React.ReactNode;
}) {
  const { addSelection } = useCibleSelections();
  const matchLabel = useMemo(() => buildMatchLabel(match), [match]);

  const handleAddSelection = useCallback(
    (meta: CibleMarketMeta) => {
      if (!active) return;
      const key = `${match?.fixtureId ?? "no-fixture"}:${meta.marketCategory}:${meta.marketLabel}`;
      const selection: CibleSelection = {
        id: crypto.randomUUID(),
        key,
        createdAt: Date.now(),
        marketLabel: meta.marketLabel,
        marketCategory: meta.marketCategory,
        percentGreen: meta.percentGreen ?? null,
        percentOrange: meta.percentOrange ?? null,
        fixtureId: match?.fixtureId ?? null,
        fixtureDate: match?.fixtureDate ?? null,
        home: match?.home ?? null,
        away: match?.away ?? null,
        matchLabel,
      };
      addSelection(selection);
    },
    [active, addSelection, match, matchLabel]
  );

  const value = useMemo(
    () => ({
      active,
      match,
      addSelection: handleAddSelection,
    }),
    [active, match, handleAddSelection]
  );

  return <CibleContext.Provider value={value}>{children}</CibleContext.Provider>;
}

export function useCible() {
  return useContext(CibleContext);
}

export type { CibleMarketMeta, CibleMatchContext };
