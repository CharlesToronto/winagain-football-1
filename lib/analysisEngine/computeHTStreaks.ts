type Fixture = any;

/**
 * Determine HT condition result for a given fixture
 */
function evaluateCondition(f: Fixture, key: string): boolean {
  const gf = f.isHome ? (f.score?.halftime?.home ?? 0) : (f.score?.halftime?.away ?? 0);
  const ga = f.isHome ? (f.score?.halftime?.away ?? 0) : (f.score?.halftime?.home ?? 0);
  const total = gf + ga;

  switch (key) {
    case "win": return gf > ga;
    case "draw": return gf === ga;
    case "lose": return gf < ga;

    case "btts": return gf > 0 && ga > 0;
    case "clean_sheet": return ga === 0;

    case "over_0_5": return total > 0.5;
    case "over_1_5": return total > 1.5;
    case "over_2_5": return total > 2.5;

    case "under_0_5": return total <= 0.5;
    case "under_1_5": return total <= 1.5;
    case "under_2_5": return total <= 2.5;

    default: return false;
  }
}

/**
 * Return current HT streak for a specific condition
 */
function getActiveStreak(fixtures: Fixture[], key: string): number {
  let streak = 0;
  for (let i = fixtures.length - 1; i >= 0; i--) {
    if (evaluateCondition(fixtures[i], key)) streak++;
    else break;
  }
  return streak;
}

/**
 * Calculate how often streak n becomes streak n+1 historically
 */
function calculateContinuationProbability(
  fixtures: Fixture[],
  key: string,
  streak: number
) {
  if (streak === 0) return { samples: 0, success: 0, percent: 0 };

  let samples = 0;
  let success = 0;

  const events = fixtures.map(f => evaluateCondition(f, key));

  for (let i = streak; i < events.length; i++) {
    const window = events.slice(i - streak, i);
    if (window.every(v => v === true)) {
      samples++;
      if (events[i] === true) success++;
    }
  }

  const percent = samples > 0 ? Math.round((success / samples) * 100) : 0;

  return { samples, success, percent };
}

/**
 * MAIN ENGINE
 */
export default function computeHTStreaks(fixtures: Fixture[] = []) {
  const keys = [
    "win",
    "draw",
    "lose",
    "btts",
    "clean_sheet",
    "over_0_5",
    "over_1_5",
    "over_2_5",
    "under_0_5",
    "under_1_5",
    "under_2_5",
  ];

  const result: Record<string, any> = {};

  for (const key of keys) {
    const streak = getActiveStreak(fixtures, key);
    const cont = calculateContinuationProbability(fixtures, key, streak);

    result[key] = {
      streak,
      continuation: cont,
    };
  }

  return result;
}
