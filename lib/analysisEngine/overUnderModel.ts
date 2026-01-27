export const DOUBLE_CHANCE_LINES = ["1X", "X2", "12"] as const;

export type DoubleChanceLine = (typeof DOUBLE_CHANCE_LINES)[number];

export type MarketLine = number | DoubleChanceLine;

export type AlgoSettings = {
  windowSize: number;
  bucketSize: number;
  weights: number[];
  minMatches: number;
  minLeagueMatches: number;
  threshold: number;
  lines: MarketLine[];
};

export type Rolling = {
  items: { gf: number; ga: number }[];
};

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeLineValue(value: unknown): MarketLine | null {
  if (typeof value === "number") {
    if (Number.isFinite(value) && value > 0) return value;
    return null;
  }
  if (typeof value === "string") {
    const cleaned = value.trim().toUpperCase().replace(/\s+/g, "");
    if (!cleaned) return null;
    if ((DOUBLE_CHANCE_LINES as readonly string[]).includes(cleaned)) {
      return cleaned as DoubleChanceLine;
    }
    const numeric = Number(cleaned);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
}

function normalizeLines(lines: Array<MarketLine | string | number>) {
  const cleaned = (lines || [])
    .map((line) => normalizeLineValue(line))
    .filter((line): line is MarketLine => Boolean(line));
  const numeric = cleaned.filter((line): line is number => typeof line === "number");
  const doubleChance = cleaned.filter(
    (line): line is DoubleChanceLine => typeof line === "string"
  );
  const numericUnique = Array.from(new Set(numeric)).sort((a, b) => a - b);
  const doubleChanceUnique = DOUBLE_CHANCE_LINES.filter((line) => doubleChance.includes(line));
  const merged = [...numericUnique, ...doubleChanceUnique];
  return merged.length ? merged : [1.5, 2.5, 3.5];
}

function generateDefaultWeights(buckets: number) {
  if (buckets <= 1) return [1];
  const minWeight = 0.5;
  const step = (1 - minWeight) / (buckets - 1);
  return Array.from({ length: buckets }, (_, idx) => {
    const value = 1 - idx * step;
    return Math.round(value * 100) / 100;
  });
}

function normalizeWeights(weights: number[], buckets: number) {
  let cleaned = (weights || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!cleaned.length) {
    cleaned = generateDefaultWeights(buckets);
  }

  if (cleaned.length < buckets) {
    const last = cleaned[cleaned.length - 1] ?? 1;
    cleaned = cleaned.concat(Array.from({ length: buckets - cleaned.length }, () => last));
  }

  if (cleaned.length > buckets) {
    cleaned = cleaned.slice(0, buckets);
  }

  return cleaned;
}

export const DEFAULT_ALGO_SETTINGS: AlgoSettings = {
  windowSize: 30,
  bucketSize: 5,
  weights: generateDefaultWeights(6),
  minMatches: 5,
  minLeagueMatches: 10,
  threshold: 0.65,
  lines: [1.5, 2.5, 3.5],
};

export function normalizeAlgoSettings(input: Partial<AlgoSettings> = {}): AlgoSettings {
  const windowSize = clampInt(
    Number.isFinite(input.windowSize) ? input.windowSize! : DEFAULT_ALGO_SETTINGS.windowSize,
    5,
    60
  );
  const bucketSize = clampInt(
    Number.isFinite(input.bucketSize) ? input.bucketSize! : DEFAULT_ALGO_SETTINGS.bucketSize,
    1,
    windowSize
  );
  const buckets = Math.max(1, Math.ceil(windowSize / bucketSize));
  const weights = normalizeWeights(input.weights ?? DEFAULT_ALGO_SETTINGS.weights, buckets);
  const minMatches = clampInt(
    Number.isFinite(input.minMatches) ? input.minMatches! : DEFAULT_ALGO_SETTINGS.minMatches,
    1,
    windowSize
  );
  const minLeagueMatches = clampInt(
    Number.isFinite(input.minLeagueMatches)
      ? input.minLeagueMatches!
      : DEFAULT_ALGO_SETTINGS.minLeagueMatches,
    1,
    200
  );
  const threshold = clampNumber(
    Number.isFinite(input.threshold) ? input.threshold! : DEFAULT_ALGO_SETTINGS.threshold,
    0.5,
    0.95
  );
  const lines = normalizeLines(input.lines ?? DEFAULT_ALGO_SETTINGS.lines);

  return {
    windowSize,
    bucketSize,
    weights,
    minMatches,
    minLeagueMatches,
    threshold,
    lines,
  };
}

export function createRolling(): Rolling {
  return { items: [] };
}

export function addRolling(rolling: Rolling, gf: number, ga: number, windowSize: number) {
  rolling.items.push({ gf, ga });
  if (rolling.items.length > windowSize) {
    rolling.items.shift();
  }
}

export function weightedRollingAvg(
  rolling: Rolling,
  bucketSize: number,
  weights: number[]
) {
  const n = rolling.items.length;
  if (!n) return { gf: 0, ga: 0, n: 0 };

  const buckets = Math.max(1, Math.ceil(n / bucketSize));
  let weightedGF = 0;
  let weightedGA = 0;
  let weightSum = 0;

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const end = n - bucket * bucketSize;
    const start = Math.max(0, end - bucketSize);
    const slice = rolling.items.slice(start, end);
    if (!slice.length) continue;
    const weight = weights[bucket] ?? weights[weights.length - 1] ?? 1;
    const sum = slice.reduce(
      (acc, match) => ({ gf: acc.gf + match.gf, ga: acc.ga + match.ga }),
      { gf: 0, ga: 0 }
    );
    const count = slice.length;
    weightedGF += sum.gf * weight;
    weightedGA += sum.ga * weight;
    weightSum += count * weight;
  }

  if (!weightSum) return { gf: 0, ga: 0, n };
  return { gf: weightedGF / weightSum, ga: weightedGA / weightSum, n };
}

export function parseNumberList(value: string | null) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((num) => Number.isFinite(num));
}

export function parseLineList(value: string | null) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => normalizeLineValue(item))
    .filter((line): line is MarketLine => Boolean(line));
}
