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

const TEAM_EVENT_NAME = "algo-settings-team-updated";

type TeamEventDetail = {
  teamId: number;
  settings: AlgoSettings | null;
};

function emitTeamSettings(teamId: number, settings: AlgoSettings | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TeamEventDetail>(TEAM_EVENT_NAME, {
      detail: { teamId, settings },
    })
  );
}

export function useTeamAlgoSettings(teamId: number | null) {
  const global = useAlgoSettings();
  const [teamSettings, setTeamSettings] = useState<AlgoSettings | null>(null);

  useEffect(() => {
    setTeamSettings(null);
    if (!teamId) return;
    let active = true;
    fetchTeamAlgoSettings(teamId)
      .then((remote) => {
        if (!active || !remote) return;
        emitTeamSettings(teamId, remote);
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

    const handleCustom = (event: Event) => {
      const custom = event as CustomEvent<TeamEventDetail>;
      if (custom?.detail?.teamId !== teamId) return;
      if (custom.detail.settings) {
        setTeamSettings(normalizeAlgoSettings(custom.detail.settings));
      } else {
        setTeamSettings(null);
      }
    };

    window.addEventListener(TEAM_EVENT_NAME, handleCustom as EventListener);
    return () => {
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
        emitTeamSettings(teamId, next);
        return next;
      });
    },
    [teamId, global.settings, global.updateSettings]
  );

  const saveTeamSettings = useCallback(
    (next: AlgoSettings) => {
      if (!teamId) return;
      const normalized = normalizeAlgoSettings(next);
      setTeamSettings(normalized);
      emitTeamSettings(teamId, normalized);
      void upsertTeamAlgoSettings(teamId, normalized).catch(() => {
        // Ignore remote save errors
      });
    },
    [teamId]
  );

  const resetTeamSettings = useCallback(() => {
    if (!teamId) return;
    setTeamSettings(null);
    emitTeamSettings(teamId, null);
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
