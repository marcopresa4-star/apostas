// Goal markers of the live evolution chart: one per side whose total went
// up between consecutive snapshots (at the later snapshot's minute).
import { describe, it, expect } from "vitest";
import { goalMarkers, type EvoSnap } from "../../components/LiveEvolutionChart";

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
