export type MarketType =
  | "OVER_0_5"
  | "OVER_1_5"
  | "OVER_2_5"
  | "OVER_3_5"
  | "OVER_4_5"
  | "UNDER_0_5"
  | "UNDER_1_5"
  | "UNDER_2_5"
  | "UNDER_3_5"
  | "UNDER_4_5"
  | "UNDER_5_5"
  | "DC_1X"
  | "DC_X2"
  | "DC_12"
  | "RESULT_1"
  | "RESULT_X"
  | "RESULT_2"
  | "CLEAN_SHEET";

export type FactType = "none" | "OVER_UNDER" | "RESULT" | "CLEAN_SHEET";
export type OverUnderDirection = "OVER" | "UNDER";
export type ResultType = "1" | "X" | "2" | "1X" | "X2" | "12";

export type TeamResult = {
  id: number;
  name: string;
  logo?: string | null;
  league: string;
  lastMatchDate: string; // ISO date
  opponent: string;
  market: MarketType;
  probGreen: number;
  probBlue: number;
  aboveAverage?: boolean;
  nextMatchBelow?: NextMatchBelowMeta;
  nextMatchDate?: string;
  nextOpponent?: string;
  badgeCount?: number;
};

export type SearchFilters = {
  leagueId?: number;
  factType?: FactType;
  overUnderDirection?: OverUnderDirection;
  overUnderLine?: number;
  resultType?: ResultType;
  streakMin?: number;
  nextMatchBelowEnabled?: boolean;
  nextMatchBelowLine?: number;
  nextMatchBelowMinPercent?: number;
  badgeTarget?: number;
};

export type NextMatchBelowMeta = {
  percent?: number;
  belowNext?: number;
  triggers?: number;
  line?: number;
};
