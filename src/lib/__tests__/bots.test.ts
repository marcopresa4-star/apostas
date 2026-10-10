// Evaluators of the live-monitoring bots (pure functions in bots.ts).
import { describe, it, expect } from "vitest";
import {
  gatesOk,
  historyShares,
  pregameOk,
  scoreOk,
  secondHalfShares,
  settleAlert,
  statsOk,
} from "../bots";
import type { PlayedMatch } from "../footballModel";

const M = (team1: string, team2: string, ft: [number, number], ht: [number, number] | null, date: string): PlayedMatch => ({
  date,
  team1,
  team2,
  ft,
  ht,
});

describe("scoreOk", () => {
  it("covers every condition", () => {
    expect(scoreOk("any", 0, 3)).toBe(true);
    expect(scoreOk("0-0", 0, 0)).toBe(true);
    expect(scoreOk("0-0", 1, 0)).toBe(false);
    expect(scoreOk("draw", 1, 1)).toBe(true);
    expect(scoreOk("draw", 2, 1)).toBe(false);
    expect(scoreOk("home_ahead", 2, 1)).toBe(true);
    expect(scoreOk("home_ahead", 1, 1)).toBe(false);
    expect(scoreOk("away_ahead", 0, 1)).toBe(true);
    expect(scoreOk("total0", 0, 0)).toBe(true);
    expect(scoreOk("total1", 1, 0)).toBe(true);
    expect(scoreOk("total1", 1, 1)).toBe(false);
    expect(scoreOk("total2plus", 1, 1)).toBe(true);
    expect(scoreOk("total2plus", 1, 0)).toBe(false);
  });
});

describe("gatesOk", () => {
  const bot = { minute_from: 30, minute_to: 90, period: "any" as const, score: "any" };
  it("minute window is mandatory", () => {
    expect(gatesOk(bot, { minute: 29, phase: "live", hg: 0, ag: 0 })).toBe(false);
    expect(gatesOk(bot, { minute: 30, phase: "live", hg: 0, ag: 0 })).toBe(true);
    expect(gatesOk(bot, { minute: 91, phase: "live", hg: 0, ag: 0 })).toBe(false);
  });
  it("period gates", () => {
    expect(gatesOk({ ...bot, period: "first" }, { minute: 35, phase: "live", hg: 0, ag: 0 })).toBe(true);
    expect(gatesOk({ ...bot, period: "first" }, { minute: 60, phase: "live", hg: 0, ag: 0 })).toBe(false);
    expect(gatesOk({ ...bot, period: "second" }, { minute: 60, phase: "live", hg: 0, ag: 0 })).toBe(true);
    expect(gatesOk({ ...bot, period: "half" }, { minute: 45, phase: "halftime", hg: 0, ag: 0 })).toBe(true);
    expect(gatesOk({ ...bot, period: "half" }, { minute: 46, phase: "live", hg: 0, ag: 0 })).toBe(false);
  });
  it("score gate composes", () => {
    expect(gatesOk({ ...bot, score: "0-0" }, { minute: 30, phase: "live", hg: 0, ag: 0 })).toBe(true);
    expect(gatesOk({ ...bot, score: "0-0" }, { minute: 30, phase: "live", hg: 1, ag: 0 })).toBe(false);
  });
});

describe("statsOk", () => {
  it("E needs all, OU needs one, missing stat fails closed", () => {
    const vals = { shots_total: 8, corners_total: 3 };
    expect(statsOk("and", [], vals)).toBe(true);
    expect(statsOk("and", [{ k: "shots_total", v: 6 }], vals)).toBe(true);
    expect(statsOk("and", [{ k: "shots_total", v: 6 }, { k: "corners_total", v: 5 }], vals)).toBe(false);
    expect(statsOk("or", [{ k: "shots_total", v: 6 }, { k: "corners_total", v: 5 }], vals)).toBe(true);
    expect(statsOk("or", [{ k: "corners_total", v: 5 }], vals)).toBe(false);
    expect(statsOk("and", [{ k: "poss_home", v: 50 }], vals)).toBe(false);
  });
});

const pool: PlayedMatch[] = [
  M("A", "B", [2, 1], [1, 0], "2026-08-01"),
  M("C", "A", [0, 3], [0, 1], "2026-08-08"),
  M("A", "D", [1, 1], null, "2026-08-15"),
  M("B", "A", [0, 0], [0, 0], "2026-08-22"),
];

describe("historyShares / secondHalfShares", () => {
  it("counts the side's last n", () => {
    const s = historyShares(pool, "A", 10)!;
    expect(s.total_over15).toBeCloseTo(0.75, 9);
    expect(s.total_over25).toBeCloseTo(0.5, 9);
    expect(s.btts).toBeCloseTo(0.5, 9);
    expect(historyShares(pool, "Z", 10)).toBeNull();
  });
  it("second half needs half-time scores", () => {
    const s = secondHalfShares(pool, "A", 10);
    expect(s.games).toBe(3);
    expect(s.over05).toBeCloseTo(2 / 3, 9);
    expect(s.over15).toBeCloseTo(2 / 3, 9);
  });
});

describe("pregameOk", () => {
  it("home side over 1.5", () => {
    expect(pregameOk({ side: "home", metric: "total_over15", n: 10, pct: 50 }, pool, "A", "B")).toBe(true);
    expect(pregameOk({ side: "home", metric: "total_over15", n: 10, pct: 80 }, pool, "A", "B")).toBe(false);
  });
  it("either needs one side, thin second-half history fails", () => {
    expect(pregameOk({ side: "either", metric: "btts", n: 10, pct: 50 }, pool, "A", "B")).toBe(true);
    expect(pregameOk({ side: "home", metric: "sh_over15", n: 10, pct: 10 }, pool, "A", "B")).toBe(false);
    expect(pregameOk({ side: "home", metric: "total_over15", n: 10, pct: 50 }, pool, "Z", "B")).toBe(false);
  });
});

describe("settleAlert", () => {
  it("settles every market from the final score", () => {
    expect(settleAlert("mais1", 1, 0, 2, 0)).toBe(true);
    expect(settleAlert("mais1", 1, 0, 1, 0)).toBe(false);
    expect(settleAlert("home", 1, 0, 2, 1)).toBe(true);
    expect(settleAlert("home", 1, 0, 1, 1)).toBe(false);
    expect(settleAlert("draw", 0, 0, 1, 1)).toBe(true);
    expect(settleAlert("away", 0, 1, 0, 2)).toBe(true);
    expect(settleAlert("over25", 1, 1, 2, 1)).toBe(true);
    expect(settleAlert("over25", 1, 0, 1, 0)).toBe(false);
    expect(settleAlert("btts", 1, 0, 1, 1)).toBe(true);
    expect(settleAlert("btts", 1, 0, 2, 0)).toBe(false);
  });
  it("settles 2nd-half totals only from the break on", () => {
    expect(settleAlert("sh_over15", 0, 0, 2, 0, 45)).toBe(true);
    expect(settleAlert("sh_over15", 1, 0, 2, 0, 60)).toBe(false);
    expect(settleAlert("sh_over15", 0, 0, 3, 0, 20)).toBeNull();
    expect(settleAlert("sh_over15", 0, 0, 3, 0, null)).toBeNull();
  });
});

describe("snapMinute", () => {
  it("reads tick marks, never ordinals", async () => {
    const { snapMinute } = await import("../bots");
    expect(snapMinute("63'", "live", 0)).toBe(63);
    expect(snapMinute("45+2'", "live", 0)).toBe(47);
    expect(snapMinute("2nd half", "live", 70)).toBe(70);
    expect(snapMinute("1st half", "live", 10)).toBe(10);
    expect(snapMinute("Halftime", "halftime", 0)).toBe(45);
    expect(snapMinute("", "live", 33)).toBe(33);
  });
});
