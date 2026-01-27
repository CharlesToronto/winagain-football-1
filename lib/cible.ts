export const CIBLE_STORAGE_KEY = "winagain:cible-selections";
export const CIBLE_EVENT = "cible-selections-updated";
export const CIBLE_ACTIVE_KEY = "winagain:cible-active";
export const CIBLE_ACTIVE_EVENT = "cible-active-updated";

export type CibleTeam = {
  id: number | null;
  name: string | null;
  logo?: string | null;
};

export type CibleSelection = {
  id: string;
  key: string;
  createdAt: number;
  marketLabel: string;
  marketCategory: string;
  percentGreen?: number | null;
  percentOrange?: number | null;
  fixtureId?: number | null;
  fixtureDate?: string | null;
  home?: CibleTeam | null;
  away?: CibleTeam | null;
  matchLabel?: string | null;
};
