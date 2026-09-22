// What the live calculator remembers between visits, in this browser: for each
// game being watched, the minute, the score and the expected goals, so coming back
// finds it as it was left. A minute that was running goes on by itself for the
// time spent away (it is kept as the minute it was at a given moment).

export interface SavedGame {
  key: string; // which game: the Sportscore slugs, or league and teams
  href: string; // where to reopen it
  home: string;
  away: string;
  minute: number; // the minute at `at`
  at: number; // when that was (ms)
  running: boolean; // whether the minute goes on by itself
  homeGoals: number;
  awayGoals: number;
  lh: string; // expected goals, as typed
  la: string;
  // Share of goals before half time, for the live model; missing on games saved
  // before this existed (0.44, the typical share, is used then).
  firstHalfShare?: number;
  updated: number; // last time anything changed (ms)
}

const STORAGE_KEY = "apostas:live:v1";
// A game is over long before this: what is older is dropped.
const KEEP_MS = 12 * 60 * 60 * 1000;
const MAX_GAMES = 12;

function valid(g: unknown): g is SavedGame {
  const x = g as SavedGame;
  return (
    typeof x === "object" &&
    x !== null &&
    typeof x.key === "string" &&
    typeof x.href === "string" &&
    typeof x.home === "string" &&
    typeof x.away === "string" &&
    Number.isFinite(x.minute) &&
    Number.isFinite(x.at) &&
    typeof x.running === "boolean" &&
    Number.isFinite(x.homeGoals) &&
    Number.isFinite(x.awayGoals) &&
    typeof x.lh === "string" &&
    typeof x.la === "string" &&
    Number.isFinite(x.updated)
  );
}

// Newest first. Storage can be missing or blocked (private window): then nothing is remembered.
export function readAll(now = Date.now()): SavedGame[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter(valid)
      .filter((g) => now - g.updated < KEEP_MS)
      .sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

function writeAll(list: SavedGame[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_GAMES)));
  } catch {
    // Full or blocked: the game just is not remembered.
  }
}

export function readSaved(key: string): SavedGame | null {
  return readAll().find((g) => g.key === key) ?? null;
}

// `at` is when the minute was what it says; left out, it is now.
export function saveGame(game: Omit<SavedGame, "at" | "updated"> & { at?: number }): void {
  const now = Date.now();
  writeAll([{ ...game, at: game.at ?? now, updated: now }, ...readAll(now).filter((g) => g.key !== game.key)]);
}

// The storage text as it is now, "" when there is none or it cannot be read.
export function rawSnapshot(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

// Every game in that text, newest first.
export function gamesFrom(raw: string, now = Date.now()): SavedGame[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list)
      ? list
          .filter(valid)
          .filter((g) => now - g.updated < KEEP_MS)
          .sort((a, b) => b.updated - a.updated)
      : [];
  } catch {
    return [];
  }
}

// A game out of that text, with the minute it is at now.
export function savedFrom(raw: string, key: string | undefined, now = Date.now()): (SavedGame & { minuteNow: number }) | null {
  if (!raw || !key) return null;
  try {
    const list: unknown = JSON.parse(raw);
    const game = Array.isArray(list) ? list.filter(valid).find((g) => g.key === key && now - g.updated < KEEP_MS) : undefined;
    return game ? { ...game, minuteNow: clockMinute(game, now) } : null;
  } catch {
    return null;
  }
}

export function removeGame(key: string): void {
  writeAll(readAll().filter((g) => g.key !== key));
}

export function clearGames(): void {
  writeAll([]);
}

// The minute now: as saved, or moved on by the time gone by if it was running.
export function clockMinute(game: Pick<SavedGame, "minute" | "at" | "running">, now: number): number {
  if (!game.running) return game.minute;
  return Math.min(120, game.minute + Math.max(0, Math.floor((now - game.at) / 60_000)));
}

// A running clock past this many minutes belongs to a game that has ended.
export const OVER_MINUTES = 150;
