// xG / L15 / L15' from the shotmap (pure functions in livePressure.ts).
import { describe, it, expect } from "vitest";
import { l15Reading, pressureSummary, type PressureShot } from "../livePressure";

const shot = (minute: number, home: boolean, xg: number | null): PressureShot => ({ minute, home, xg });

describe("pressureSummary", () => {
  it("is silent without a shotmap", () => {
    expect(pressureSummary([], 60)).toBeNull();
  });

  it("sums xG and reads the last 15 minutes", () => {
    const shots = [
      shot(10, true, 0.1),
      shot(30, true, 0.2),
      shot(50, true, 0.3),
      shot(55, false, 0.4),
      shot(58, false, 0.5),
    ];
    const p = pressureSummary(shots, 60)!;
    expect(p.hasXg).toBe(true);
    expect(p.window).toBe(15);
    expect(p.home.xg).toBeCloseTo(0.6);
    expect(p.away.xg).toBeCloseTo(0.9);
    // Only the 50' shot is inside the 45'–60' window.
    expect(p.home.l15).toBeCloseTo(0.3);
    expect(p.home.shots15).toBe(1);
    expect(p.away.l15).toBeCloseTo(0.9);
    expect(p.away.shots15).toBe(2);
    // Projection: recent rate shrunk to the game's average with a 5' prior.
    expect(p.home.l15p).toBeCloseTo(((0.3 + (0.6 / 60) * 5) / 20) * 15);
    expect(p.away.l15p).toBeCloseTo(((0.9 + (0.9 / 60) * 5) / 20) * 15);
  });

  it("falls back to shot counts when the shotmap has no xG", () => {
    const shots = [shot(8, true, null), shot(12, true, null), shot(20, false, null)];
    const p = pressureSummary(shots, 25)!;
    expect(p.hasXg).toBe(false);
    expect(p.home.xg).toBeNull();
    expect(p.home.l15).toBe(1); // the 12' shot; 10' starts the window
    expect(p.home.shots15).toBe(1);
    expect(p.away.l15).toBe(1);
    expect(p.home.l15p).toBeCloseTo(((1 + (2 / 25) * 5) / 20) * 15);
  });

  it("has no projection before 5 minutes are played", () => {
    const p = pressureSummary([shot(2, true, 0.2)], 4)!;
    expect(p.home.l15).toBeCloseTo(0.2);
    expect(p.home.l15p).toBeNull();
  });

  it("uses the last shot when the clock is missing", () => {
    const p = pressureSummary([shot(10, true, null), shot(30, false, null)], null)!;
    expect(p.minute).toBe(30);
    expect(p.window).toBe(15);
    expect(p.home.l15).toBe(0); // shots up to 30', window starts at 15'
    expect(p.away.l15).toBe(1);
    expect(p.away.shots).toBe(1);
  });

  it("ignores shots after the live minute (stale/extra time rows)", () => {
    const p = pressureSummary([shot(40, true, 0.1), shot(80, false, 0.3)], 45)!;
    expect(p.away.xg).toBe(0);
    expect(p.away.shots).toBe(0);
  });
});

describe("l15Reading", () => {
  it("reads both projections together", () => {
    expect(l15Reading(0.5, 0.95, "Casa", "Fora")).toBe("jogo aberto");
    expect(l15Reading(0.07, 0.9, "Casa", "Fora")).toBe("sentido único (Fora)");
    expect(l15Reading(0.9, 0.07, "Casa", "Fora")).toBe("sentido único (Casa)");
    expect(l15Reading(0.05, 0.1, "Casa", "Fora")).toBe("jogo fechado");
    expect(l15Reading(0.2, 0.25, "Casa", "Fora")).toBe("equilibrado");
  });

  it("is silent without both projections", () => {
    expect(l15Reading(0.4, null, "Casa", "Fora")).toBeNull();
  });
});
