"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { enUS } from "date-fns/locale";
import ProbabilitiesView from "./components/probabilities/ProbabilitiesView";
import OddsView from "./components/odds/OddsView";
import ConfidenceView from "./components/confidence/ConfidenceView";
import TeamAiAnalysis from "./components/TeamAiAnalysis";
import LeagueStatsView from "./components/league/LeagueStatsView";
import BacktestView from "./components/backtest/BacktestView";
import OddsConverter from "@/app/home/components/OddsConverter";
import StandingsList from "@/app/league/[id]/StandingsList";
import { CibleProvider } from "@/app/components/cible/CibleContext";
import computeFT from "@/lib/analysisEngine/computeFT";
import { loadTeamData, TeamAdapterResult } from "@/lib/adapters/team";
import { FAVORITES_STORAGE_KEY, type FavoriteTeam } from "@/lib/favorites";
import { fetchApi } from "@/lib/football";
import { getTeamFixturesAllSeasons } from "@/lib/queries/fixtures";
import { CIBLE_ACTIVE_EVENT, CIBLE_ACTIVE_KEY } from "@/lib/cible";

type StatsState = Record<string, any> | null;
type TeamData = Record<string, any> | null;
type LeagueData = Record<string, any> | null;
type FixtureItem = Record<string, any>;
type NextMatch = Record<string, any> | null;
type RangeOption = number | "season";

const CURRENT_SEASON = 2025;
const OVER_UNDER_HIGH_MIN = 70;
const OVER_UNDER_HIGH_MAX = 99;
const LAST_MATCH_TOTAL_GOALS_THRESHOLD = 3.5;
const DRAW_PERCENT_MAX = 30;
const H2H_SEASONS = [2025, 2024];

export default function TeamPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const asOfParam = searchParams.get("asOf");
  const asOfDate = useMemo(() => {
    if (!asOfParam) return null;
    const parsed = new Date(asOfParam);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }, [asOfParam]);
  const cutoffDate = useMemo(() => {
    if (!asOfDate) return null;
    return new Date(asOfDate.getTime() - 24 * 60 * 60 * 1000);
  }, [asOfDate]);

  const [tab, setTab] = useState<
    "dashboard" | "stats" | "odds" | "confidence" | "converter" | "league" | "backtest"
  >("dashboard");
  const [probabilityFilter, setProbabilityFilter] = useState<"FT" | "HT" | "2H">("FT");
  const [team, setTeam] = useState<TeamData>(null);
  const [league, setLeague] = useState<LeagueData>(null);
  const [stats, setStats] = useState<StatsState>(null);
  const [standings, setStandings] = useState<any[]>([]);
  const [range, setRange] = useState<RangeOption>("season");
  const [fixtures, setFixtures] = useState<FixtureItem[]>([]);
  const [nextMatch, setNextMatch] = useState<NextMatch>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteTeam[]>([]);
  const [opponentFixtures, setOpponentFixtures] = useState<FixtureItem[]>([]);
  const [overUnderHighlight, setOverUnderHighlight] = useState(false);
  const [showOpponentComparison, setShowOpponentComparison] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [sidebarToolsTarget, setSidebarToolsTarget] = useState<HTMLElement | null>(null);
  const [mobileToolsTarget, setMobileToolsTarget] = useState<HTMLElement | null>(null);
  const [calendarFixtures, setCalendarFixtures] = useState<FixtureItem[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [cibleActive, setCibleActive] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const opponentToggleTimeoutRef = useRef<number | null>(null);
  const tabParam = searchParams.get("tab");
  const teamId = Number(team?.id);
  const effectiveRange = range;
  const rangeOptions: RangeOption[] = ["season", 50, 40, 30, 20, 10];
  const tabOptions = [
    { key: "dashboard", label: "Charly IA" },
    { key: "stats", label: "Team Stats" },
    { key: "league", label: "League Stats" },
    { key: "backtest", label: "Algorithme" },
    { key: "confidence", label: "Confiance" },
    { key: "odds", label: "Odds" },
  ] as const;
  const formatRangeLabel = (value: RangeOption) =>
    value === "season" ? "Saison 2025" : `${value} matchs`;
  const selectedMatch = useMemo(() => {
    if (!asOfParam) return null;
    return calendarFixtures.find((fixture) => fixture.date_utc === asOfParam) ?? null;
  }, [calendarFixtures, asOfParam]);
  const timeTravelNextMatch = useMemo(() => {
    if (!selectedMatch) return null;
    return {
      fixture: {
        date: selectedMatch.date_utc ?? null,
        status: {
          short:
            selectedMatch.goals_home != null && selectedMatch.goals_away != null
              ? "FT"
              : "NS",
        },
        id: selectedMatch.id ?? null,
        venue: { name: null },
      },
      goals: {
        home: selectedMatch.goals_home ?? null,
        away: selectedMatch.goals_away ?? null,
      },
      league: {
        name: league?.name ?? "Inconnu",
        round: null,
      },
      teams: {
        home: {
          id: selectedMatch.home_team_id ?? null,
          name: selectedMatch.teams?.name ?? selectedMatch.home_team_name ?? "Home",
          logo: selectedMatch.teams?.logo ?? selectedMatch.home_team_logo ?? null,
        },
        away: {
          id: selectedMatch.away_team_id ?? null,
          name: selectedMatch.opp?.name ?? selectedMatch.away_team_name ?? "Away",
          logo: selectedMatch.opp?.logo ?? selectedMatch.away_team_logo ?? null,
        },
      },
    };
  }, [selectedMatch, league?.name]);
  const effectiveNextMatch = timeTravelNextMatch ?? nextMatch;
  const nextOpponentId = getNextOpponentId(effectiveNextMatch, teamId);
  const nextOpponentName = getNextOpponentName(effectiveNextMatch, teamId);
  const calendarActive = Boolean(asOfDate);
  const isTeamHome =
    Number.isFinite(teamId) && effectiveNextMatch?.teams?.home?.id != null
      ? effectiveNextMatch.teams.home.id === teamId
      : null;
  const cibleMatch = useMemo(() => {
    if (!effectiveNextMatch) return null;
    const fixture = effectiveNextMatch.fixture ?? {};
    const home = effectiveNextMatch.teams?.home ?? null;
    const away = effectiveNextMatch.teams?.away ?? null;
    return {
      fixtureId: fixture.id ?? null,
      fixtureDate: fixture.date ?? null,
      home: home
        ? { id: home.id ?? null, name: home.name ?? null, logo: home.logo ?? null }
        : null,
      away: away
        ? { id: away.id ?? null, name: away.name ?? null, logo: away.logo ?? null }
        : null,
    };
  }, [effectiveNextMatch]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .filter((item) => item && typeof item.id === "number")
          .map((item) => ({
            id: item.id,
            name: item.name ?? "",
            logo: item.logo ?? null,
          }));
        setFavorites(cleaned);
      }
    } catch (error) {
      setFavorites([]);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
      window.dispatchEvent(new Event("favorites-updated"));
    } catch (error) {
      // Ignore storage failures (private mode, blocked storage, etc.)
    }
  }, [favorites]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setCibleActive(localStorage.getItem(CIBLE_ACTIVE_KEY) === "true");
    } catch {
      setCibleActive(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(CIBLE_ACTIVE_KEY, String(cibleActive));
      window.dispatchEvent(new Event(CIBLE_ACTIVE_EVENT));
    } catch {
      // Ignore storage failures (private mode, blocked storage, etc.)
    }
  }, [cibleActive]);

  useEffect(() => {
    if (tabParam === "stats") {
      setTab("stats");
    } else if (tabParam === "dashboard") {
      setTab("dashboard");
    } else if (tabParam === "odds") {
      setTab("odds");
    } else if (tabParam === "confidence") {
      setTab("confidence");
    } else if (tabParam === "converter") {
      setTab("converter");
    } else if (tabParam === "league") {
      setTab("league");
    } else if (tabParam === "backtest") {
      setTab("backtest");
    } else if (tabParam === "ai") {
      setTab("dashboard");
    }
  }, [tabParam]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    if (!isMobile) {
      setActionsOpen(true);
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setSidebarToolsTarget(document.getElementById("sidebar-tools"));
    setMobileToolsTarget(document.getElementById("mobile-tools-anchor"));
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const result: TeamAdapterResult = await loadTeamData(id, effectiveRange, cutoffDate);
        setTeam(result.team);
        setLeague(result.league);
        setFixtures(result.fixtures);
        setStats(result.stats);
        setNextMatch(result.nextMatch);
        setStandings(result.standings ?? []);
      } catch (e) {
        setStats(null);
        setFixtures([]);
        setStandings([]);
      }
      setLoading(false);
    }

    load();
  }, [id, effectiveRange, cutoffDate]);

  useEffect(() => {
    if (!Number.isFinite(teamId)) return;
    let active = true;
    setCalendarLoading(true);
    setCalendarError(null);
    getTeamFixturesAllSeasons(teamId)
      .then((data) => {
        if (!active) return;
        setCalendarFixtures(Array.isArray(data) ? data : []);
      })
      .catch((error: any) => {
        if (!active) return;
        setCalendarFixtures([]);
        setCalendarError(error?.message ?? "Erreur chargement matchs.");
      })
      .finally(() => {
        if (!active) return;
        setCalendarLoading(false);
      });
    return () => {
      active = false;
    };
  }, [teamId]);

  useEffect(() => {
    async function loadOpponentFixtures() {
      if (!nextOpponentId) {
        setOpponentFixtures([]);
        return;
      }
      try {
        const raw = await getTeamFixturesAllSeasons(Number(nextOpponentId));
        if (!raw || raw.length === 0) {
          setOpponentFixtures([]);
          return;
        }
        const filtered = selectFixturesForRange(raw, effectiveRange, cutoffDate);
        const mapped = filtered.map((fixture: any) => ({
          ...fixture,
          isHome: fixture.home_team_id === Number(nextOpponentId),
        }));
        setOpponentFixtures(mapped);
      } catch (error) {
        setOpponentFixtures([]);
      }
    }

    loadOpponentFixtures();
  }, [nextOpponentId, effectiveRange, cutoffDate]);

  const teamStats = useMemo(
    () => (fixtures?.length ? computeFT(fixtures) : null),
    [fixtures]
  );
  const leagueIdForStats = useMemo(() => {
    if (league?.id != null) return Number(league.id);
    const fromCalendar = resolveLeagueIdFromFixtures(
      calendarFixtures,
      CURRENT_SEASON
    );
    if (fromCalendar != null) return fromCalendar;
    const fallback = fixtures?.[0]?.competition_id ?? null;
    return fallback != null ? Number(fallback) : null;
  }, [league?.id, calendarFixtures, fixtures]);
  const opponentStats = useMemo(
    () => (opponentFixtures?.length ? computeFT(opponentFixtures) : null),
    [opponentFixtures]
  );
  const overUnderMatchKeys = useMemo(() => {
    if (!teamStats || !opponentStats) return new Set<string>();
    return getHighlightMatchKeys(teamStats, opponentStats);
  }, [teamStats, opponentStats]);
  const overUnderMatchActive = overUnderMatchKeys.size > 0;
  const trendSignalDetails = useMemo(() => {
    const teamLast = getLatestPlayedFixture(fixtures);
    const opponentLast = getLatestPlayedFixture(opponentFixtures);
    const teamLabel = team?.name ?? "Équipe";
    const opponentLabel = nextOpponentName ?? "Adversaire";
    const teamDetail = describeTrendSignal(teamLast, teamStats, teamLabel);
    const opponentDetail = describeTrendSignal(opponentLast, opponentStats, opponentLabel);
    const reasons = [teamDetail.reason, opponentDetail.reason].filter(Boolean) as string[];
    return {
      active: reasons.length > 0,
      title: reasons.length > 0
        ? `Dernier match: ${reasons.join(" | ")}`
        : "Aucun signal sur le dernier match",
    };
  }, [fixtures, opponentFixtures, teamStats, opponentStats, team?.name, nextOpponentName]);
  const trendSignalActive = trendSignalDetails.active;

  useEffect(() => {
    if (!overUnderMatchActive) {
      setOverUnderHighlight(false);
    }
  }, [overUnderMatchActive]);

  useEffect(() => {
    setShowOpponentComparison(false);
  }, [nextOpponentId]);


  const isFavorite = favorites.some((fav) => fav.id === teamId);
  const toggleFavorite = () => {
    if (!Number.isFinite(teamId)) return;
    setFavorites((prev) => {
      if (prev.some((fav) => fav.id === teamId)) {
        return prev.filter((fav) => fav.id !== teamId);
      }
      return [
        ...prev,
        {
          id: teamId,
          name: team?.name ?? "",
          logo: team?.logo ?? null,
        },
      ];
    });
  };

  const analysis = fixtures;
  const opponentToggleActive = Boolean(nextOpponentId);
  const opponentToggleTitle = opponentToggleActive
    ? showOpponentComparison
      ? "Stats adversaire actives (clic pour masquer)"
      : "Afficher stats adversaire (double clic pour ouvrir)"
    : "Aucun adversaire disponible";
  const overUnderTitle = overUnderMatchActive
    ? overUnderHighlight
      ? "Surlignage over/under actif"
      : "Surligner les stats 70-99%"
    : "Aucun match de stats 70-99%";
  const trendSignalTitle = trendSignalDetails.title;
  const copyTitle = "Copier le nom (clic) - Copier le match (double clic)";
  const cibleTitle = cibleActive
    ? "Cible active (clic pour desactiver)"
    : "Activer l'outil Cible";

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const clearCopyTimeout = () => {
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
  };

  const clearOpponentToggleTimeout = () => {
    if (opponentToggleTimeoutRef.current !== null) {
      window.clearTimeout(opponentToggleTimeoutRef.current);
      opponentToggleTimeoutRef.current = null;
    }
  };

  const handleCopyClick = () => {
    clearCopyTimeout();
    copyTimeoutRef.current = window.setTimeout(() => {
      copyToClipboard(team?.name ?? "");
      copyTimeoutRef.current = null;
    }, 250);
  };

  const handleCopyDoubleClick = () => {
    clearCopyTimeout();
    const matchLabel = getNextMatchLabel(effectiveNextMatch, team?.name ?? "");
    copyToClipboard(matchLabel);
  };

  const handleOpponentToggleClick = () => {
    if (!nextOpponentId) return;
    clearOpponentToggleTimeout();
    opponentToggleTimeoutRef.current = window.setTimeout(() => {
      setShowOpponentComparison((prev) => !prev);
      opponentToggleTimeoutRef.current = null;
    }, 250);
  };

  const handleOpponentToggleDoubleClick = () => {
    if (!nextOpponentId) return;
    clearOpponentToggleTimeout();
    router.push(`/team/${nextOpponentId}?tab=stats`);
  };

  const updateQueryParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value == null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const handleResetDate = () => {
    updateQueryParams({ asOf: null });
  };

  const handleSelectMatch = (fixture: FixtureItem) => {
    if (!fixture?.date_utc) return;
    updateQueryParams({ asOf: fixture.date_utc });
    setCalendarOpen(false);
  };

  const calendarList = useMemo(() => {
    const items = [...calendarFixtures];
    items.sort((a, b) => getFixtureTimestamp(b) - getFixtureTimestamp(a));
    return items;
  }, [calendarFixtures]);

  const bannerLabel = asOfDate
    ? format(asOfDate, "dd MMM yyyy", { locale: enUS })
    : null;

  const toolsButtons = (
    <>
      <div
        className={`w-9 h-9 md:w-full md:h-8 rounded-full bg-white/10 border border-white/10 backdrop-blur-sm flex items-center justify-center md:justify-start md:gap-2 md:px-2 transition ${
          trendSignalActive
            ? "text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.7)]"
            : "text-white/90"
        }`}
        role="img"
        aria-label={trendSignalTitle}
        title={trendSignalTitle}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 md:w-4 md:h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 19V5m0 0l-6 6m6-6l6 6"
          />
        </svg>
        <span className="hidden md:inline-flex text-xs text-white/70 whitespace-nowrap">
          Signal
        </span>
      </div>
      <button
        type="button"
        onClick={() => {
          if (!overUnderMatchActive) return;
          setOverUnderHighlight((prev) => !prev);
        }}
        aria-disabled={!overUnderMatchActive}
        aria-pressed={overUnderHighlight}
        aria-label={overUnderTitle}
        title={overUnderTitle}
        className={`w-9 h-9 md:w-full md:h-8 rounded-full bg-white/10 border border-white/10 backdrop-blur-sm flex items-center justify-center md:justify-start md:gap-2 md:px-2 transition ${
          overUnderHighlight
            ? "text-yellow-300 shadow-[0_0_12px_rgba(250,204,21,0.7)]"
            : "text-white/90"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 md:w-4 md:h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden
        >
          <circle cx="11" cy="11" r="6" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 16.5L21 21"
          />
        </svg>
        <span className="hidden md:inline-flex text-xs whitespace-nowrap">Over / Under</span>
      </button>
      <button
        type="button"
        onClick={() => setCibleActive((prev) => !prev)}
        aria-pressed={cibleActive}
        aria-label={cibleTitle}
        title={cibleTitle}
        className={`w-9 h-9 md:w-full md:h-8 rounded-full bg-white/10 border border-white/10 backdrop-blur-sm flex items-center justify-center md:justify-start md:gap-2 md:px-2 transition ${
          cibleActive
            ? "text-blue-200 shadow-[0_0_12px_rgba(59,130,246,0.7)]"
            : "text-white/80 hover:bg-white/20"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 md:w-4 md:h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
        <span className="hidden md:inline-flex text-xs whitespace-nowrap">Cible</span>
      </button>
      <button
        type="button"
        onClick={handleOpponentToggleClick}
        onDoubleClick={handleOpponentToggleDoubleClick}
        disabled={!opponentToggleActive}
        aria-disabled={!opponentToggleActive}
        aria-pressed={showOpponentComparison}
        aria-label={opponentToggleTitle}
        title={opponentToggleTitle}
        className={`w-9 h-9 md:w-full md:h-8 rounded-full bg-white/10 border border-white/10 backdrop-blur-sm flex items-center justify-center md:justify-start md:gap-2 md:px-2 transition disabled:cursor-not-allowed ${
          showOpponentComparison
            ? "text-blue-300 shadow-[0_0_12px_rgba(96,165,250,0.7)]"
            : opponentToggleActive
            ? "text-blue-200 hover:bg-white/20"
            : "text-white/50"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 md:w-4 md:h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 20l6-2 8-8-4-4-8 8-2 6z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 6l4 4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 21l3-3" />
        </svg>
        <span className="hidden md:inline-flex text-xs whitespace-nowrap">
          Adversaire
        </span>
      </button>
      <button
        type="button"
        onClick={() => setCalendarOpen(true)}
        aria-label="Calendrier des matchs"
        title="Calendrier des matchs"
        className={`w-9 h-9 md:w-full md:h-8 rounded-full bg-white/10 border border-white/10 backdrop-blur-sm flex items-center justify-center md:justify-start md:gap-2 md:px-2 transition ${
          asOfDate
            ? "text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.7)]"
            : "text-white/90 hover:bg-white/20"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 md:w-4 md:h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden
        >
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 9h18" />
        </svg>
        <span className="hidden md:inline-flex text-xs whitespace-nowrap">
          Calendrier
        </span>
      </button>
      <button
        type="button"
        onClick={toggleFavorite}
        aria-pressed={isFavorite}
        aria-label={isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
        title={isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
        className="w-9 h-9 md:w-full md:h-8 rounded-full bg-white/10 border border-white/10 backdrop-blur-sm text-white hover:bg-white/20 transition flex items-center justify-center md:justify-start md:gap-2 md:px-2"
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 md:w-4 md:h-4"
          fill={isFavorite ? "#facc15" : "none"}
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.48 3.5a.7.7 0 0 1 1.04 0l2.36 2.4c.2.2.46.32.74.35l3.33.5a.7.7 0 0 1 .39 1.2l-2.4 2.35a.7.7 0 0 0-.2.62l.58 3.3a.7.7 0 0 1-1.01.74l-2.98-1.56a.7.7 0 0 0-.65 0l-2.98 1.56a.7.7 0 0 1-1.01-.74l.58-3.3a.7.7 0 0 0-.2-.62L4.8 7.95a.7.7 0 0 1 .39-1.2l3.33-.5a.7.7 0 0 0 .74-.35l2.36-2.4Z"
          />
        </svg>
        <span className="hidden md:inline-flex text-xs whitespace-nowrap">
          Favoris
        </span>
      </button>
      <button
        type="button"
        onClick={handleCopyClick}
        onDoubleClick={handleCopyDoubleClick}
        className={`w-9 h-9 md:w-full md:h-8 rounded-full bg-white/15 border border-white/20 hover:bg-white/25 flex items-center justify-center md:justify-start md:gap-2 md:px-2 backdrop-blur-sm transition ${
          copied
            ? "text-white shadow-[0_0_12px_rgba(255,255,255,0.6)]"
            : "text-white/80 hover:text-white"
        }`}
        title={copyTitle}
        aria-label={copyTitle}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 md:w-4 md:h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 3h7l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 3v4h4" />
        </svg>
        <span className="hidden md:inline-flex text-xs whitespace-nowrap">
          Copier
        </span>
      </button>
    </>
  );

  const toolsToggleButton = (
    <button
      type="button"
      onClick={() => setActionsOpen((prev) => !prev)}
      aria-expanded={actionsOpen}
      aria-label="Outils"
      title="Outils"
      className={`w-9 h-9 md:w-full md:h-8 rounded-full border border-white/10 backdrop-blur-sm flex items-center justify-center md:justify-start md:gap-2 md:px-2 transition ${
        actionsOpen
          ? "bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.4)]"
          : "bg-white/10 text-white/90 hover:bg-white/20"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="w-5 h-5 md:w-4 md:h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.7 19.3l-5.6-5.6a5 5 0 0 0-6.4-6.4l3.2 3.2-2.8 2.8-3.2-3.2a5 5 0 0 0 6.4 6.4l5.6 5.6a1 1 0 0 0 1.4-1.4z"
        />
      </svg>
      <span className="hidden md:inline-flex text-xs whitespace-nowrap">Outils</span>
    </button>
  );

  const mobileTools = mobileToolsTarget
    ? createPortal(
        <div className="flex flex-col items-end">
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl border border-white/10 bg-black/30 px-2 py-2 backdrop-blur-md shadow-lg">
            {toolsButtons}
          </div>
        </div>,
        mobileToolsTarget
      )
    : null;

  const sidebarTools = sidebarToolsTarget
    ? createPortal(
        <div className="flex flex-col items-start gap-3 text-white w-full">
          <div
            className={`${
              actionsOpen ? "flex" : "hidden"
            } flex-col items-start gap-2 w-full`}
          >
            {toolsButtons}
          </div>
          {toolsToggleButton}
        </div>,
        sidebarToolsTarget
      )
    : null;

  if (loading) return <p className="p-6 text-white">Chargement...</p>;
  if (!team) return <p className="p-6 text-white">Aucune donnée trouvée.</p>;

  return (
    <CibleProvider active={cibleActive} match={cibleMatch}>
      <div
        className={`min-h-screen w-full p-6 text-white relative${
          cibleActive ? " cible-active" : ""
        }`}
      >
      {sidebarTools}
      {mobileTools}
      {bannerLabel ? (
        <button
          type="button"
          onClick={handleResetDate}
          className="mb-4 w-full rounded-lg border border-red-500/70 bg-red-600/70 px-4 py-2 text-sm text-white hover:bg-red-600/80 transition"
        >
          Stats du {bannerLabel} - Revenir a aujourd'hui
        </button>
      ) : null}
      {calendarOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            aria-label="Fermer calendrier"
            onClick={() => setCalendarOpen(false)}
          />
          <div className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-xl border border-white/10 bg-white/10 backdrop-blur-md shadow-lg">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="text-sm font-semibold text-white">Calendrier des matchs</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleResetDate();
                    setCalendarOpen(false);
                  }}
                  className="rounded-md bg-white/10 px-3 py-1 text-xs text-white/80 hover:bg-white/20"
                >
                  Date actuelle
                </button>
                <button
                  type="button"
                  onClick={() => setCalendarOpen(false)}
                  className="rounded-md bg-white/10 px-3 py-1 text-xs text-white/80 hover:bg-white/20"
                >
                  Fermer
                </button>
              </div>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
              {calendarLoading ? (
                <div className="text-sm text-white/70">Chargement des matchs...</div>
              ) : calendarError ? (
                <div className="text-sm text-red-300">{calendarError}</div>
              ) : calendarList.length === 0 ? (
                <div className="text-sm text-white/70">Aucun match disponible.</div>
              ) : (
                <div className="space-y-2">
                  {calendarList.map((fixture) => {
                    const dateRaw = fixture.date_utc ?? null;
                    const dateLabel = dateRaw
                      ? format(new Date(dateRaw), "dd MMM yyyy HH:mm", { locale: enUS })
                      : "Date inconnue";
                    const homeName =
                      fixture.teams?.name ?? fixture.home_team_name ?? "Home";
                    const awayName =
                      fixture.opp?.name ?? fixture.away_team_name ?? "Away";
                    const scoreLabel =
                      fixture.goals_home != null && fixture.goals_away != null
                        ? `${fixture.goals_home} - ${fixture.goals_away}`
                        : "VS";
                    const isFinal =
                      fixture.goals_home != null && fixture.goals_away != null;
                    const isNotStarted = !isFinal;
                    const nsTextClass = isNotStarted ? "blur-[1px]" : "";
                    const isSelected = asOfParam === fixture.date_utc;
                    const hasTeamId = Number.isFinite(teamId);
                    const isTeamHome = hasTeamId && fixture.home_team_id === teamId;
                    const isTeamAway = hasTeamId && fixture.away_team_id === teamId;
                    const goalsFor = isFinal
                      ? isTeamHome
                        ? fixture.goals_home
                        : isTeamAway
                          ? fixture.goals_away
                          : null
                      : null;
                    const goalsAgainst = isFinal
                      ? isTeamHome
                        ? fixture.goals_away
                        : isTeamAway
                          ? fixture.goals_home
                          : null
                      : null;
                    const titleColorClass = isFinal && goalsFor != null && goalsAgainst != null
                      ? goalsFor > goalsAgainst
                        ? "text-green-400"
                        : goalsFor < goalsAgainst
                          ? "text-red-400"
                          : "text-blue-400"
                      : isNotStarted
                        ? "text-white/60"
                        : isSelected
                          ? "text-white"
                          : "text-white/80";
                    const scoreClass = isNotStarted ? "text-xs text-white/60" : "text-xs text-white/70";
                    return (
                      <button
                        key={fixture.id ?? `${homeName}-${awayName}-${dateRaw}`}
                        type="button"
                        onClick={() => handleSelectMatch(fixture)}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                          isSelected
                            ? "border-emerald-400/40 bg-emerald-500/10 text-white"
                            : "border-white/10 bg-black/20 text-white/80 hover:bg-white/10"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className={`font-semibold ${titleColorClass} ${nsTextClass}`}>
                            {homeName} vs {awayName}
                          </span>
                          <span className={`text-xs text-white/60 ${nsTextClass}`}>
                            {dateLabel}
                          </span>
                        </div>
                        <div className={`mt-1 ${scoreClass} ${nsTextClass}`}>
                          Score: {scoreLabel}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm opacity-80">
        <Link href="/leagues" className="hover:underline">Leagues</Link>
        <span>/</span>
        {league ? (
          <Link href={`/league/${league.id}`} className="hover:underline">
            Championnat
          </Link>
        ) : (
          <button onClick={() => router.back()} className="hover:underline">Championnat</button>
        )}
        <span>/</span>
        <span className="font-semibold">{team.name}</span>
      </div>

      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:items-center sm:gap-4 mx-auto mb-6 text-white text-center">
        {team.logo && (
          <img
            src={team.logo}
            alt={team.name}
            className="w-20 h-20 object-contain drop-shadow-lg"
          />
        )}

        <div className="flex flex-col items-center">
          <h1 className="text-3xl font-bold">{team.name}</h1>
          {league && <p className="text-sm opacity-80 mt-1">{league.name} - Season 2025</p>}
        </div>
      </div>

      <div className="flex flex-nowrap gap-3 mb-4 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-1 sm:flex-wrap sm:overflow-visible sm:justify-center">
        {rangeOptions.map((value) => {
          const isActive = value === range;
          return (
            <button
              key={`range-${value}`}
              type="button"
              onClick={() => setRange(value)}
              className={`px-2 py-0.5 text-[12px] rounded-md snap-start whitespace-nowrap text-center min-w-[82px] transition ${
                isActive
                  ? "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-500 text-white"
                  : "bg-white/10 text-white/60 blur-[0.8px] opacity-70 hover:bg-white/15"
              }`}
            >
              {formatRangeLabel(value)}
            </button>
          );
        })}
      </div>

      <div className="flex flex-nowrap gap-2 mb-6 border-b pb-2 overflow-x-auto no-scrollbar snap-x snap-mandatory sm:flex-wrap sm:gap-4 sm:overflow-visible sm:justify-center">
        {tabOptions.map((item) => {
          const isActive = item.key === tab;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`px-2 pb-2 text-sm snap-start whitespace-nowrap text-center min-w-[96px] sm:min-w-[110px] transition ${
                isActive ? "font-semibold text-white" : "text-white/60 blur-[0.8px] opacity-70"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "dashboard" ? (
        <DashboardView
          stats={stats}
          league={league}
          fixtures={fixtures}
          team={team}
          nextMatch={effectiveNextMatch}
          standings={standings}
          opponentFixtures={opponentFixtures}
          filter={probabilityFilter}
          range={range}
          nextOpponentName={nextOpponentName}
          nextOpponentId={nextOpponentId}
          calendarActive={calendarActive}
        />
      ) : tab === "stats" ? (
        <ProbabilitiesView
          fixtures={fixtures}
          teamId={teamId}
          isTeamHome={isTeamHome}
          range={effectiveRange}
          cutoffDate={cutoffDate}
          nextOpponentId={nextOpponentId}
          nextOpponentName={nextOpponentName}
          overUnderMatchKeys={overUnderMatchKeys}
          overUnderHighlight={overUnderHighlight}
          showOpponentComparison={showOpponentComparison}
          cibleActive={cibleActive}
          filter={probabilityFilter}
          onFilterChange={setProbabilityFilter}
        />
      ) : tab === "odds" ? (
        <OddsView
          teamId={teamId}
          nextOpponentId={nextOpponentId}
          leagueId={league?.id ?? null}
          season={league?.season ?? CURRENT_SEASON}
          isTeamHome={isTeamHome}
          range={effectiveRange}
          cutoffDate={cutoffDate}
          filter={probabilityFilter}
        />
      ) : tab === "confidence" ? (
        <ConfidenceView
          fixtures={calendarFixtures.length ? calendarFixtures : fixtures}
          teamId={teamId}
          leagueId={leagueIdForStats}
          range={effectiveRange}
          asOfDate={asOfDate}
        />
      ) : tab === "league" ? (
        <LeagueStatsView
          leagueId={leagueIdForStats}
          season={CURRENT_SEASON}
        />
      ) : tab === "backtest" ? (
        <BacktestView
          teamId={Number.isFinite(teamId) ? teamId : null}
          leagueId={leagueIdForStats}
          range={effectiveRange}
          currentSeason={CURRENT_SEASON}
          nextMatch={effectiveNextMatch}
        />
      ) : (
        <div className="max-w-4xl">
          <div className="p-6 bg-white/10 backdrop-blur-sm border border-white/10 rounded-xl text-white">
            <OddsConverter />
          </div>
        </div>
      )}
    </div>
    </CibleProvider>
  );
}

function selectFixturesForRange(
  fixtures: FixtureItem[] = [],
  range?: RangeOption,
  cutoffDate?: Date | null
) {
  let played = fixtures.filter(
    (fixture) => fixture.goals_home !== null && fixture.goals_away !== null
  );

  if (range === "season") {
    played = played.filter((fixture) => fixture.season === CURRENT_SEASON);
  }

  if (cutoffDate) {
    const cutoffTime = cutoffDate.getTime();
    played = played.filter((fixture) => {
      const time = getFixtureTimestamp(fixture);
      return time > 0 && time <= cutoffTime;
    });
  }

  played.sort(
    (a, b) => new Date(b.date_utc).getTime() - new Date(a.date_utc).getTime()
  );

  const selectedCount = range === "season" || range == null ? played.length : range;
  return played.slice(0, selectedCount);
}

function resolveLeagueIdFromFixtures(fixtures: FixtureItem[] = [], season: number) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) return null;
  const seasonMatches = fixtures.filter(
    (fixture) => Number(fixture?.season) === season
  );
  const candidates = seasonMatches.length ? seasonMatches : fixtures;
  const counts = new Map<number, number>();
  candidates.forEach((fixture) => {
    const rawId = fixture?.competition_id;
    const id = Number(rawId);
    if (!Number.isFinite(id)) return;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  });

  let bestId: number | null = null;
  let bestCount = 0;
  counts.forEach((count, id) => {
    if (count > bestCount) {
      bestCount = count;
      bestId = id;
    }
  });

  return bestId;
}

function getFixtureTimestamp(fixture: FixtureItem) {
  const raw =
    fixture?.date_utc ?? fixture?.date ?? fixture?.fixture?.date ?? fixture?.timestamp ?? null;
  if (raw == null) return 0;
  if (typeof raw === "number") {
    return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  }
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getLatestPlayedFixture(fixtures: FixtureItem[] = []) {
  const played = fixtures.filter(
    (fixture) => fixture?.goals_home != null && fixture?.goals_away != null
  );
  let latest: FixtureItem | null = null;
  let latestTs = -Infinity;
  for (const fixture of played) {
    const ts = getFixtureTimestamp(fixture);
    if (ts > latestTs) {
      latest = fixture;
      latestTs = ts;
    }
  }
  return latest;
}

function getNextMatchLabel(nextMatch: NextMatch, fallback: string) {
  const homeName = nextMatch?.teams?.home?.name;
  const awayName = nextMatch?.teams?.away?.name;
  if (homeName && awayName) return `${homeName} VS ${awayName}`;
  return fallback;
}

function describeTrendSignal(
  fixture: FixtureItem | null,
  stats: any,
  label: string
) {
  if (!fixture) return { active: false, reason: null };
  const home = Number(fixture.goals_home ?? 0);
  const away = Number(fixture.goals_away ?? 0);
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return { active: false, reason: null };
  }
  const totalGoals = home + away;
  const reasons: string[] = [];

  if (totalGoals > LAST_MATCH_TOTAL_GOALS_THRESHOLD) {
    reasons.push(`+${LAST_MATCH_TOTAL_GOALS_THRESHOLD} buts (${totalGoals})`);
  }

  const isDraw = home === away;
  const drawPercent = stats?.draw?.percent;
  if (
    isDraw &&
    typeof drawPercent === "number" &&
    drawPercent >= 0 &&
    drawPercent <= DRAW_PERCENT_MAX
  ) {
    reasons.push(`nul + % nuls ${drawPercent}%`);
  }

  if (reasons.length === 0) return { active: false, reason: null };
  const safeLabel = label || "Équipe";
  return { active: true, reason: `${safeLabel} ${reasons.join(" et ")}` };
}

function getHighlightBandKeySet(stats: any) {
  const matches = new Set<string>();
  const ranges = [
    { min: OVER_UNDER_HIGH_MIN, max: OVER_UNDER_HIGH_MAX, band: "high" as const },
  ];
  const addMatches = (key: string, value: any) => {
    const percent =
      typeof value?.percent === "number" ? value.percent : Number(value?.percent ?? 0);
    if (!Number.isFinite(percent)) return;
    for (const range of ranges) {
      if (percent >= range.min && percent <= range.max) {
        matches.add(`${key}:${range.band}`);
      }
    }
  };
  const addOverUnderMatches = (label: "over" | "under", entries: Record<string, any>) => {
    for (const [key, value] of Object.entries(entries || {})) {
      addMatches(`${label}:${key}`, value);
    }
  };

  addOverUnderMatches("over", stats?.over ?? {});
  addOverUnderMatches("under", stats?.under ?? {});
  addMatches("dc:1x", stats?.dc_1x);
  addMatches("dc:x2", stats?.dc_x2);
  addMatches("dc:12", stats?.dc_12);
  return matches;
}

function getHighlightMatchKeys(teamStats: any, opponentStats: any) {
  const teamKeys = getHighlightBandKeySet(teamStats);
  const opponentKeys = getHighlightBandKeySet(opponentStats);
  const matches = new Set<string>();
  teamKeys.forEach((bandedKey) => {
    if (!opponentKeys.has(bandedKey)) return;
    const [type, key] = bandedKey.split(":");
    if (type && key) matches.add(`${type}:${key}`);
  });
  return matches;
}

function getNextOpponentId(nextMatch: NextMatch, teamId: number) {
  if (!nextMatch || !Number.isFinite(teamId)) return null;
  const homeId = nextMatch?.teams?.home?.id;
  const awayId = nextMatch?.teams?.away?.id;
  if (!homeId || !awayId) return null;
  return homeId === teamId ? awayId : homeId;
}

function getNextOpponentName(nextMatch: NextMatch, teamId: number) {
  if (!nextMatch || !Number.isFinite(teamId)) return null;
  const home = nextMatch?.teams?.home;
  const away = nextMatch?.teams?.away;
  if (!home?.id || !away?.id) return null;
  return home.id === teamId ? away?.name ?? null : home?.name ?? null;
}

function DashboardView({
  stats,
  league,
  fixtures,
  team,
  nextMatch,
  standings,
  opponentFixtures,
  filter,
  range,
  nextOpponentName,
  nextOpponentId,
  calendarActive,
}: {
  stats: any;
  league: any;
  fixtures: FixtureItem[];
  team: any;
  nextMatch: NextMatch;
  standings: any[];
  opponentFixtures: FixtureItem[];
  filter: "FT" | "HT" | "2H";
  range: RangeOption;
  nextOpponentName: string | null;
  nextOpponentId: number | null;
  calendarActive: boolean;
}) {
  if (!stats) return <p className="opacity-60">Aucune statistique disponible.</p>;

  const [showAllForm, setShowAllForm] = useState<boolean>(false);
  const [mobileCarouselIndex, setMobileCarouselIndex] = useState(0);
  const mobileCarouselRef = useRef<HTMLDivElement | null>(null);
  const mobileCarouselSlides = 2;
  const fixturesLimited = fixtures || [];

  const standingsTable = Array.isArray(standings) ? standings : [];

  // Filtrer les fixtures valides (securise contre undefined)
  const validFixtures = fixturesLimited.filter(
    (f) => f?.fixture?.date
  );

  // Trier avec fallback securise
  const fixturesSorted = [...validFixtures].sort((a, b) => {
    const dateA = new Date(a.fixture.date).getTime();
    const dateB = new Date(b.fixture.date).getTime();
    return dateA - dateB;
  });

  const pastMatches = fixturesSorted.filter(
    (f) => new Date(f.fixture.date).getTime() < Date.now()
  );

  const futureMatches = fixturesSorted.filter(
    (f) => new Date(f.fixture.date).getTime() >= Date.now()
  );

  const lastPlayed = pastMatches[pastMatches.length - 1] || null;

  // Premier match futur valide
  const computedNextMatch = nextMatch || futureMatches[0] || null;
  const h2hHomeId = computedNextMatch?.teams?.home?.id ?? null;
  const h2hAwayId = computedNextMatch?.teams?.away?.id ?? null;
  const h2hLeagueId = league?.id ?? computedNextMatch?.league?.id ?? null;
  const formMatches = showAllForm ? fixturesLimited : fixturesLimited.slice(0, 5);
  const formLettersFull = fixturesLimited.map((f) => {
    const gf = f.isHome ? f.goals_home : f.goals_away;
    const ga = f.isHome ? f.goals_away : f.goals_home;

    if (gf > ga) return "W";
    if (gf < ga) return "L";
    return "D";
  });
  const formLine = formLettersFull.slice(0, 10);
  const playedMatches = stats.played ?? 0;
  const goalsFor = stats.goalsFor ?? 0;
  const goalsAgainst = stats.goalsAgainst ?? 0;

  const handleMobileCarouselScroll = () => {
    const el = mobileCarouselRef.current;
    if (!el || el.clientWidth === 0) return;
    const nextIndex = Math.round(el.scrollLeft / el.clientWidth);
    const bounded = Math.max(0, Math.min(mobileCarouselSlides - 1, nextIndex));
    if (bounded !== mobileCarouselIndex) {
      setMobileCarouselIndex(bounded);
    }
  };

  const nextMatchCard = (
    <div
      className={`p-4 rounded-xl bg-white/5 border border-white/10 flex flex-col gap-3 ${
        calendarActive ? "ring-1 ring-red-500/70" : ""
      }`}
    >
      <h2 className="text-base sm:text-lg font-semibold">Prochain match</h2>
      {!computedNextMatch ? (
        <p>Aucun prochain match.</p>
      ) : (
        <>
          {/* Date + Heure + Journee */}
          <div className="text-[10px] sm:text-xs text-gray-300">
            {format(new Date(computedNextMatch.fixture.date), "dd MMM yyyy")} -{" "}
            {format(new Date(computedNextMatch.fixture.date), "HH:mm")}
            {computedNextMatch.league.round ? (
              <> - Journee {computedNextMatch.league.round.replace("Regular Season - ", "")}</>
            ) : null}
            {computedNextMatch.fixture?.id ? (
              <span className="text-xs text-white/75 font-normal">
                {" "}
                ({computedNextMatch.fixture.id})
              </span>
            ) : null}
          </div>

          {/* Match Banner */}
          <div className="flex items-center justify-between gap-3 w-full">
            {/* Home */}
            <div className="flex flex-col items-center flex-1 min-w-0">
              <img
                src={computedNextMatch.teams.home.logo}
                alt={computedNextMatch.teams.home.name}
                className="w-9 h-9 sm:w-12 sm:h-12"
              />
              <p className="mt-2 text-sm sm:text-base font-semibold text-center leading-tight">
                {computedNextMatch.teams.home.name}
              </p>
            </div>

            {/* Score or VS */}
            <div className="flex flex-col items-center flex-1 min-w-0">
              {computedNextMatch.fixture.status.short === "NS" ? (
                <p className="text-base sm:text-lg font-bold">VS</p>
              ) : (
                <p className="text-base sm:text-lg font-bold">
                  {computedNextMatch.goals.home} - {computedNextMatch.goals.away}
                </p>
              )}
            </div>

            {/* Away */}
            <div className="flex flex-col items-center flex-1 min-w-0">
              <img
                src={computedNextMatch.teams.away.logo}
                alt={computedNextMatch.teams.away.name}
                className="w-9 h-9 sm:w-12 sm:h-12"
              />
              <p className="mt-2 text-sm sm:text-base font-semibold text-center leading-tight">
                {computedNextMatch.teams.away.name}
              </p>
            </div>
          </div>

          {/* Stade */}
          {(computedNextMatch.fixture.venue?.name || computedNextMatch.league?.name) && (
            <p className="text-[10px] sm:text-xs text-gray-400 text-center mt-1">
              {computedNextMatch.fixture.venue?.name
                ? `Stade : ${computedNextMatch.fixture.venue.name}`
                : null}
              {computedNextMatch.fixture.venue?.name && computedNextMatch.league?.name
                ? " • "
                : null}
              {computedNextMatch.league?.name ?? null}
            </p>
          )}
        </>
      )}
    </div>
  );

  const standingsCard = (
    <div className="p-5 bg-white/5 rounded-xl shadow text-white">
      <h2 className="font-semibold text-lg mb-3">Classement</h2>
      {standingsTable.length ? (
        <div className="max-h-[420px] overflow-y-auto pr-2">
          <StandingsList
            table={standingsTable}
            opponentByTeam={{}}
            focusTeamId={team?.id ?? null}
            autoScroll={false}
          />
        </div>
      ) : (
        <p className="text-sm opacity-70">Classement indisponible.</p>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

      <div className="md:col-span-2">
        <TeamAiAnalysis
          team={team}
          league={league}
          nextMatch={nextMatch}
          fixtures={fixtures}
          opponentFixtures={opponentFixtures}
          filter={filter}
          range={range}
          nextOpponentName={nextOpponentName}
          nextOpponentId={nextOpponentId}
        />
      </div>

      <div className="hidden md:grid md:col-span-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
        <div className="flex flex-col gap-6">
          {nextMatchCard}
          <H2HCard
            homeId={h2hHomeId}
            awayId={h2hAwayId}
            leagueId={h2hLeagueId}
          />
        </div>
        {standingsCard}
      </div>
      <div className="md:hidden space-y-2">
        <div className="flex items-center justify-center gap-2" aria-hidden="true">
          {Array.from({ length: mobileCarouselSlides }).map((_, idx) => (
            <span
              key={`match-dot-${idx}`}
              className={`h-1.5 w-1.5 rounded-full ${
                idx === mobileCarouselIndex ? "bg-blue-400" : "bg-white/30"
              }`}
            />
          ))}
        </div>
        <div
          ref={mobileCarouselRef}
          onScroll={handleMobileCarouselScroll}
          className="flex flex-nowrap gap-6 overflow-x-auto no-scrollbar snap-x snap-mandatory"
        >
          <div className="snap-start shrink-0 w-full">
            {nextMatchCard}
          </div>
          <div className="snap-start shrink-0 w-full">
            <H2HCard
              homeId={h2hHomeId}
              awayId={h2hAwayId}
              leagueId={h2hLeagueId}
            />
          </div>
        </div>
      </div>

      <div className="md:hidden">
        {standingsCard}
      </div>

      <div className="bg-white/5 rounded-xl shadow p-6 text-white md:col-span-2">
        <h2 className="text-xl font-semibold mb-4">Forme</h2>

        {/* SERIE */}
        <div className="text-sm font-bold mt-1 mb-3">
          {formLine.map((letter, idx) => {
            const isFirst = idx === 0;
            const colorClass = !isFirst
              ? ""
              : letter === "W"
              ? "text-green-400"
              : letter === "L"
              ? "text-red-400"
              : "text-blue-400";

            return (
              <span key={idx}>
                {idx > 0 && " - "}
                <span className={colorClass}>{letter}</span>
              </span>
            );
          })}
        </div>

        {/* LISTE DETAILLEE DES MATCHS */}
        <div className="space-y-1">
          {formMatches.map((f: any, idx: number) => {
            const match = {
              date: f.date_utc,
              home: { name: f.home_team_name, logo: f.home_team_logo },
              away: { name: f.away_team_name, logo: f.away_team_logo },
              gh: f.goals_home,
              ga: f.goals_away,
            };

            return (
              <div
                key={f.id ?? idx}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between py-2 text-sm border-b border-white/10 last:border-0"
              >
                {/* DATE */}
                <div className="w-full sm:w-24 text-white/70">
                  {format(new Date(match.date), "dd MMM yyyy")}
                </div>

                {/* MATCH */}
                <div className="flex-1 flex flex-col sm:flex-row sm:items-center sm:justify-center gap-2 sm:gap-6 w-full">

                  {/* HOME */}
                  <div className="flex items-center justify-start gap-2 w-full sm:w-40">
                    {match.home.logo && <img src={match.home.logo} className="w-5 h-5" />}
                    <span className="font-medium">{match.home.name}</span>
                  </div>

                  {/* SCORE */}
                  <div className="text-lg font-semibold w-full sm:w-12 text-center">
                    {match.gh} - {match.ga}
                  </div>

                  {/* AWAY */}
                  <div className="flex items-center justify-end gap-2 w-full sm:w-40">
                    <span className="font-medium text-right">{match.away.name}</span>
                    {match.away.logo && <img src={match.away.logo} className="w-5 h-5" />}
                  </div>

                </div>
              </div>
            );
          })}
        </div>

        {fixturesLimited.length > 5 && (
          <div className="text-center mt-3">
            <button
              onClick={() => setShowAllForm(!showAllForm)}
              className="text-white text-sm font-semibold hover:underline"
            >
              {showAllForm ? "Reduire" : "Voir plus"}
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

type H2HFixture = {
  fixture?: {
    id?: number;
    date?: string;
  };
  teams?: {
    home?: { id?: number; name?: string; logo?: string };
    away?: { id?: number; name?: string; logo?: string };
  };
  goals?: {
    home?: number | null;
    away?: number | null;
  };
  league?: {
    season?: number;
    round?: string;
  };
};

function H2HCard({
  homeId,
  awayId,
  leagueId,
}: {
  homeId: number | null;
  awayId: number | null;
  leagueId: number | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bySeason, setBySeason] = useState<Record<number, H2HFixture[]>>({});

  useEffect(() => {
    let active = true;
    if (!homeId || !awayId || !leagueId) {
      setBySeason({});
      setError(null);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError(null);

    Promise.all(
      H2H_SEASONS.map(async (season) => {
        try {
          const data = await fetchApi("fixtures/headtohead", {
            h2h: `${homeId}-${awayId}`,
            league: leagueId,
            season,
          });
          return { season, matches: Array.isArray(data?.response) ? data.response : [] };
        } catch (err: any) {
          return { season, matches: [], error: err?.message ?? "Erreur H2H." };
        }
      })
    )
      .then((results) => {
        if (!active) return;
        const nextBySeason: Record<number, H2HFixture[]> = {};
        let errorMessage: string | null = null;
        results.forEach((result) => {
          nextBySeason[result.season] = result.matches ?? [];
          if (!errorMessage && result.error) {
            errorMessage = result.error;
          }
        });
        setBySeason(nextBySeason);
        setError(errorMessage);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [homeId, awayId, leagueId]);

  return (
    <div className="p-5 bg-white/5 rounded-xl shadow text-white">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-semibold text-lg">H2H</h2>
          <p className="text-xs text-white/70">Saisons 2024 & 2025</p>
        </div>
      </div>

      {!homeId || !awayId || !leagueId ? (
        <p className="text-sm opacity-70">Aucun prochain match.</p>
      ) : loading ? (
        <p className="text-sm opacity-70">Chargement H2H...</p>
      ) : (
        <div className="space-y-4 max-h-[14rem] overflow-y-auto pr-2 no-scrollbar">
          {H2H_SEASONS.map((season) => {
            const matches = bySeason[season] ?? [];
            const sortedMatches = [...matches].sort((a, b) => {
              const dateA = a.fixture?.date ? new Date(a.fixture.date).getTime() : 0;
              const dateB = b.fixture?.date ? new Date(b.fixture.date).getTime() : 0;
              return dateB - dateA;
            });
            return (
              <div key={`h2h-${season}`}>
                <div className="text-xs text-white/60 font-semibold mb-2">
                  Saison {season}
                </div>
                {sortedMatches.length === 0 ? (
                  <p className="text-xs text-white/50">Aucun match H2H.</p>
                ) : (
                  <div className="space-y-2">
                    {sortedMatches.map((match, idx) => {
                      const home = match.teams?.home;
                      const away = match.teams?.away;
                      const dateRaw = match.fixture?.date;
                      const dateLabel = dateRaw
                        ? format(new Date(dateRaw), "dd MMM yyyy")
                        : "--";
                      const score =
                        match.goals?.home != null && match.goals?.away != null
                          ? `${match.goals.home} - ${match.goals.away}`
                          : "--";

                      return (
                        <div
                          key={match.fixture?.id ?? `${season}-${idx}`}
                          className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-xs"
                        >
                          <div className="text-[10px] text-white/40 tabular-nums">
                            {dateLabel}
                          </div>
                          <div className="flex items-center gap-2 min-w-0">
                            {home?.logo ? (
                              <img
                                src={home.logo}
                                alt={home.name ?? "Home"}
                                className="w-4 h-4"
                              />
                            ) : null}
                            <span className="truncate">{home?.name ?? "Home"}</span>
                          </div>
                          <div className="text-sm font-semibold tabular-nums text-white/80">
                            {score}
                          </div>
                          <div className="flex items-center justify-end gap-2 min-w-0 text-right">
                            <span className="truncate">{away?.name ?? "Away"}</span>
                            {away?.logo ? (
                              <img
                                src={away.logo}
                                alt={away.name ?? "Away"}
                                className="w-4 h-4"
                              />
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error ? <p className="text-xs text-red-300 mt-2">{error}</p> : null}
      </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-white/70">{label}</span>
      <span className="text-lg font-semibold text-white">{value}</span>
    </div>
  );
}

function formatRatio(value: number, total: number) {
  if (!total || total <= 0) return "0";
  const ratio = value / total;
  const rounded = Math.round(ratio * 100) / 100;
  return rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(2);
}
