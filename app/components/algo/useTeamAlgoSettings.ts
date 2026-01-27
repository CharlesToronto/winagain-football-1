"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlgoSettings,
  normalizeAlgoSettings,
  DEFAULT_ALGO_SETTINGS,
} from "@/lib/analysisEngine/overUnderModel";
import { useAlgoSettings } from "@/app/components/algo/useAlgoSettings";
import {
  fetchTeamAlgoSettings,
  upsertTeamAlgoSettings,
} from "@/lib/adapters/teamAlgoSettings";

const TEAM_STORAGE_PREFIX = "winagain:algo-settings:team:";
const TEAM_EVENT_NAME = "algo-settings-team-updated";

type TeamEventDetail = {
  teamId: number;
  settings: AlgoSettings | null;
};

function getTeamKey(teamId: number) {
  return `${TEAM_STORAGE_PREFIX}${teamId}`;
}

function loadTeamSettings(teamId: number | null): AlgoSettings | null {
  if (typeof window === "undefined" || !teamId) return null;
  try {
    const raw = window.localStorage.getItem(getTeamKey(teamId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AlgoSettings>;
    return normalizeAlgoSettings(parsed);
  } catch {
    return null;
  }
}

function persistTeamSettings(teamId: number, settings: AlgoSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getTeamKey(teamId), JSON.stringify(settings));
    window.dispatchEvent(
      new CustomEvent<TeamEventDetail>(TEAM_EVENT_NAME, {
        detail: { teamId, settings },
      })
    );
  } catch {
    // Ignore storage errors
  }
}

function clearTeamSettings(teamId: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getTeamKey(teamId));
    window.dispatchEvent(
      new CustomEvent<TeamEventDetail>(TEAM_EVENT_NAME, {
        detail: { teamId, settings: null },
      })
    );
  } catch {
    // Ignore storage errors
  }
}

export function useTeamAlgoSettings(teamId: number | null) {
  const global = useAlgoSettings();
  const [teamSettings, setTeamSettings] = useState<AlgoSettings | null>(() =>
    loadTeamSettings(teamId)
  );

  useEffect(() => {
    setTeamSettings(loadTeamSettings(teamId));
    if (!teamId) return;
    let active = true;
    fetchTeamAlgoSettings(teamId)
      .then((remote) => {
        if (!active || !remote) return;
        persistTeamSettings(teamId, remote);
        setTeamSettings(remote);
      })
      .catch(() => {
        // Ignore remote fetch errors
      });
    return () => {
      active = false;
    };
  }, [teamId]);

  useEffect(() => {
    if (!teamId || typeof window === "undefined") return;
    const key = getTeamKey(teamId);

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      setTeamSettings(loadTeamSettings(teamId));
    };

    const handleCustom = (event: Event) => {
      const custom = event as CustomEvent<TeamEventDetail>;
      if (custom?.detail?.teamId !== teamId) return;
      if (custom.detail.settings) {
        setTeamSettings(normalizeAlgoSettings(custom.detail.settings));
      } else {
        setTeamSettings(null);
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(TEAM_EVENT_NAME, handleCustom as EventListener);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(TEAM_EVENT_NAME, handleCustom as EventListener);
    };
  }, [teamId]);

  const settings = useMemo(
    () => teamSettings ?? global.settings ?? DEFAULT_ALGO_SETTINGS,
    [teamSettings, global.settings]
  );

  const updateSettings = useCallback(
    (patch: Partial<AlgoSettings>) => {
      if (!teamId) {
        global.updateSettings(patch);
        return;
      }
      setTeamSettings((prev) => {
        const base = prev ?? global.settings ?? DEFAULT_ALGO_SETTINGS;
        const next = normalizeAlgoSettings({ ...base, ...patch });
        persistTeamSettings(teamId, next);
        return next;
      });
    },
    [teamId, global.settings, global.updateSettings]
  );

  const saveTeamSettings = useCallback(
    (next: AlgoSettings) => {
      if (!teamId) return;
      const normalized = normalizeAlgoSettings(next);
      persistTeamSettings(teamId, normalized);
      setTeamSettings(normalized);
      void upsertTeamAlgoSettings(teamId, normalized).catch(() => {
        // Ignore remote save errors
      });
    },
    [teamId]
  );

  const resetTeamSettings = useCallback(() => {
    if (!teamId) return;
    clearTeamSettings(teamId);
    setTeamSettings(null);
  }, [teamId]);

  return {
    settings,
    updateSettings,
    saveTeamSettings,
    resetTeamSettings,
    isTeamOverride: Boolean(teamSettings),
    updateGlobalSettings: global.updateSettings,
    resetGlobalSettings: global.resetSettings,
  };
}
