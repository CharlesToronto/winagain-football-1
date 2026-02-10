export const SEARCH_BG_SCAN_STATE_KEY = "winagain:search-algo:bg-scan-state:v1";
export const SEARCH_BG_SCAN_CANCEL_KEY = "winagain:search-algo:bg-scan-cancel:v1";
export const SEARCH_BG_SCAN_EVENT = "winagain:search-algo:bg-scan-event:v1";

export type SearchBgScanStatus = "running" | "done" | "error";

export type SearchBgScanState = {
  scanId: string;
  scanDate: string; // YYYY-MM-DD (America/Toronto date key)
  target: "today" | "tomorrow";
  status: SearchBgScanStatus;
  startedAt: string; // ISO string
  updatedAt: string; // ISO string
  progress: number; // 0..100
  message: string | null;
  rowsCount: number | null;
};

export function readSearchBgScanState(): SearchBgScanState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SEARCH_BG_SCAN_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.scanId !== "string") return null;
    if (typeof parsed.scanDate !== "string") return null;
    if (parsed.target !== "today" && parsed.target !== "tomorrow") return null;
    if (parsed.status !== "running" && parsed.status !== "done" && parsed.status !== "error") {
      return null;
    }
    return {
      scanId: parsed.scanId,
      scanDate: parsed.scanDate,
      target: parsed.target,
      status: parsed.status,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      progress:
        typeof parsed.progress === "number" && Number.isFinite(parsed.progress)
          ? parsed.progress
          : 0,
      message: typeof parsed.message === "string" ? parsed.message : null,
      rowsCount:
        parsed.rowsCount == null
          ? null
          : typeof parsed.rowsCount === "number" && Number.isFinite(parsed.rowsCount)
            ? parsed.rowsCount
            : null,
    };
  } catch {
    return null;
  }
}

export function writeSearchBgScanState(state: SearchBgScanState | null) {
  if (typeof window === "undefined") return;
  try {
    if (!state) {
      window.localStorage.removeItem(SEARCH_BG_SCAN_STATE_KEY);
    } else {
      window.localStorage.setItem(SEARCH_BG_SCAN_STATE_KEY, JSON.stringify(state));
    }
  } catch {
    // Ignore storage errors
  } finally {
    try {
      window.dispatchEvent(new Event(SEARCH_BG_SCAN_EVENT));
    } catch {
      // Ignore event errors
    }
  }
}

export function requestSearchBgScanCancel(scanId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEARCH_BG_SCAN_CANCEL_KEY, scanId);
  } catch {
    // Ignore storage errors
  } finally {
    try {
      window.dispatchEvent(new Event(SEARCH_BG_SCAN_EVENT));
    } catch {
      // Ignore event errors
    }
  }
}

export function isSearchBgScanCancelRequested(scanId: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SEARCH_BG_SCAN_CANCEL_KEY) === scanId;
  } catch {
    return false;
  }
}

export function clearSearchBgScanCancel(scanId: string) {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(SEARCH_BG_SCAN_CANCEL_KEY) === scanId) {
      window.localStorage.removeItem(SEARCH_BG_SCAN_CANCEL_KEY);
    }
  } catch {
    // Ignore storage errors
  } finally {
    try {
      window.dispatchEvent(new Event(SEARCH_BG_SCAN_EVENT));
    } catch {
      // Ignore event errors
    }
  }
}

