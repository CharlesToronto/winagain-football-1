import computeFT from "@/lib/analysisEngine/computeFT";
import computeHT from "@/lib/analysisEngine/computeHT";
import compute2H from "@/lib/analysisEngine/compute2H";
import computeStreaks from "@/lib/analysisEngine/computeStreaks";

type FixtureInput = Record<string, any>;
type ProbabilityEngine = (fixtures?: FixtureInput[]) => any;

export type ProbabilityEngines = Record<"FT" | "HT" | "2H", ProbabilityEngine>;

export function getProbabilityEngines(): {
  engines: ProbabilityEngines;
  computeStreaks: ProbabilityEngine;
} {
  return {
    engines: {
      FT: (fixtures: FixtureInput[] = []) => computeFT(fixtures),
      HT: (fixtures: FixtureInput[] = []) => computeHT(fixtures),
      "2H": (fixtures: FixtureInput[] = []) => compute2H(fixtures),
    },
    computeStreaks: (fixtures: FixtureInput[] = []) => computeStreaks(fixtures),
  };
}
