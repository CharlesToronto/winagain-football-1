export default function computeHT(fixtures: any[] = []) {
  if (!fixtures || fixtures.length === 0) {
    return {
      total: 0,
      win: { raw: 0, percent: 0 },
      draw: { raw: 0, percent: 0 },
      lose: { raw: 0, percent: 0 },
      btts: { raw: 0, percent: 0 },
      clean_home: { raw: 0, percent: 0 },
      clean_away: { raw: 0, percent: 0 },
      dc_1x: { raw: 0, percent: 0 },
      dc_x2: { raw: 0, percent: 0 },
      dc_12: { raw: 0, percent: 0 },
      dnb_home: { raw: 0, percent: 0 },
      dnb_away: { raw: 0, percent: 0 },
      over: {},
      under: {},
    };
  }

  const total = fixtures.length;

  let win = 0;
  let draw = 0;
  let lose = 0;
  let btts = 0;
  let cleanHome = 0;
  let cleanAway = 0;

  const overs: Record<string, number> = {
    "0.5": 0,
    "1.5": 0,
    "2.5": 0,
    "3.5": 0,
    "4.5": 0,
    "5.5": 0,
  };

  const unders: Record<string, number> = {
    "0.5": 0,
    "1.5": 0,
    "2.5": 0,
    "3.5": 0,
    "4.5": 0,
    "5.5": 0,
  };

  for (const f of fixtures) {
    // Déterminer les buts HT selon si ton équipe est à domicile
    const gf = f.isHome ? (f.goals_home_ht ?? 0) : (f.goals_away_ht ?? 0);
    const ga = f.isHome ? (f.goals_away_ht ?? 0) : (f.goals_home_ht ?? 0);

    const totalGoals = gf + ga;

    // Résultat HT
    if (gf > ga) win++;
    else if (gf < ga) lose++;
    else draw++;

    // BTTS HT
    if (gf > 0 && ga > 0) btts++;

    // Clean sheet HT
    if (ga === 0) cleanHome++; // ton équipe ne concède pas
    if (gf === 0) cleanAway++; // ton équipe ne marque pas

    // Over / Under HT
    for (const key of Object.keys(overs)) {
      const k = Number(key);
      if (totalGoals > k) overs[key]++;
      else unders[key]++;
    }
  }

  // --- Double Chance HT ---
  const dc_1x = win + draw;
  const dc_x2 = draw + lose;
  const dc_12 = win + lose;

  // --- Draw No Bet HT ---
  const dnb_home = win;
  const dnb_away = lose;

  const pct = (n: number) => Math.round((n / total) * 100);

  return {
    total,
    win: { raw: win, percent: pct(win) },
    draw: { raw: draw, percent: pct(draw) },
    lose: { raw: lose, percent: pct(lose) },
    btts: { raw: btts, percent: pct(btts) },
    clean_home: { raw: cleanHome, percent: pct(cleanHome) },
    clean_away: { raw: cleanAway, percent: pct(cleanAway) },

    dc_1x: { raw: dc_1x, percent: pct(dc_1x) },
    dc_x2: { raw: dc_x2, percent: pct(dc_x2) },
    dc_12: { raw: dc_12, percent: pct(dc_12) },

    dnb_home: { raw: dnb_home, percent: pct(dnb_home) },
    dnb_away: { raw: dnb_away, percent: pct(dnb_away) },

    over: Object.fromEntries(
      Object.entries(overs).map(([k, v]) => [k, { raw: v, percent: pct(v) }])
    ),
    under: Object.fromEntries(
      Object.entries(unders).map(([k, v]) => [k, { raw: v, percent: pct(v) }])
    ),
  };
}
