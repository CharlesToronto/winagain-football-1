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
  const [mainTab, setMainTab] = useState<"search" | "deep" | "daily">("daily");

  return (
    <div className="min-h-screen w-full p-6 text-white space-y-6">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-3xl font-bold">Search</h1>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory">
          <button
            type="button"
            onClick={() => setMainTab("daily")}
            className={`px-3 py-1 rounded-lg text-sm transition snap-start whitespace-nowrap ${
              mainTab === "daily"
                ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            Search - Algo
          </button>
          <button
            type="button"
            onClick={() => setMainTab("search")}
            className={`px-3 py-1 rounded-lg text-sm transition snap-start whitespace-nowrap ${
              mainTab === "search"
                ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            Search - Per Stats
          </button>
          <button
            type="button"
            onClick={() => setMainTab("deep")}
            className={`px-3 py-1 rounded-lg text-sm transition snap-start whitespace-nowrap ${
              mainTab === "deep"
                ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            Search - Charly
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
