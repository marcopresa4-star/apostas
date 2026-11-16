// The whole-league table: one snapshot per mapped league, built from the same
// numbers as the single-league profile page. Types and ordering live here so
// the action that fills the cache and the page that reads it agree.
import type { MarketRates } from "./leagueProfile";

export interface LeagueSnapshot {
  code: string;
  label: string;
  season: string;
  games: number;
  at: number; // when this row was read (ms)
  rates: MarketRates;
}

export interface LeagueCompareIndex {
  at: number; // when the table was last completed (ms; 0 while partial)
  total: number; // mapped club leagues
  rows: LeagueSnapshot[];
  missing: { code: string; label: string; error: string }[];
}

export interface CompareBuildResult {
  index: LeagueCompareIndex;
  done: boolean;
  remaining: number;
  total: number;
}

export type CompareSortKey =
  | "over25"
  | "btts"
  | "bothHalves"
  | "perGame"
  | "homeWin"
  | "firstHalfGoal"
  | "over15"
  | "comeback";

export const COMPARE_SORTS: { key: CompareSortKey; label: string; value: (r: MarketRates) => number }[] = [
  { key: "over25", label: "Over 2,5", value: (r) => r.over25 },
  { key: "over15", label: "Over 1,5", value: (r) => r.over15 },
  { key: "btts", label: "Ambas marcam", value: (r) => r.btts },
  { key: "bothHalves", label: "Golo nas 2 partes", value: (r) => r.bothHalves },
  { key: "perGame", label: "Golos por jogo", value: (r) => r.perGame },
  { key: "homeWin", label: "Vitória casa", value: (r) => r.homeWin },
  { key: "firstHalfGoal", label: "Golo na 1.ª parte", value: (r) => r.firstHalfGoal },
  { key: "comeback", label: "Reviravolta", value: (r) => r.comeback },
];

export function compareSort(key: string): CompareSortKey {
  return (COMPARE_SORTS.find((s) => s.key === key)?.key ?? "over25") as CompareSortKey;
}

// Biggest first; leagues with no games go last whatever the key.
export function sortSnapshots(rows: LeagueSnapshot[], key: CompareSortKey): LeagueSnapshot[] {
  const value = COMPARE_SORTS.find((s) => s.key === key)!.value;
  return [...rows].sort((a, b) => {
    if (a.games === 0) return 1;
    if (b.games === 0) return -1;
    return value(b.rates) - value(a.rates);
  });
}
