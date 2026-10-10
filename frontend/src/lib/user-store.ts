import type { FactCheckResult, HistoryItem } from "./types";
import { useAuth } from "./auth";

/**
 * Per-user client-side data store.
 *
 * The backend has no concept of users (history is global), so each signed-in
 * user gets a namespaced slice of localStorage keyed by their email. Guests
 * use the "guest" namespace. Everything degrades gracefully when
 * localStorage is unavailable (SSR, private mode quota, etc.).
 */

export interface UserHistoryEntry extends HistoryItem {
  pinned?: boolean;
}

export interface UserPrefs {
  defaultMaxClaims: number;
  autoSaveDraft: boolean;
}

export const DEFAULT_PREFS: UserPrefs = {
  defaultMaxClaims: 5,
  autoSaveDraft: true,
};

const MAX_HISTORY = 100;
const MAX_FULL_RESULTS = 50;

export const GUEST_KEY = "guest";

function ns(userKey: string) {
  return `factcheck.u.${encodeURIComponent(userKey || GUEST_KEY)}`;
}
const historyKey = (u: string) => `${ns(u)}.history`;
const resultKey = (u: string, id: string) => `${ns(u)}.result.${id}`;
const prefsKey = (u: string) => `${ns(u)}.prefs`;
const draftKey = (u: string) => `${ns(u)}.draft`;

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---------- History ----------

export function getUserHistory(userKey: string): UserHistoryEntry[] {
  return readJson<UserHistoryEntry[]>(historyKey(userKey)) ?? [];
}

function setUserHistory(userKey: string, items: UserHistoryEntry[]) {
  writeJson(historyKey(userKey), items.slice(0, MAX_HISTORY));
}

/** Record a completed fact-check under this user. */
export function recordResult(userKey: string, result: FactCheckResult) {
  writeJson(resultKey(userKey, result._id), result);

  const items = getUserHistory(userKey).filter((h) => h._id !== result._id);
  items.unshift({
    _id: result._id,
    article_text: (result.article_text ?? "").slice(0, 200),
    credibility_score: result.credibility_score,
    created_at: result.created_at ?? new Date().toISOString(),
    mode: result.mode,
  });
  setUserHistory(userKey, items);
  pruneFullResults(userKey, items);
}

/** Keep only the newest MAX_FULL_RESULTS full result payloads. */
function pruneFullResults(userKey: string, items: UserHistoryEntry[]) {
  if (typeof window === "undefined") return;
  const keep = new Set(items.slice(0, MAX_FULL_RESULTS).map((i) => i._id));
  const prefix = `${ns(userKey)}.result.`;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix) && !keep.has(key.slice(prefix.length))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
}

export function getLocalResult(userKey: string, id: string): FactCheckResult | null {
  return readJson<FactCheckResult>(resultKey(userKey, id));
}

export function togglePin(userKey: string, id: string): UserHistoryEntry[] {
  const items = getUserHistory(userKey).map((h) =>
    h._id === id ? { ...h, pinned: !h.pinned } : h,
  );
  setUserHistory(userKey, items);
  return items;
}

export function deleteEntry(userKey: string, id: string): UserHistoryEntry[] {
  const items = getUserHistory(userKey).filter((h) => h._id !== id);
  setUserHistory(userKey, items);
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(resultKey(userKey, id));
    } catch {
      /* ignore */
    }
  }
  return items;
}

export function clearHistory(userKey: string) {
  if (typeof window === "undefined") return;
  const prefix = `${ns(userKey)}.result.`;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
    localStorage.removeItem(historyKey(userKey));
  } catch {
    /* ignore */
  }
}

// ---------- Preferences ----------

export function getPrefs(userKey: string): UserPrefs {
  return { ...DEFAULT_PREFS, ...(readJson<Partial<UserPrefs>>(prefsKey(userKey)) ?? {}) };
}

export function setPrefs(userKey: string, patch: Partial<UserPrefs>): UserPrefs {
  const next = { ...getPrefs(userKey), ...patch };
  writeJson(prefsKey(userKey), next);
  return next;
}

// ---------- Draft ----------

export function saveDraft(userKey: string, text: string) {
  if (typeof window === "undefined") return;
  try {
    if (text.trim()) localStorage.setItem(draftKey(userKey), text);
    else localStorage.removeItem(draftKey(userKey));
  } catch {
    /* ignore */
  }
}

export function loadDraft(userKey: string): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(draftKey(userKey)) ?? "";
  } catch {
    return "";
  }
}

export function clearDraft(userKey: string) {
  saveDraft(userKey, "");
}

// ---------- Export ----------

export function exportUserData(userKey: string) {
  const history = getUserHistory(userKey);
  return {
    exported_at: new Date().toISOString(),
    user: userKey,
    prefs: getPrefs(userKey),
    history,
    results: history
      .map((h) => getLocalResult(userKey, h._id))
      .filter((r): r is FactCheckResult => r !== null),
  };
}

// ---------- Hook ----------

/** Stable per-user namespace key derived from the auth session. */
export function useUserKey(): string {
  const { user } = useAuth();
  return user?.email ?? GUEST_KEY;
}
