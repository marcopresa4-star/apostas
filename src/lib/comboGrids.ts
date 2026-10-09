import { scoreGrid } from "./footballModel";
import type { PlayedMatch } from "./footballModel";

// Joint result × total-goals grids ("Casa & Mais de 2,5", "X2 & Mais de
// 1,5"...): model chance from the exact-score grid, pp delta vs the league's
// own share over the same games. Client-safe pure functions.
export const COMBO_LINES = [1.5, 2.5, 3.5];

export type ComboRow = "home" | "draw" | "away" | "1x" | "12" | "x2";

export const COMBO_ROWS_1X2: { key: ComboRow; label: string }[] = [
  { key: "home", label: "Casa" },
  { key: "draw", label: "Empate" },
  { key: "away", label: "Fora" },
];

export const COMBO_ROWS_DC: { key: ComboRow; label: string }[] = [
  { key: "1x", label: "1X (Casa ou Empate)" },
  { key: "12", label: "12 (Casa ou Fora)" },
  { key: "x2", label: "X2 (Empate ou Fora)" },
];

const rowHit = (row: ComboRow, h: number, a: number): boolean => {
  switch (row) {
    case "home":
      return h > a;
    case "draw":
      return h === a;
    case "away":
      return a > h;
    case "1x":
      return h >= a;
    case "12":
      return h !== a;
    case "x2":
      return a >= h;
  }
};

export interface ComboCell {
  p: number;
  base: number;
  pp: number;
}

export interface ComboTable {
  rows: { key: ComboRow; label: string; cells: ComboCell[] }[];
}

// One table (row set × over lines) from the lambdas and the league games.
export function comboTable(
  lambdaHome: number,
  lambdaAway: number,
  rows: { key: ComboRow; label: string }[],
  lines: number[],
  matches: PlayedMatch[]
): ComboTable {
  const grid = scoreGrid(lambdaHome, lambdaAway, true);
  const n = matches.length || 1;
  return {
    rows: rows.map((r) => ({
      ...r,
      cells: lines.map((line) => {
        let p = 0;
        for (let h = 0; h < grid.length; h++) {
          for (let a = 0; a < (grid[h] ?? []).length; a++) {
            if (rowHit(r.key, h, a) && h + a > line) p += grid[h][a] ?? 0;
          }
        }
        const base = matches.filter((m) => rowHit(r.key, m.ft[0], m.ft[1]) && m.ft[0] + m.ft[1] > line).length / n;
        return { p, base, pp: (p - base) * 100 };
      }),
    })),
  };
}
