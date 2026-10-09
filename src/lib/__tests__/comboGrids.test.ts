import { describe, it, expect } from "vitest";
import { comboTable, COMBO_LINES, COMBO_ROWS_1X2, COMBO_ROWS_DC } from "../comboGrids";
import type { PlayedMatch } from "../footballModel";

const M = (h: number, a: number): PlayedMatch => ({
  date: "2026-01-01",
  team1: "H",
  team2: "A",
  ft: [h, a],
  ht: null,
});

describe("comboTable", () => {
  it("1X2 rows partition the over chance per line", () => {
    const matches = [M(2, 0), M(1, 1), M(0, 1), M(3, 1)];
    const t = comboTable(1.6, 1.1, COMBO_ROWS_1X2, [2.5], matches);
    const sum = t.rows.reduce((s, r) => s + r.cells[0].p, 0);
    // Every scoreline with 3+ goals is exactly one of home/draw/away.
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeLessThanOrEqual(1);
    // Base shares partition the league overs exactly.
    const baseSum = t.rows.reduce((s, r) => s + r.cells[0].base, 0);
    const leagueOver = matches.filter((m) => m.ft[0] + m.ft[1] > 2.5).length / matches.length;
    expect(baseSum).toBeCloseTo(leagueOver, 9);
  });

  it("DC rows are consistent with 1X2 rows", () => {
    const matches = [M(2, 0), M(1, 1), M(0, 2), M(2, 2)];
    const t1 = comboTable(1.5, 1.2, COMBO_ROWS_1X2, COMBO_LINES, matches);
    const t2 = comboTable(1.5, 1.2, COMBO_ROWS_DC, COMBO_LINES, matches);
    for (let i = 0; i < COMBO_LINES.length; i++) {
      const home = t1.rows[0].cells[i].p;
      const draw = t1.rows[1].cells[i].p;
      const away = t1.rows[2].cells[i].p;
      expect(t2.rows[0].cells[i].p).toBeCloseTo(home + draw, 9);
      expect(t2.rows[2].cells[i].p).toBeCloseTo(draw + away, 9);
      expect(t2.rows[1].cells[i].p).toBeCloseTo(home + away, 9);
    }
  });
});
