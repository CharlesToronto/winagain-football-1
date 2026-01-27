type Fixture = {
  goals_home?: number | null;
  goals_away?: number | null;
};

const GOAL_LINES = ["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"];

export default function computeLeagueFT(fixtures: Fixture[] = []) {
  if (!fixtures.length) {
    return {
      total: 0,
      over: Object.fromEntries(GOAL_LINES.map((line) => [line, { raw: 0, percent: 0 }])),
      under: Object.fromEntries(GOAL_LINES.map((line) => [line, { raw: 0, percent: 0 }])),
      dc_1x: { raw: 0, percent: 0 },
      dc_x2: { raw: 0, percent: 0 },
      dc_12: { raw: 0, percent: 0 },
    };
  }

  const total = fixtures.length;
  const overs: Record<string, number> = Object.fromEntries(
    GOAL_LINES.map((line) => [line, 0])
  );
  const unders: Record<string, number> = Object.fromEntries(
    GOAL_LINES.map((line) => [line, 0])
  );

  let homeWin = 0;
  let awayWin = 0;
  let draw = 0;

  for (const fixture of fixtures) {
    const home = Number(fixture.goals_home ?? 0);
    const away = Number(fixture.goals_away ?? 0);
    const totalGoals = home + away;

    if (home > away) homeWin++;
    else if (home < away) awayWin++;
    else draw++;

    for (const line of GOAL_LINES) {
      const limit = Number(line);
      if (totalGoals > limit) overs[line]++;
      else unders[line]++;
    }
  }

  const pct = (count: number) => Math.round((count / total) * 100);

  return {
    total,
    over: Object.fromEntries(
      GOAL_LINES.map((line) => [line, { raw: overs[line], percent: pct(overs[line]) }])
    ),
    under: Object.fromEntries(
      GOAL_LINES.map((line) => [line, { raw: unders[line], percent: pct(unders[line]) }])
    ),
    dc_1x: { raw: homeWin + draw, percent: pct(homeWin + draw) },
    dc_x2: { raw: draw + awayWin, percent: pct(draw + awayWin) },
    dc_12: { raw: homeWin + awayWin, percent: pct(homeWin + awayWin) },
  };
}
