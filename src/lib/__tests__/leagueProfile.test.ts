import { describe, expect, it } from "vitest";
import {
  calibration,
  favouriteSegments,
  goalBlock,
  goalBlocks,
  marketRates,
  splitChronology,
  type Predictor,
} from "../leagueProfile";
import type { PlayedMatch } from "../footballModel";

const m = (date: string, ft: [number, number], ht: [number, number] | null = null, teams: [string, string] = ["Casa", "Fora"]): PlayedMatch => ({
  date,
  team1: teams[0],
  team2: teams[1],
  ft,
  ht,
});

describe("marketRates", () => {
  it("counts each market over the games played", () => {
    const r = marketRates([
      m("2026-08-01", [2, 1], [1, 0]),
      m("2026-08-02", [0, 0], [0, 0]),
      m("2026-08-03", [1, 1], [0, 1]),
      m("2026-08-04", [3, 0], [2, 0]),
    ]);
    expect(r.games).toBe(4);
    expect(r.goals).toBe(8);
    expect(r.perGame).toBe(2);
    // Totals: 3, 0, 2, 3.
    expect(r.over05).toBe(0.75);
    expect(r.over15).toBe(0.75);
    expect(r.over25).toBe(0.5);
    expect(r.over35).toBe(0);
    expect(r.btts).toBe(0.5);
    // 2-1 and 3-0 (home), 0-0 and 1-1 (draws).
    expect(r.homeWin).toBe(0.5);
    expect(r.draw).toBe(0.5);
    expect(r.awayWin).toBe(0);
    expect(r.homeGoals).toBe(1.5);
    expect(r.awayGoals).toBe(0.5);
  });

  it("uses the games with a half-time score for half-time markets", () => {
    const r = marketRates([
      m("2026-08-01", [1, 1], [1, 0]),
      m("2026-08-02", [2, 0], [0, 0]),
      m("2026-08-03", [1, 0], null),
      m("2026-08-04", [0, 2], [0, 1]),
    ]);
    expect(r.games).toBe(4);
    expect(r.withHt).toBe(3);
    expect(r.firstHalfGoal).toBeCloseTo(2 / 3);
    expect(r.ht00).toBeCloseTo(1 / 3);
    // 1-1 (1-0 at the break: both halves), 2-0 (0-0: only the 2nd),
    // 0-2 (0-1: only the 2nd) -> two of three.
    expect(r.bothHalves).toBeCloseTo(2 / 3);
  });

  it("counts a comeback only when a side behind at the break wins", () => {
    const r = marketRates([
      m("2026-08-01", [2, 1], [0, 1]),
      m("2026-08-02", [0, 2], [1, 0]),
      m("2026-08-03", [1, 1], [0, 1]),
    ]);
    expect(r.comeback).toBeCloseTo(2 / 3);
  });

  it("returns zeroes instead of dividing by zero", () => {
    const r = marketRates([]);
    expect(r.games).toBe(0);
    expect(r.perGame).toBe(0);
    expect(r.btts).toBe(0);
    expect(r.bothHalves).toBe(0);
  });
});

describe("splitChronology", () => {
  it("splits by date, not by input order", () => {
    const segs = splitChronology([
      m("2026-09-03", [3, 0]),
      m("2026-08-01", [0, 0]),
      m("2026-08-02", [0, 0]),
      m("2026-09-04", [3, 0]),
    ]);
    expect(segs.map((s) => s.label)).toEqual(["1.ª metade da época", "2.ª metade da época"]);
    expect(segs[0].rates.games).toBe(2);
    expect(segs[0].rates.over25).toBe(0);
    expect(segs[1].rates.over25).toBe(1);
  });

  it("returns nothing for a single game", () => {
    expect(splitChronology([m("2026-08-01", [1, 0])])).toEqual([]);
  });
});

// A predictor that always says "coin flip" for the 1X2 and 50% for goals.
const flat: Predictor = () => ({ over15: 0.5, over25: 0.5, btts: 0.5, home: 0.5, draw: 0.25, away: 0.25 });

// Half the games 3-0 (over 2,5) and half 0-0 (under), so every market has a
// clean 50% baseline.
const season = (n: number): PlayedMatch[] =>
  Array.from({ length: n }, (_, i) =>
    m(`2026-08-${String((i % 28) + 1).padStart(2, "0")}`, i % 2 === 0 ? [3, 0] : [0, 0], [1, 0])
  );

describe("calibration", () => {
  it("compares the model's average with what happened, per market", () => {
    const rows = calibration(season(40), flat, 20);
    const over25 = rows.find((r) => r.key === "over25")!;
    expect(over25.games).toBe(20);
    expect(over25.model).toBeCloseTo(0.5);
    // Half the games are 2-0 (over) and half 0-0 (under).
    expect(over25.real).toBeCloseTo(0.5);
    // 0.5 either way: (0.5)^2 = 0.25.
    expect(over25.brier).toBeCloseTo(0.25);
  });

  it("keeps the first games out of the sample", () => {
    expect(calibration(season(10), flat, 20)).toEqual([]);
  });

  it("penalises a confident and wrong model", () => {
    const alwaysHome: Predictor = () => ({ over15: 1, over25: 1, btts: 1, home: 1, draw: 0, away: 0 });
    // Every game an away win: the draw never comes and neither does the home win.
    const awayWins: PlayedMatch[] = Array.from({ length: 40 }, (_, i) =>
      m(`2026-08-${String((i % 28) + 1).padStart(2, "0")}`, [0, 1], [0, 1])
    );
    const rows = calibration(awayWins, alwaysHome, 20);
    const draw = rows.find((r) => r.key === "draw")!;
    // Always said 0% for the draw, and it never happened: perfect.
    expect(draw.brier).toBeCloseTo(0);
    const home = rows.find((r) => r.key === "home")!;
    // Always said 100% and it never happened: the worst score.
    expect(home.brier).toBeCloseTo(1);
  });
});

describe("favouriteSegments", () => {
  it("separates clear favourites from even games", () => {
    const clear: Predictor = () => ({ over15: 0.6, over25: 0.6, btts: 0.6, home: 0.8, draw: 0.12, away: 0.08 });
    const segs = favouriteSegments(season(40), clear, 20);
    expect(segs.map((s) => s.label)).toEqual(["Favorito claro (modelo ≥ 55%)"]);
    expect(segs[0].rates.games).toBe(20);
  });
});

describe("goalBlocks", () => {
  it("puts each minute in the right 15' block", () => {
    expect([1, 15, 16, 30, 45, 46, 60, 75, 76, 93].map(goalBlock)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 5, 5]);
  });

  it("counts goals per block and ignores junk minutes", () => {
    expect(goalBlocks([5, 20, 44, 44, 80, Number.NaN, -3])).toEqual([1, 1, 2, 0, 0, 1]);
  });
});
