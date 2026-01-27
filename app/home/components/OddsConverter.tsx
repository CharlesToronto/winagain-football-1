"use client";

import { useMemo, useState } from "react";

type OddsState = {
  decimal: string;
  american: string;
};

function parseNumber(value: string) {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function americanToDecimal(american: number) {
  if (american === 0) return null;
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

function decimalToAmerican(decimal: number) {
  if (decimal <= 1) return null;
  if (decimal >= 2) return (decimal - 1) * 100;
  return -100 / (decimal - 1);
}

function formatAmerican(value: number) {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

export default function OddsConverter() {
  const [odds1, setOdds1] = useState<OddsState>({ decimal: "", american: "" });
  const [odds2, setOdds2] = useState<OddsState>({ decimal: "", american: "" });

  const updateFromDecimal = (value: string, setOdds: (next: OddsState) => void) => {
    const num = parseNumber(value);
    if (!num || num <= 1) {
      setOdds({ decimal: value, american: "" });
      return;
    }
    const american = decimalToAmerican(num);
    setOdds({
      decimal: value,
      american: american === null ? "" : formatAmerican(american),
    });
  };

  const updateFromAmerican = (value: string, setOdds: (next: OddsState) => void) => {
    const num = parseNumber(value);
    if (!num) {
      setOdds({ decimal: "", american: value });
      return;
    }
    const decimal = americanToDecimal(num);
    setOdds({
      decimal: decimal ? decimal.toFixed(2) : "",
      american: value,
    });
  };

  const combined = useMemo(() => {
    const dec1 = parseNumber(odds1.decimal);
    const dec2 = parseNumber(odds2.decimal);
    if (!dec1 || dec1 <= 1 || !dec2 || dec2 <= 1) return null;
    const decimal = dec1 * dec2;
    const american = decimalToAmerican(decimal);
    return {
      decimal,
      american: american === null ? null : american,
    };
  }, [odds1.decimal, odds2.decimal]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Convertisseur de cotes</h2>
        <p className="text-sm text-white/70">
          Conversion americain {"<->"} decimal, avec option de cote combinee.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-white">Cote 1</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-white/70">
              Decimal
              <input
                type="text"
                inputMode="decimal"
                placeholder="ex: 1.85"
                value={odds1.decimal}
                onChange={(e) => updateFromDecimal(e.target.value, setOdds1)}
                className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/50 focus:border-white/40 focus:outline-none"
              />
            </label>
            <label className="text-xs text-white/70">
              Americain
              <input
                type="text"
                inputMode="numeric"
                placeholder="ex: -120"
                value={odds1.american}
                onChange={(e) => updateFromAmerican(e.target.value, setOdds1)}
                className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/50 focus:border-white/40 focus:outline-none"
              />
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-white">Cote 2 (optionnelle)</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-white/70">
              Decimal
              <input
                type="text"
                inputMode="decimal"
                placeholder="ex: 2.10"
                value={odds2.decimal}
                onChange={(e) => updateFromDecimal(e.target.value, setOdds2)}
                className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/50 focus:border-white/40 focus:outline-none"
              />
            </label>
            <label className="text-xs text-white/70">
              Americain
              <input
                type="text"
                inputMode="numeric"
                placeholder="ex: +150"
                value={odds2.american}
                onChange={(e) => updateFromAmerican(e.target.value, setOdds2)}
                className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/50 focus:border-white/40 focus:outline-none"
              />
            </label>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">
        {combined ? (
          <div className="flex flex-col gap-1">
            <span className="font-semibold">Cote combinee</span>
            <span>Decimal : {combined.decimal.toFixed(2)}</span>
            <span>
              Americain : {combined.american !== null ? formatAmerican(combined.american) : "---"}
            </span>
          </div>
        ) : (
          <span>Ajoute une deuxieme cote pour obtenir la cote combinee.</span>
        )}
      </div>
    </div>
  );
}
