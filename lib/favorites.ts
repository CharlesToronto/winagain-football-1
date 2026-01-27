export type FavoriteTeam = {
  id: number;
  name?: string;
  logo?: string | null;
};

export const FAVORITES_STORAGE_KEY = "winagain:favorite-teams";
