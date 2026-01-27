export interface CompetitionIdGroup {
  country: string;
  ids: number[];
}

export const COMPETITION_IDS_BY_COUNTRY: CompetitionIdGroup[] = [
  { country: "Albania", ids: [311] },
  { country: "Andorra", ids: [312, 655, 809] },
  { country: "Armenia", ids: [709, 343, 342] },
  { country: "Austria", ids: [219, 218, 220] },
  { country: "Azerbaijan", ids: [418] },
  { country: "Belarus", ids: [117] },
  { country: "Belgium", ids: [145, 147, 144] },
  { country: "Bosnia and Herzegovina", ids: [316, 317, 314, 315] },
  { country: "Bulgaria", ids: [174, 172, 173] },
  { country: "Croatia", ids: [212, 211, 210] },
  { country: "Cyprus", ids: [318, 319, 321] },
  { country: "Czech Republic", ids: [346, 345, 347] },
  { country: "Denmark", ids: [120, 121, 119] },
  { country: "Estonia", ids: [657, 328, 1126, 329] },
  { country: "Finland", ids: [1087, 901, 245, 244] },
  { country: "Georgia", ids: [530, 327, 326] },
  { country: "Greece", ids: [199, 197, 494] },
  { country: "Hungary", ids: [273, 271, 272] },
  { country: "Iceland", ids: [165, 166, 167] },
  { country: "Ireland", ids: [358, 1175, 359] },
  { country: "Israel", ids: [496, 382, 385] },
  { country: "Kazakhstan", ids: [388, 389, 818] },
  { country: "Kosovo", ids: [664] },
  { country: "Latvia", ids: [365, 364, 658] },
  { country: "Lithuania", ids: [361, 362, 661, 839] },
  { country: "Malta", ids: [392, 393] },
  { country: "Moldova", ids: [674, 395, 394] },
  { country: "Montenegro", ids: [723, 355, 356] },
  { country: "Netherlands", ids: [88, 89] },
  { country: "Norway", ids: [725, 103, 104] },
  { country: "Poland", ids: [727, 108, 106, 107] },
  { country: "Portugal", ids: [94, 95, 550, 97, 96] },
  { country: "Romania", ids: [285, 283, 284, 555] },
  { country: "Russia", ids: [237, 236, 235, 663] },
  { country: "Scotland", ids: [182, 179, 180, 181, 730, 183, 184] },
  { country: "Serbia", ids: [287, 286, 732] },
  { country: "Slovakia", ids: [506, 680, 332] },
  { country: "Slovenia", ids: [373, 374, 375] },
  { country: "Sweden", ids: [113, 736, 114, 115] },
  { country: "Switzerland", ids: [208, 209, 207] },
  { country: "Turkey", ids: [206, 203, 205] },
  { country: "Ukraine", ids: [333, 334, 335] },
  { country: "Wales", ids: [111, 738, 110] },
  { country: "England", ids: [39, 40, 45, 46] },
  { country: "France", ids: [61, 62, 66, 68] },
  { country: "Italy", ids: [135, 136, 137, 138] },
  { country: "Germany", ids: [78, 79, 80, 84] },
  { country: "Spain", ids: [140, 141, 143, 556] },
  { country: "Faroe Islands", ids: [239, 240, 241] },
  { country: "Liechtenstein", ids: [485] },
  { country: "North Macedonia", ids: [215, 216, 214] },
  { country: "Northern Ireland", ids: [162, 163, 161, 478] },

  // Extra-Europe
  { country: "Brazil", ids: [71, 72, 75, 632] },
  { country: "Japan", ids: [497, 98, 99, 548, 101] },
  { country: "USA", ids: [866, 253] },
  { country: "Mexico", ids: [722, 262, 662] },

  // International (FIFA + UEFA)
  { country: "World", ids: [1] },
  { country: "Europe-International", ids: [4, 5, 2, 3, 848, 5566] }
];

export const ALL_COMPETITION_IDS: number[] = Array.from(
  new Set(COMPETITION_IDS_BY_COUNTRY.flatMap((c) => c.ids))
);
