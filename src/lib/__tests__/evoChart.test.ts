// Goal markers of the live evolution chart: one per side whose total went
// up between consecutive snapshots (at the later snapshot's minute).
import { describe, it, expect } from "vitest";
import { goalMarkers, parseStatRows, type EvoSnap } from "../../components/LiveEvolutionChart";
import { backfillSnaps, mergeSnaps } from "../../lib/useEvoSnapshots";

const S = (minute: number, hg: number, ag: number): EvoSnap => ({
  minute,
  hg,
  ag,
  rh: 0,
  ra: 0,
  stats: {},
  xgH: null,
  xgA: null,
});

describe("goalMarkers", () => {
  it("marks each side's goals at the later minute", () => {
    expect(
      goalMarkers([S(10, 0, 0), S(20, 1, 0), S(30, 1, 1), S(40, 1, 1)])
    ).toEqual([
      { minute: 20, home: true },
      { minute: 30, home: false },
    ]);
  });
  it("marks two goals in the same snapshot", () => {
    expect(goalMarkers([S(10, 0, 0), S(20, 2, 1)])).toEqual([
      { minute: 20, home: true },
      { minute: 20, home: false },
    ]);
  });
  it("no goals, no markers", () => {
    expect(goalMarkers([S(10, 0, 0), S(20, 0, 0)])).toEqual([]);
    expect(goalMarkers([S(10, 0, 0)])).toEqual([]);
  });
});

describe("parseStatRows", () => {
  const rows = [
    { name: "Posse de bola", home: "63%", away: "37%" },
    { name: "Remates", home: 18, away: 13 },
    { name: "Cruzamentos", home: "4/22 (18%)", away: "5/13 (38%)" },
    { name: "Passes", home: 583, away: 350 },
    { name: "Passes certos", home: 512, away: 264 },
    { name: "Foras de jogo", home: 2, away: 1 },
    { name: "Faltas", home: "—", away: 15 },
  ];
  it("splits totals and accuracies, gaps stay null", () => {
    const r = parseStatRows(rows);
    expect(r["Cruzamentos"]).toEqual({ home: 4, away: 5 });
    expect(r["% precisão de cruzamento"].home).toBeCloseTo(0.18, 9);
    expect(r["% precisão de cruzamento"].away).toBeCloseTo(0.38, 9);
    expect(r["% precisão de passe"].home).toBeCloseTo(512 / 583, 9);
    expect(r["Foras de jogo"]).toEqual({ home: 2, away: 1 });
    expect(r["Faltas"]).toEqual({ home: null, away: 15 });
    expect(r["Defesas"]).toEqual({ home: null, away: null });
  });
});

describe("mergeSnaps", () => {
  it("keeps existing minutes (live snapshots win over backfill)", () => {
    const live = [{ ...S(10, 0, 0), stats: { Remates: { home: 5, away: 3 } } }];
    const back = [S(10, 0, 0), S(20, 1, 0)];
    const merged = mergeSnaps(live, back);
    expect(merged.map((s) => s.minute)).toEqual([10, 20]);
    expect(merged[0].stats).toEqual({ Remates: { home: 5, away: 3 } });
  });
});

describe("backfillSnaps", () => {
  it("rebuilds score and xG from minute-stamped data", () => {
    const out = backfillSnaps({
      upToMinute: 3,
      goals: [{ minute: 2, home: true }],
      shots: [
        { minute: 1, home: true, xg: 0.1 },
        { minute: 2, home: false, xg: null },
      ],
      rh: 0,
      ra: 0,
    });
    expect(out.map((s) => s.minute)).toEqual([1, 2, 3]);
    expect(out[1].hg).toBe(1);
    expect(out[0].xgH).toBeCloseTo(0.1, 9);
    expect(out[0].xgA).toBeNull();
    expect(out[2].stats).toEqual({});
  });
});

describe("smoothPath", () => {
  it("draws smooth curves through 3+ points", async () => {
    const { smoothPath } = await import("../../components/CurveChart");
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
    expect(d.startsWith("M0.0,0.0")).toBe(true);
    expect(d).toContain("C");
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 1, y: 2 }])).toBe("M1.0,2.0");
  });
});
