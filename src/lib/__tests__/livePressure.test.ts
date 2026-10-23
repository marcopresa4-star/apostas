// xG / L15 / L15' from the shotmap (pure functions in livePressure.ts).
import { describe, it, expect } from "vitest";
import { l15Reading, modelNext15, pressureSummary, type LiveModelContext, type PressureShot } from "../livePressure";
import { predictLive } from "../liveModel";

const shot = (minute: number, home: boolean, xg: number | null): PressureShot => ({ minute, home, xg });
const ctx: LiveModelContext = {
  lambdaHome: 1.5,
  lambdaAway: 1.1,
  firstHalfShare: 0.44,
  homeGoals: 0,
  awayGoals: 0,
  redsHome: 0,
  redsAway: 0,
};

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

  it("uses the live model for L15' when the shotmap has xG", () => {
    const shots = [shot(10, true, 0.1), shot(30, true, 0.2), shot(50, true, 0.3), shot(55, false, 0.4)];
    const p = pressureSummary(shots, 60, { home: 0.8, away: 0.25 })!;
    expect(p.l15pSource).toBe("model");
    expect(p.home.l15p).toBeCloseTo(0.8);
    expect(p.away.l15p).toBeCloseTo(0.25);
    // L15 itself is untouched by the model.
    expect(p.home.l15).toBeCloseTo(0.3);
  });

  it("keeps the rate fallback without xG even when a model is given", () => {
    const shots = [shot(8, true, null), shot(12, true, null), shot(20, false, null)];
    const p = pressureSummary(shots, 25, { home: 0.8, away: 0.2 })!;
    expect(p.l15pSource).toBe("rate");
    expect(p.home.l15p).toBeCloseTo(((1 + (2 / 25) * 5) / 20) * 15);
  });

  it("does not use the model before the projection gate", () => {
    const p = pressureSummary([shot(2, true, 0.2)], 4, { home: 0.8, away: 0.2 })!;
    expect(p.l15pSource).toBe("rate");
    expect(p.home.l15p).toBeNull();
  });

  it("drops L15' after the final whistle, keeping xG and L15", () => {
    const shots = [shot(10, true, 0.1), shot(30, true, 0.2), shot(80, true, 0.3), shot(85, false, 0.4)];
    const live = pressureSummary(shots, 90, { home: 0.8, away: 0.25 })!;
    const done = pressureSummary(shots, 90, { home: 0.8, away: 0.25 }, true)!;
    expect(done.home.l15p).toBeNull();
    expect(done.away.l15p).toBeNull();
    expect(done.home.xg).toBeCloseTo(live.home.xg!);
    expect(done.away.xg).toBeCloseTo(live.away.xg!);
    expect(done.home.l15).toBeCloseTo(live.home.l15!);
    expect(done.away.l15).toBeCloseTo(live.away.l15!);
    expect(l15Reading(done.home.l15p, done.away.l15p, "Casa", "Fora")).toBeNull();
  });
});

describe("modelNext15", () => {
  it("projects the model's remaining xG onto the next 15 minutes", () => {
    const shots = [shot(10, true, 0.3), shot(20, false, 0.2)];
    const next = modelNext15(shots, 30, ctx)!;
    const pred = predictLive({ ...ctx, minute: 30, homeXg: 0.3, awayXg: 0.2 });
    // 60 minutes left, so the next 15 are a quarter of what remains.
    expect(next.home).toBeCloseTo(pred.remainingHome * 0.25);
    expect(next.away).toBeCloseTo(pred.remainingAway * 0.25);
  });

  it("is silent without xG or before the projection gate", () => {
    expect(modelNext15([shot(10, true, null)], 20, ctx)).toBeNull();
    expect(modelNext15([shot(2, true, 0.2)], 4, ctx)).toBeNull();
  });

  it("counts score and reds through the model", () => {
    const shots = [shot(10, true, 0.3), shot(20, false, 0.2)];
    const level = modelNext15(shots, 60, ctx)!;
    const homeAhead = modelNext15(shots, 60, { ...ctx, homeGoals: 2 })!;
    const homeRed = modelNext15(shots, 60, { ...ctx, redsHome: 1 })!;
    expect(homeAhead.home).not.toBeCloseTo(level.home);
    expect(homeRed.home).toBeLessThan(level.home);
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
