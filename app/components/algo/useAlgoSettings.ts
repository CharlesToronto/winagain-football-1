"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlgoSettings,
  DEFAULT_ALGO_SETTINGS,
  normalizeAlgoSettings,
} from "@/lib/analysisEngine/overUnderModel";

const STORAGE_KEY = "winagain:algo-settings:v1";
const EVENT_NAME = "algo-settings-updated";

type UpdatePayload = Partial<AlgoSettings>;

function loadStoredSettings(): AlgoSettings {
  if (typeof window === "undefined") return DEFAULT_ALGO_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ALGO_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AlgoSettings>;
    return normalizeAlgoSettings(parsed);
  } catch {
    return DEFAULT_ALGO_SETTINGS;
  }
}

function persistSettings(settings: AlgoSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

export function useAlgoSettings() {
  const [settings, setSettings] = useState<AlgoSettings>(() => loadStoredSettings());

  useEffect(() => {
    setSettings(loadStoredSettings());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setSettings(loadStoredSettings());
    };

    const handleCustom = (event: Event) => {
      const custom = event as CustomEvent<AlgoSettings>;
      if (custom?.detail) {
        setSettings(normalizeAlgoSettings(custom.detail));
      } else {
        setSettings(loadStoredSettings());
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(EVENT_NAME, handleCustom as EventListener);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(EVENT_NAME, handleCustom as EventListener);
    };
  }, []);

  const updateSettings = useCallback((patch: UpdatePayload) => {
    setSettings((prev) => {
      const next = normalizeAlgoSettings({ ...prev, ...patch });
      persistSettings(next);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
      }
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    updateSettings(DEFAULT_ALGO_SETTINGS);
  }, [updateSettings]);

  const apiPayload = useMemo(() => settings, [settings]);

  return { settings, updateSettings, resetSettings, apiPayload };
}
