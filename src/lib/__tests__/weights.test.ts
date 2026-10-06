// Model weights (lib/modelWeights.ts): neutral reproduces predict() exactly;
// each slider bends the lambdas in its documented direction.
import { describe, it, expect } from "vitest";
import { predict, type PlayedMatch } from "../footballModel";
import {
  NEUTRAL_WEIGHTS,
  isNeutralW,
  predictWeighted,
  weightsFromParams,
  type WeightsCtx,
} from "../modelWeights";

const matches: PlayedMatch[] = [
  { date: "2026-08-01", team1: "A", team2: "B", ft: [2, 1], ht: [1, 0] },
  { date: "2026-08-08", team1: "C", team2: "A", ft: [0, 1], ht: [0, 0] },
  { date: "2026-08-08", team1: "B", team2: "C", ft: [1, 1], ht: [0, 1] },
  { date: "2026-08-15", team1: "A", team2: "C", ft: [3, 1], ht: [2, 0] },
  { date: "2026-08-15", team1: "B", team2: "D", ft: [0, 2], ht: [0, 1] },
  { date: "2026-08-22", team1: "D", team2: "A", ft: [1, 1], ht: [1, 0] },
  { date: "2026-08-22", team1: "C", team2: "B", ft: [2, 0], ht: [1, 0] },
  { date: "2026-08-29", team1: "A", team2: "D", ft: [1, 0], ht: [0, 0] },
];
const NOW = new Date("2026-09-01T12:00:00");
const CTX: WeightsCtx = { homePos: 2, awayPos: 8, teamCount: 18, h2hHome: 2.5, h2hAway: 0.5, h2hGames: 4 };
const STYLES = { home: 0 as const, away: 0 as const };

describe("neutral weights", () => {
  it("reproduce predict() exactly, with and without ratio", () => {
    for (const ratio of [1, 1.1, 0.9]) {
      const a = predict(matches, "A", "B", NOW, ratio, 0);
      const b = predictWeighted(matches, "A", "B", NOW, ratio, NEUTRAL_WEIGHTS, STYLES, CTX);
      expect(b.lambdaHome).toBeCloseTo(a.lambdaHome, 12);
      expect(b.lambdaAway).toBeCloseTo(a.lambdaAway, 12);
      expect(b.fullTime.home).toBeCloseTo(a.fullTime.home, 12);
      expect(b.bothScore).toBeCloseTo(a.bothScore, 12);
    }
  });
  it("isNeutralW spots non-neutral", () => {
    expect(isNeutralW(NEUTRAL_WEIGHTS, STYLES)).toBe(true);
    expect(isNeutralW({ ...NEUTRAL_WEIGHTS, attack: 60 }, STYLES)).toBe(false);
    expect(isNeutralW(NEUTRAL_WEIGHTS, { home: 1, away: 0 })).toBe(false);
  });
});

describe("slider directions", () => {
  const base = predictWeighted(matches, "A", "B", NOW, 1, NEUTRAL_WEIGHTS, STYLES, CTX);
  const withW = (w: Partial<typeof NEUTRAL_WEIGHTS>) =>
    predictWeighted(matches, "A", "B", NOW, 1, { ...NEUTRAL_WEIGHTS, ...w }, STYLES, CTX);

  it("home advantage scales the home lambda up and the away down", () => {
    const up = withW({ homeAdv: 100 });
    expect(up.lambdaHome).toBeGreaterThan(base.lambdaHome);
    expect(up.lambdaAway).toBeLessThan(base.lambdaAway);
    const down = withW({ homeAdv: 0 });
    expect(down.lambdaHome).toBeLessThan(base.lambdaHome);
  });
  it("historic blend pulls the total towards the league average", () => {
    const leagueAvg = matches.reduce((s, m) => s + m.ft[0] + m.ft[1], 0) / matches.length;
    const blended = withW({ historic: 100 });
    const dBase = Math.abs(base.lambdaHome + base.lambdaAway - leagueAvg);
    const dNew = Math.abs(blended.lambdaHome + blended.lambdaAway - leagueAvg);
    expect(dNew).toBeLessThan(dBase);
  });
  it("standings nudge favours the better-placed home side", () => {
    const up = withW({ standings: 100 });
    expect(up.lambdaHome).toBeGreaterThan(base.lambdaHome);
    expect(up.lambdaAway).toBeLessThan(base.lambdaAway);
  });
  it("h2h blend moves towards the head-to-head averages", () => {
    const up = withW({ h2h: 100 });
    // H2H says A 2.5 - B 0.5: both lambdas move that way vs base.
    expect(Math.abs(up.lambdaHome - 2.5)).toBeLessThan(Math.abs(base.lambdaHome - 2.5));
  });
  it("offensive styles raise both lambdas, defensive lower them", () => {
    const off = predictWeighted(matches, "A", "B", NOW, 1, NEUTRAL_WEIGHTS, { home: 1, away: 1 }, CTX);
    expect(off.lambdaHome).toBeGreaterThan(base.lambdaHome);
    expect(off.lambdaAway).toBeGreaterThan(base.lambdaAway);
    const def = predictWeighted(matches, "A", "B", NOW, 1, NEUTRAL_WEIGHTS, { home: -1, away: -1 }, CTX);
    expect(def.lambdaHome).toBeLessThan(base.lambdaHome);
  });
  it("venue/sot/recency move the lambdas and stay finite", () => {
    for (const w of [{ venue: 100 }, { sot: 0 }, { sot: 100 }, { recency: 0 }, { recency: 100 }, { attack: 0 }, { attack: 100 }]) {
      const p = withW(w);
      expect(Number.isFinite(p.lambdaHome) && p.lambdaHome > 0).toBe(true);
      expect(Number.isFinite(p.lambdaAway) && p.lambdaAway > 0).toBe(true);
      expect(p.fullTime.home + p.fullTime.draw + p.fullTime.away).toBeCloseTo(1, 9);
    }
  });
  it("h2h with no meetings changes nothing", () => {
    const p = predictWeighted(
      matches, "A", "B", NOW, 1, { ...NEUTRAL_WEIGHTS, h2h: 100 }, STYLES,
      { ...CTX, h2hHome: null, h2hAway: null, h2hGames: 0 }
    );
    expect(p.lambdaHome).toBeCloseTo(base.lambdaHome, 12);
  });
});

describe("weightsFromParams", () => {
  it("clamps and defaults, honours legacy forma_local", () => {
    const { weights, styles } = weightsFromParams({ w_ataque: "999", w_casa: "-5", estilo_casa: "ofensivo" });
    expect(weights.attack).toBe(100);
    expect(weights.homeAdv).toBe(0);
    expect(weights.historic).toBe(0);
    expect(styles).toEqual({ home: 1, away: 0 });
    expect(weightsFromParams({ forma_local: "50" }).weights.venue).toBe(50);
    expect(weightsFromParams({ w_local: "25", forma_local: "50" }).weights.venue).toBe(25);
  });
});
