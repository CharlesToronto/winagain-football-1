"use client";

import Link from "next/link";
import { TeamResult } from "../types";

export function TeamResultCard({ team }: { team: TeamResult }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-4 flex flex-col gap-3 text-white">
      <div className="flex items-center gap-3">
        {team.logo ? (
          <img src={team.logo} alt={team.name} className="w-10 h-10 object-contain" />
        ) : (
          <div className="w-10 h-10 rounded bg-white/10" />
        )}
        <div>
          <h3 className="font-semibold">{team.name}</h3>
          <p className="text-xs text-white/60">{team.league}</p>
        </div>
      </div>

      <div className="text-sm text-white/80">
        <div>
          Prochain match :{" "}
          {team.nextMatchDate
            ? new Date(team.nextMatchDate).toLocaleString("fr-FR")
            : "--"}
          {team.nextOpponent ? ` vs ${team.nextOpponent}` : ""}
        </div>
        {team.badgeCount != null ? (
          <div>Badges prochain match : {team.badgeCount}/7</div>
        ) : null}
        <div>Marchés : {formatMarket(team.market)}</div>
        {team.nextMatchBelow?.line != null && team.nextMatchBelow?.percent != null ? (
          <div>
            Match suivant sous +{formatNumber(team.nextMatchBelow.line)} :{" "}
            {team.nextMatchBelow.percent}% ({team.nextMatchBelow.belowNext ?? 0}/
            {team.nextMatchBelow.triggers ?? 0})
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-green-400 font-semibold">{team.probGreen}%</span>
        <span className="text-blue-400 font-semibold">{team.probBlue}%</span>
        <span
          className={`px-2 py-0.5 rounded text-xs ${
            team.aboveAverage ? "bg-green-600/30 text-green-200" : "bg-orange-600/30 text-orange-200"
          }`}
        >
          {team.aboveAverage ? "Au-dessus de la moyenne" : "Sous la moyenne"}
        </span>
      </div>

      <div className="flex justify-end">
        <Link
          href={`/team/${team.id}`}
          className="px-3 py-1 rounded-md bg-white/10 hover:bg-white/20 text-sm"
        >
          Voir l'équipe
        </Link>
      </div>
    </div>
  );
}

function formatMarket(m: string) {
  switch (m) {
    case "OVER_0_5":
      return "+0.5";
    case "OVER_1_5":
      return "+1.5";
    case "OVER_2_5":
      return "+2.5";
    case "OVER_3_5":
      return "+3.5";
    case "OVER_4_5":
      return "+4.5";
    case "UNDER_0_5":
      return "-0.5";
    case "UNDER_1_5":
      return "-1.5";
    case "UNDER_2_5":
      return "-2.5";
    case "UNDER_3_5":
      return "-3.5";
    case "UNDER_4_5":
      return "-4.5";
    case "UNDER_5_5":
      return "-5.5";
    case "DC_1X":
      return "Double chance 1X";
    case "DC_X2":
      return "Double chance X2";
    case "DC_12":
      return "Double chance 12";
    case "RESULT_1":
      return "1 (Victoire)";
    case "RESULT_X":
      return "X (Nul)";
    case "RESULT_2":
      return "2 (Défaite)";
    case "CLEAN_SHEET":
      return "Clean sheet";
    default:
      return m;
  }
}

function formatNumber(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(2);
}

