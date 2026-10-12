import { type SharedState, sanitizeState } from './shareState';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Prefs {
  /** 'auto' (from time zone), 'none' (de facto) or a Natural Earth view code like 'IND'. */
  pov: string;
}

const GALLERY_KEY = 'pp.gallery.v1';
const PREFS_KEY = 'pp.prefs.v1';
const MAX_SAVED_CHARS = 50_000;

/** localStorage when usable; null in private modes or when site data is blocked. */
export function browserStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    s.setItem('pp.probe', '1');
    s.removeItem('pp.probe');
    return s;
  } catch {
    return null;
  }
}

export function loadGallery(storage: StorageLike | null): SharedState | null {
  try {
    const raw = storage?.getItem(GALLERY_KEY);
    if (!raw || raw.length > MAX_SAVED_CHARS) return null;
    return sanitizeState(JSON.parse(raw)).state;
  } catch {
    return null;
  }
}

export function saveGallery(storage: StorageLike | null, state: SharedState): void {
  try {
    storage?.setItem(GALLERY_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or storage blocked: the gallery still lives in the URL.
  }
}

export function loadPrefs(storage: StorageLike | null): Prefs {
  try {
    const raw = storage?.getItem(PREFS_KEY);
    const pov: unknown = raw ? (JSON.parse(raw) as { pov?: unknown }).pov : undefined;
    if (pov === 'auto' || pov === 'none' || (typeof pov === 'string' && /^[A-Z]{3}$/.test(pov))) return { pov };
  } catch {
    // fall through to defaults
  }
  return { pov: 'auto' };
}

export function savePrefs(storage: StorageLike | null, prefs: Prefs): void {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}
