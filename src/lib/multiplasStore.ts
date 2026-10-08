import type { PricedLeg } from "./multiplasGen";

// Browser-local store for the Múltiplas generator (like the chart filters and
// pins): named filter presets plus generated tickets, no migration needed.
export interface MultiFilterState {
  on: boolean;
  min: string;
  max: string;
}

export interface MultiFilterPreset {
  name: string;
  ligas: string[];
  fam: Record<string, MultiFilterState>;
  legsN: string;
}

export interface SavedTicket {
  id: string;
  savedAt: number;
  days: string[];
  index: number;
  legs: PricedLeg[];
  odd: number;
  p: number;
  fair: number;
  avgEdge: number;
}

const FILTERS_KEY = "apostas:multiplasFilters";
const SAVED_KEY = "apostas:multiplasSaved";
const MAX_SAVED = 30;

function read<T>(key: string, fallback: T): T {
  try {
    if (typeof window === "undefined" || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: nothing persists.
  }
}

export function loadFilterPresets(): { presets: MultiFilterPreset[]; def: string | null } {
  const parsed = read<{ presets?: MultiFilterPreset[]; def?: string }>(FILTERS_KEY, {});
  const presets = Array.isArray(parsed.presets)
    ? parsed.presets.filter((p) => typeof p?.name === "string" && p.name.length > 0)
    : [];
  return { presets, def: typeof parsed.def === "string" ? parsed.def : null };
}

export function saveFilterPresets(presets: MultiFilterPreset[], def: string | null): void {
  write(FILTERS_KEY, { presets, def });
}

export function loadSavedTickets(): SavedTicket[] {
  const list = read<SavedTicket[]>(SAVED_KEY, []);
  return Array.isArray(list) ? list.filter((t) => t && Array.isArray(t.legs)) : [];
}

export function persistSavedTickets(list: SavedTicket[]): void {
  write(SAVED_KEY, list.slice(0, MAX_SAVED));
}
