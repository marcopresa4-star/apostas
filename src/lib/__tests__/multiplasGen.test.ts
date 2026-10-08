import { describe, it, expect } from "vitest";
import { buildMultiple, familyOf, type PricedLeg } from "../multiplasGen";

const L = (over: Partial<PricedLeg> & { eventId: number; key: string; family: string }): PricedLeg => ({
  date: "2026-10-10",
  time: "18:00",
  league: "pt.1",
  leagueLabel: "Portugal · Primeira Liga",
  home: "Benfica",
  away: "Porto",
  label: over.key,
  p: 0.6,
  fair: 1.67,
  real: 1.8,
  edge: 0.08,
  games: 10,
  voidNote: null,
  ...over,
});

const FAM = {
  result: { on: true, min: null, max: null },
  ou: { on: true, min: null, max: null },
};

describe("familyOf", () => {
  it("maps keys to families", () => {
    expect(familyOf("home")?.id).toBe("result");
    expect(familyOf("over:2.5")?.id).toBe("ou");
    expect(familyOf("ah:home:-1.5")?.id).toBe("ah");
    expect(familyOf("halves:both")?.id).toBe("halves");
    expect(familyOf("whatever")?.id).toBeUndefined();
  });
});

describe("buildMultiple", () => {
  it("takes the best leg per game and top N by edge", () => {
    const legs = [
      L({ eventId: 1, key: "home", family: "result", edge: 0.05, real: 2.0, p: 0.5 }),
      L({ eventId: 1, key: "over:2.5", family: "ou", edge: 0.12, real: 1.9, p: 0.6 }),
      L({ eventId: 2, key: "away", family: "result", edge: 0.08, real: 2.1, p: 0.55 }),
      L({ eventId: 3, key: "home", family: "result", edge: 0.02, real: 1.7, p: 0.6 }),
    ];
    const built = buildMultiple(legs, { families: FAM, legs: 2, minEdge: 0 });
    expect(built.legs.map((l) => l.eventId)).toEqual([1, 2]);
    expect(built.legs[0].key).toBe("over:2.5");
    expect(built.odd).toBeCloseTo(1.9 * 2.1, 9);
    expect(built.p).toBeCloseTo(0.6 * 0.55, 9);
  });

  it("respects per-family odd ranges and min edge", () => {
    const legs = [
      L({ eventId: 1, key: "home", family: "result", edge: 0.2, real: 5.0, p: 0.3 }),
      L({ eventId: 2, key: "over:2.5", family: "ou", edge: 0.01, real: 1.9, p: 0.55 }),
    ];
    const built = buildMultiple(legs, {
      families: { result: { on: true, min: 1.3, max: 3.0 }, ou: { on: true, min: null, max: null } },
      legs: 4,
      minEdge: 0.03,
    });
    expect(built.legs).toEqual([]);
  });

  it("ignores switched-off families", () => {
    const legs = [L({ eventId: 1, key: "home", family: "result", edge: 0.1 })];
    const built = buildMultiple(legs, { families: { result: { on: false, min: null, max: null } }, legs: 4, minEdge: 0 });
    expect(built.legs).toEqual([]);
  });
});

  it("has no leg cap", () => {
    const legs = Array.from({ length: 15 }, (_, i) =>
      L({ eventId: 100 + i, key: "home", family: "result", edge: 0.05, real: 2.0, p: 0.55 })
    );
    const built = buildMultiple(legs, { families: FAM, legs: 15, minEdge: 0 });
    expect(built.legs.length).toBe(15);
  });

describe("buildMultiples", () => {
  it("slices ranked legs into tickets", async () => {
    const { buildMultiples } = await import("../multiplasGen");
    const legs = Array.from({ length: 5 }, (_, i) =>
      L({ eventId: 200 + i, key: "home", family: "result", edge: 0.1 - i * 0.01, real: 2.0, p: 0.55 })
    );
    const out = buildMultiples(legs, { families: FAM, legs: 2, minEdge: 0, tickets: 3 });
    expect(out.length).toBe(3);
    expect(out[0].legs.map((l) => l.eventId)).toEqual([200, 201]);
    expect(out[2].legs.map((l) => l.eventId)).toEqual([204]);
  });
});
