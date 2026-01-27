type Fixture = any;

type StreakValue = {
  active: boolean;
  streak: number;
  percent: number | null;
};

const GOAL_LINES = ["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"];

function buildStreak(sequence: boolean[]): StreakValue {
  if (!sequence.length || !sequence[sequence.length - 1]) {
    return { active: false, streak: 0, percent: null };
  }

  let streak = 0;
  for (let i = sequence.length - 1; i >= 0; i--) {
    if (!sequence[i]) break;
    streak++;
  }

  let occurrences = 0;
  let confirmed = 0;
  let cursor = 0;

  while (cursor < sequence.length) {
    if (!sequence[cursor]) {
      cursor++;
      continue;
    }

    const start = cursor;
    while (cursor < sequence.length && sequence[cursor]) cursor++;
    const runLength = cursor - start;

    if (runLength >= streak) {
      const nextIndex = start + streak;
      if (nextIndex < sequence.length) {
        occurrences++;
        if (sequence[nextIndex]) confirmed++;
      }
    }
  }

  const percent = occurrences > 0 ? Math.round((confirmed / occurrences) * 100) : null;

  return { active: true, streak, percent };
}

export default function computeStreaks(fixtures: Fixture[] = []) {
  const sorted = [...fixtures].sort(
    (a, b) => new Date(a?.date_utc ?? 0).getTime() - new Date(b?.date_utc ?? 0).getTime()
  );

  const history: Record<string, boolean[]> = {
    win: [],
    draw: [],
    lose: [],
    dc_1x: [],
    dc_x2: [],
    dc_12: [],
    dnb_home: [],
    dnb_away: [],
    btts: [],
    clean_home: [],
    clean_away: [],
  };

  for (const line of GOAL_LINES) {
    history[`over_${line}`] = [];
    history[`under_${line}`] = [];
  }

  for (const fixture of sorted) {
    const gfRaw = fixture.isHome ? fixture.goals_home : fixture.goals_away;
    const gaRaw = fixture.isHome ? fixture.goals_away : fixture.goals_home;
    const gf = Number(gfRaw ?? 0);
    const ga = Number(gaRaw ?? 0);
    const totalGoals = gf + ga;

    const win = gf > ga;
    const draw = gf === ga;
    const lose = gf < ga;

    history.win.push(win);
    history.draw.push(draw);
    history.lose.push(lose);

    history.dc_1x.push(win || draw);
    history.dc_x2.push(draw || lose);
    history.dc_12.push(win || lose);

    history.dnb_home.push(win);
    history.dnb_away.push(lose);

    history.btts.push(gf > 0 && ga > 0);
    history.clean_home.push(ga === 0);
    history.clean_away.push(gf === 0);

    for (const line of GOAL_LINES) {
      const over = totalGoals > Number(line);
      history[`over_${line}`].push(over);
      history[`under_${line}`].push(!over);
    }
  }

  const result: any = {
    win: buildStreak(history.win),
    draw: buildStreak(history.draw),
    lose: buildStreak(history.lose),
    dc_1x: buildStreak(history.dc_1x),
    dc_x2: buildStreak(history.dc_x2),
    dc_12: buildStreak(history.dc_12),
    dnb_home: buildStreak(history.dnb_home),
    dnb_away: buildStreak(history.dnb_away),
    btts: buildStreak(history.btts),
    clean_home: buildStreak(history.clean_home),
    clean_away: buildStreak(history.clean_away),
    over: {},
    under: {},
  };

  for (const line of GOAL_LINES) {
    result.over[line] = buildStreak(history[`over_${line}`]);
    result.under[line] = buildStreak(history[`under_${line}`]);
  }

  return result;
}
