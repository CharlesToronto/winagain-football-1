export type OverUnderOddsReference = {
  over: Record<string, number>;
  under: Record<string, number>;
};

export type DoubleChanceOddsReference = Record<"1X" | "X2" | "12", number>;

export type OddsReference = {
  overUnder?: OverUnderOddsReference;
  doubleChance?: DoubleChanceOddsReference;
  source?: string;
};

export const manualOddsByFixtureId: Record<number, OddsReference> = {
  1390991: {
    source: "manual",
    overUnder: {
      over: {
        "0.5": 1.05,
        "1.5": 1.25,
        "2.5": 1.8,
        "3.5": 2.95,
        "4.5": 5.5,
      },
      under: {
        "0.5": 9.5,
        "1.5": 3.8,
        "2.5": 1.95,
        "3.5": 1.38,
        "4.5": 1.14,
      },
    },
  },
  1387846: {
    source: "manual",
    overUnder: {
      over: {
        "2.5": 1.48,
        "3.5": 2.2,
        "4.5": 3.7,
      },
      under: {
        "2.5": 2.6,
        "3.5": 1.65,
        "4.5": 1.27,
      },
    },
    doubleChance: {
      "1X": 1.06,
      X2: 3.4,
      "12": 1.11,
    },
  },
};
