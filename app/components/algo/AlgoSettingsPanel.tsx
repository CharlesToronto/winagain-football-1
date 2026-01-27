"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "@/app/components/ui/Card";
import { useAlgoSettings } from "@/app/components/algo/useAlgoSettings";
import { parseLineList, parseNumberList } from "@/lib/analysisEngine/overUnderModel";

export default function AlgoSettingsPanel() {
  const { settings, updateSettings, resetSettings } = useAlgoSettings();
  const [windowSize, setWindowSize] = useState(settings.windowSize);
  const [bucketSize, setBucketSize] = useState(settings.bucketSize);
  const [minMatches, setMinMatches] = useState(settings.minMatches);
  const [minLeagueMatches, setMinLeagueMatches] = useState(settings.minLeagueMatches);
  const [threshold, setThreshold] = useState(settings.threshold);
  const [weightsInput, setWeightsInput] = useState(settings.weights.join(", "));
  const [linesInput, setLinesInput] = useState(settings.lines.join(", "));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setWindowSize(settings.windowSize);
    setBucketSize(settings.bucketSize);
    setMinMatches(settings.minMatches);
    setMinLeagueMatches(settings.minLeagueMatches);
    setThreshold(settings.threshold);
    setWeightsInput(settings.weights.join(", "));
    setLinesInput(settings.lines.join(", "));
  }, [settings]);

  const buckets = useMemo(() => {
    if (!bucketSize) return 0;
    return Math.max(1, Math.ceil(windowSize / bucketSize));
  }, [windowSize, bucketSize]);

  const handleSave = () => {
    const weights = parseNumberList(weightsInput);
    const lines = parseLineList(linesInput);
    updateSettings({
      windowSize,
      bucketSize,
      minMatches,
      minLeagueMatches,
      threshold,
      weights: weights.length ? weights : settings.weights,
      lines: lines.length ? lines : settings.lines,
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  return (
    <Card className="bg-white/10 border-white/10 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-sm text-white/60">Réglages algorithme</p>
          <h2 className="text-xl font-semibold">Pondération & seuils</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetSettings}
            className="px-3 py-1 rounded-lg text-sm bg-white/10 text-white/70 hover:bg-white/15"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-3 py-1 rounded-lg text-sm bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white transition hover:from-green-400 hover:via-emerald-400 hover:to-lime-400"
          >
            Enregistrer
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex flex-col gap-2">
          <label
            className="text-sm text-white/70"
            title="Window = nombre de matchs récents utilisés pour calculer la proba. Les picks, eux, sont comptés sur tous les matchs évalués de la période."
          >
            Window size (matches)
          </label>
          <input
            type="number"
            min={5}
            max={60}
            className="rounded bg-[#1f0f3a] border border-white/20 px-2 py-2 text-sm text-white"
            value={windowSize}
            title="Window = nombre de matchs récents utilisés pour calculer la proba. Les picks, eux, sont comptés sur tous les matchs évalués de la période."
            onChange={(e) => setWindowSize(Number(e.target.value))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-white/70">Bucket size (matches)</label>
          <input
            type="number"
            min={1}
            max={30}
            className="rounded bg-[#1f0f3a] border border-white/20 px-2 py-2 text-sm text-white"
            value={bucketSize}
            onChange={(e) => setBucketSize(Number(e.target.value))}
          />
          <p className="text-xs text-white/50">Buckets: {buckets}</p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-white/70">Seuil (probabilité)</label>
          <input
            type="number"
            step="0.01"
            min={0.5}
            max={0.95}
            className="rounded bg-[#1f0f3a] border border-white/20 px-2 py-2 text-sm text-white"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-white/70">Min matches (team)</label>
          <input
            type="number"
            min={1}
            max={60}
            className="rounded bg-[#1f0f3a] border border-white/20 px-2 py-2 text-sm text-white"
            value={minMatches}
            onChange={(e) => setMinMatches(Number(e.target.value))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-white/70">Min matches (league)</label>
          <input
            type="number"
            min={1}
            max={200}
            className="rounded bg-[#1f0f3a] border border-white/20 px-2 py-2 text-sm text-white"
            value={minLeagueMatches}
            onChange={(e) => setMinLeagueMatches(Number(e.target.value))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-white/70">Lines (CSV)</label>
          <input
            type="text"
            className="rounded bg-[#1f0f3a] border border-white/20 px-2 py-2 text-sm text-white"
            value={linesInput}
            placeholder="1.5, 2.5, 1X, X2, 12"
            onChange={(e) => setLinesInput(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <label className="text-sm text-white/70">Weights (recent → old)</label>
        <input
          type="text"
          className="rounded bg-[#1f0f3a] border border-white/20 px-2 py-2 text-sm text-white"
          value={weightsInput}
          onChange={(e) => setWeightsInput(e.target.value)}
        />
        <p className="text-xs text-white/50">
          Exemple (30 matchs / buckets de 5) : 1, 0.9, 0.8, 0.7, 0.6, 0.5
        </p>
      </div>

      {saved ? (
        <p className="mt-3 text-xs text-green-200">Paramètres enregistrés.</p>
      ) : null}
    </Card>
  );
}
