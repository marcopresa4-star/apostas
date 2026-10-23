// SofaScore score fields: `current` includes the penalty shootout, so match
// markets and the model read the regulation score instead.
import { describe, it, expect } from "vitest";
import { displayGoals, isShootout, matchGoals } from "../sofascore";

// Flamengo–Estudiantes, Libertadores semi-final: 0-0 after 90', 2-3 pens.
const shootout = { current: 2, display: 0, period1: 0, period2: 0, normaltime: 0, penalties: 2 };

describe("matchGoals", () => {
  it("reads regulation time on a finished shootout", () => {
    expect(matchGoals(shootout, true)).toBe(0);
    expect(matchGoals({ ...shootout, current: 3, penalties: 3 }, true)).toBe(0);
  });

  it("keeps live scores moving", () => {
    expect(matchGoals({ current: 2, display: 2, normaltime: 1 }, false)).toBe(2);
    expect(matchGoals({ display: 1 }, false)).toBe(1);
  });

  it("drops extra time from a finished match", () => {
    expect(matchGoals({ current: 2, display: 2, normaltime: 1 }, true)).toBe(1);
  });

  it("falls back when normaltime is missing", () => {
    expect(matchGoals({ current: 2, display: 1 }, true)).toBe(1);
    expect(matchGoals({ current: 2 }, true)).toBe(2);
    expect(matchGoals({}, true)).toBeNull();
  });
});

describe("displayGoals", () => {
  it("keeps extra time but drops the shootout", () => {
    expect(displayGoals(shootout, true)).toBe(0);
    expect(displayGoals({ current: 2, display: 2, normaltime: 1 }, true)).toBe(2);
  });

  it("uses the live score while the game runs", () => {
    expect(displayGoals({ current: 1, display: 1, normaltime: 0 }, false)).toBe(1);
  });
});

describe("isShootout", () => {
  it("spots the status text and the penalties field", () => {
    expect(isShootout({ description: "Penalties" }, { current: 0 }, { current: 0 })).toBe(true);
    expect(isShootout({ description: "2nd half" }, shootout)).toBe(true);
    expect(isShootout({ description: "2nd half" }, { current: 1 }, { current: 0 })).toBe(false);
    // A zeroed field alone is not a shootout (it must not freeze live scores).
    expect(isShootout({ description: "2nd half" }, { current: 1, penalties: 0 })).toBe(false);
  });
});
