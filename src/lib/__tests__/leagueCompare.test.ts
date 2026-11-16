import { describe, expect, it } from "vitest";
import { compareSort, sortSnapshots, type LeagueSnapshot } from "../leagueCompare";
import { marketRates } from "../leagueProfile";
import type { PlayedMatch } from "../footballModel";

const snapshot = (code: string, label: string, games: number, over25: number): LeagueSnapshot => ({
  code,
  label,
  season: "26/27",
  games,
  at: 0,
  rates: { ...marketRates([]), games, over25 },
});

describe("compareSort", () => {
  it("falls back to Over 2,5 for unknown keys", () => {
    expect(compareSort("")).toBe("over25");
    expect(compareSort("btts")).toBe("btts");
  });
});

describe("sortSnapshots", () => {
  const rows = [snapshot("a", "Alfa", 10, 0.4), snapshot("b", "Beta", 10, 0.6), snapshot("c", "Gama", 0, 0)];

  it("puts the biggest value first", () => {
    expect(sortSnapshots(rows, "over25").map((r) => r.code)).toEqual(["b", "a", "c"]);
  });

  it("keeps empty leagues at the bottom even when they lead the key", () => {
    const withEmptyLeader = [...rows, snapshot("d", "Delta", 0, 1)];
    expect(sortSnapshots(withEmptyLeader, "over25").map((r) => r.code)).toEqual(["b", "a", "c", "d"]);
  });

  it("does not mutate the input", () => {
    const copy = rows.map((r) => r.code);
    sortSnapshots(rows, "over25");
    expect(rows.map((r) => r.code)).toEqual(copy);
  });
});

describe("marketRates feeding the comparator", () => {
  it("counts goals per game from real results", () => {
    const matches: PlayedMatch[] = [
      { date: "2026-08-01", team1: "A", team2: "B", ft: [2, 1], ht: [1, 0] },
      { date: "2026-08-02", team1: "C", team2: "D", ft: [0, 0], ht: [0, 0] },
    ];
    expect(marketRates(matches).perGame).toBe(1.5);
  });
});
