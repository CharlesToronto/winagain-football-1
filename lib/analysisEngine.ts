import computeHTStreaks from "./analysisEngine/computeHTStreaks"

export type ProbabilitySet = {
  raw: number;     // total count
  percent: number; // percent
};

// utilitaire
function pct(count: number, total: number) {
  return total === 0 ? 0 : Math.round((count / total) * 100);
}

// ===== MOTEUR FULL-TIME =====
export function computeFT(fixtures: any[]): any {
  const total = fixtures.length;

  const win = fixtures.filter(f => f.isHome ? f.goals_home > f.goals_away : f.goals_away > f.goals_home).length;
  const draw = fixtures.filter(f => f.goals_home === f.goals_away).length;
  const lose = fixtures.filter(f => f.isHome ? f.goals_home < f.goals_away : f.goals_away < f.goals_home).length;

  const over15 = fixtures.filter(f => f.goals_home + f.goals_away > 1.5).length;
  const over25 = fixtures.filter(f => f.goals_home + f.goals_away > 2.5).length;

  return {
    win:    { raw: win,    percent: pct(win, total) },
    draw:   { raw: draw,   percent: pct(draw, total) },
    lose:   { raw: lose,   percent: pct(lose, total) },
    over15: { raw: over15, percent: pct(over15, total) },
    over25: { raw: over25, percent: pct(over25, total) },
    total
  };
}

// ===== MOTEUR HALF-TIME =====
export function computeHT(fixtures: any[]): any {
  const total = fixtures.length;

  const win = fixtures.filter(f => f.ht_home > f.ht_away).length;
  const draw = fixtures.filter(f => f.ht_home === f.ht_away).length;
  const lose = fixtures.filter(f => f.ht_home < f.ht_away).length;

  const over05 = fixtures.filter(f => f.ht_home + f.ht_away > 0.5).length;
  const over15 = fixtures.filter(f => f.ht_home + f.ht_away > 1.5).length;

  return {
    win:    { raw: win,    percent: pct(win, total) },
    draw:   { raw: draw,   percent: pct(draw, total) },
    lose:   { raw: lose,   percent: pct(lose, total) },
    over05: { raw: over05, percent: pct(over05, total) },
    over15: { raw: over15, percent: pct(over15, total) },
    total
  };
}

// ===== MOTEUR SECOND-HALF =====
export function compute2H(fixtures: any[]): any {
  const total = fixtures.length;

  // second-half = FT minus HT
  const sf_home = (f: any) => f.goals_home - f.ht_home;
  const sf_away = (f: any) => f.goals_away - f.ht_away;

  const win = fixtures.filter(f => sf_home(f) > sf_away(f)).length;
  const draw = fixtures.filter(f => sf_home(f) === sf_away(f)).length;
  const lose = fixtures.filter(f => sf_home(f) < sf_away(f)).length;

  const over05 = fixtures.filter(f => sf_home(f) + sf_away(f) > 0.5).length;
  const over15 = fixtures.filter(f => sf_home(f) + sf_away(f) > 1.5).length;

  return {
    win:    { raw: win,    percent: pct(win, total) },
    draw:   { raw: draw,   percent: pct(draw, total) },
    lose:   { raw: lose,   percent: pct(lose, total) },
    over05: { raw: over05, percent: pct(over05, total) },
    over15: { raw: over15, percent: pct(over15, total) },
    total
  };
}

export function analysisEngine(fixtures: any[] = []) {
  const fixturesForFT = fixtures;
  const fixturesForHT = fixtures;

  const ft = computeFT(fixturesForFT);
  const ht = computeHT(fixturesForHT);
  const htStreaks = computeHTStreaks(fixturesForHT);

  return {
    ft,
    ht,
    htStreaks,
  };
}
