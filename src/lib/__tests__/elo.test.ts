// Club Elo ratings (lib/elo.ts): zero-sum updates, home edge direction,
// one curve point per own game.
import { describe, it, expect } from "vitest";
import { eloCurves } from "../elo";
import type { PlayedMatch } from "../footballModel";

const M = (team1: string, team2: string, ft: [number, number], date: string): PlayedMatch => ({
  date,
  team1,
  team2,
  ft,
  ht: null,
});

describe("eloCurves", () => {
  it("winner gains what the loser loses", () => {
    const pool = [M("A", "B", [2, 0], "2026-08-01")];
    const { home, away } = eloCurves(pool, "A", "B");
    expect(home).toHaveLength(1);
    expect(away).toHaveLength(1);
    expect(home[0].elo).toBeGreaterThan(1500);
    expect(away[0].elo).toBeLessThan(1500);
    expect(home[0].elo - 1500).toBe(1500 - away[0].elo);
  });

  it("home draw loses a little, away draw gains (home edge priced in)", () => {
    const pool = [M("A", "B", [1, 1], "2026-08-01")];
    const { home, away } = eloCurves(pool, "A", "B");
    expect(home[0].elo).toBeLessThan(1500);
    expect(away[0].elo).toBeGreaterThan(1500);
  });

  it("one point per own game, last games only", () => {
    const pool = [
      M("A", "B", [1, 0], "2026-08-01"),
      M("A", "C", [0, 1], "2026-08-08"),
      M("B", "C", [2, 2], "2026-08-15"),
      M("A", "B", [3, 0], "2026-08-22"),
    ];
    const { home, away } = eloCurves(pool, "A", "B", 2);
    expect(home.map((p) => p.date)).toEqual(["2026-08-08", "2026-08-22"]);
    expect(away.map((p) => p.date)).toEqual(["2026-08-15", "2026-08-22"]);
    expect(home[1].elo).toBeGreaterThan(home[0].elo);
  });

  it("unknown team has an empty curve", () => {
    const { home } = eloCurves([M("A", "B", [1, 0], "2026-08-01")], "Z", "B");
    expect(home).toEqual([]);
  });
});
