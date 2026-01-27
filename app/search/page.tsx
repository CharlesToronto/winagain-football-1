"use client";

import { useState } from "react";
import { useSearchTeams } from "./hooks/useSearchTeams";
import { SearchFilters } from "./types";
import { SearchFilters as Filters } from "./components/SearchFilters";
import { SearchResults } from "./components/SearchResults";
import DeepSearchPanel from "./components/DeepSearchPanel";
import DailyScannerPanel from "./components/DailyScannerPanel";

export default function SearchPage() {
  const { filters, setFilters, runSearch, results, loading, error } = useSearchTeams();
  const [mainTab, setMainTab] = useState<"search" | "deep" | "daily">("search");

  return (
    <div className="min-h-screen w-full p-6 text-white space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-white/70">Recherche</p>
          <h1 className="text-3xl font-bold">Search</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMainTab("search")}
            className={`px-3 py-1 rounded-lg text-sm transition ${
              mainTab === "search"
                ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => setMainTab("deep")}
            className={`px-3 py-1 rounded-lg text-sm transition ${
              mainTab === "deep"
                ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            Deep Search
          </button>
          <button
            type="button"
            onClick={() => setMainTab("daily")}
            className={`px-3 py-1 rounded-lg text-sm transition ${
              mainTab === "daily"
                ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            Daily Scanner
          </button>
        </div>
      </div>

      {mainTab === "search" ? (
        <>
          <Filters
            filters={filters}
            onChange={(next: SearchFilters) => setFilters(next)}
            onSearch={runSearch}
            loading={loading}
          />

          <SearchResults results={results} loading={loading} error={error} />
        </>
      ) : mainTab === "deep" ? (
        <DeepSearchPanel />
      ) : (
        <DailyScannerPanel />
      )}
    </div>
  );
}
