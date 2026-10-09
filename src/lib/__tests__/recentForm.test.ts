import { describe, it, expect } from "vitest";
import { formAverages, formRows, formTags, resultOf } from "../recentForm";
import type { PlayedMatch } from "../footballModel";

const M = (team1: string, team2: string, h: number, a: number, hh: number | null = null, ha: number | null = null): PlayedMatch => ({
  date: "2026-01-01",
  team1,
  team2,
  ft: [h, a],
  ht: hh !== null && ha !== null ? [hh, ha] : null,
});

describe("formRows", () => {
  it("takes the last 10 played, most recent first, from the team view", () => {
    const ms = [M("A", "B", 2, 0, 1, 0), M("C", "A", 1, 1, 0, 0), M("A", "D", 0, 3, 0, 1)];
    const rows = formRows("A", ms);
    expect(rows.map((r) => r.opp)).toEqual(["D", "C", "B"]);
    expect(rows[0]).toMatchObject({ venue: "H", gf: 0, ga: 3, hg: 0, ag: 3, hh: 0, ha: 1 });
    expect(rows[1]).toMatchObject({ venue: "A", gf: 1, ga: 1 });
  });
  it("only sees played games", () => {
    expect(formRows("Z", [M("A", "B", 2, 0)])).toEqual([]);
  });
});

describe("formTags", () => {
  it("flags comebacks and lost leads only with HT scores", () => {
    expect(formTags({ ...formRows("A", [M("B", "A", 1, 2, 1, 0)])[0] })).toEqual(["Reviravolta"]);
    expect(formTags({ ...formRows("A", [M("A", "B", 1, 1, 1, 0)])[0] })).toEqual(["Vantagem perdida"]);
    expect(formTags({ ...formRows("A", [M("A", "B", 2, 0, 1, 0)])[0] })).toEqual([]);
    expect(resultOf(2, 0)).toBe("V");
    expect(resultOf(1, 1)).toBe("E");
    expect(resultOf(0, 1)).toBe("D");
  });
});

describe("formAverages", () => {
  it("averages over the filtered rows", () => {
    const rows = formRows("A", [M("A", "B", 2, 0), M("C", "A", 1, 1)]);
    expect(formAverages(rows)).toEqual({ scored: 1.5, conceded: 0.5, over: 0 });
    expect(formAverages([])).toBeNull();
  });
});
