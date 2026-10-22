// Evaluators of the live-monitoring bots (pure functions in bots.ts).
import { describe, it, expect } from "vitest";
import {
  GOALS_NEUTRAL,
  firstHalfShares,
  favStateOk,
  gatesOk,
  goalAvg,
  goalAvgOk,
  goalRulesOk,
  historyShares,
  oddPregameOk,
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
  const bot = { minute_from: 30, minute_to: 90, period: "any" as const, score: "any", goals: GOALS_NEUTRAL };
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

describe("goalRulesOk", () => {
  it("any is neutral even when half goals are unknown", () => {
    expect(goalRulesOk(GOALS_NEUTRAL, { total: 5, diff: 4, fh: null, sh: null })).toBe(true);
  });
  it("total: lt / gte against gols on the pitch", () => {
    const r = { ...GOALS_NEUTRAL, total: "lt" as const, totalV: 3 };
    expect(goalRulesOk(r, { total: 2, diff: 0, fh: 1, sh: 1 })).toBe(true);
    expect(goalRulesOk(r, { total: 3, diff: 0, fh: 1, sh: 2 })).toBe(false);
    const g = { ...GOALS_NEUTRAL, total: "gte" as const, totalV: 2 };
    expect(goalRulesOk(g, { total: 2, diff: 0, fh: 1, sh: 1 })).toBe(true);
    expect(goalRulesOk(g, { total: 1, diff: 0, fh: 1, sh: 0 })).toBe(false);
  });
  it("difference is absolute and holds both losing sides", () => {
    const r = { ...GOALS_NEUTRAL, diff: "lt" as const, diffV: 3 };
    expect(goalRulesOk(r, { total: 3, diff: 3, fh: 1, sh: 2 })).toBe(false);
    expect(goalRulesOk(r, { total: 3, diff: 2, fh: 1, sh: 2 })).toBe(true);
  });
  it("per-half: exact counts; unknown half goals fail closed", () => {
    const r = { ...GOALS_NEUTRAL, fh: "exact" as const, fhV: 1, sh: "exact" as const, shV: 0 };
    expect(goalRulesOk(r, { total: 1, diff: 1, fh: 1, sh: 0 })).toBe(true);
    expect(goalRulesOk(r, { total: 3, diff: 1, fh: 2, sh: 1 })).toBe(false);
    expect(goalRulesOk(r, { total: 1, diff: 1, fh: null, sh: null })).toBe(false);
  });
  it("unknown half goals pass when the half filters are neutral", () => {
    expect(goalRulesOk({ ...GOALS_NEUTRAL, total: "gte" as const, totalV: 2 }, { total: 3, diff: 1, fh: null, sh: null })).toBe(true);
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
  it("first half reads the half-time totals", () => {
    const s = firstHalfShares(pool, "A", 10);
    expect(s.games).toBe(3);
    expect(s.over05).toBeCloseTo(2 / 3, 9);
    expect(s.over15).toBe(0);
  });
});

describe("pregameOk", () => {
  it("home side over 1.5", () => {
    expect(pregameOk({ side: "home", metric: "total_over15", n: 10, pct: 50 }, pool, "A", "B")).toBe(true);
    expect(pregameOk({ side: "home", metric: "total_over15", n: 10, pct: 80 }, pool, "A", "B")).toBe(false);
  });
  it("avgs golos: média da equipa nos últimos jogos (≥/≤, falha sem dados)", () => {
    const avgPool: PlayedMatch[] = [
      M("A", "B", [2, 1], [1, 0], "2026-09-01"),
      M("C", "A", [0, 3], [0, 1], "2026-09-03"),
      M("A", "D", [1, 0], [0, 0], "2026-09-05"),
      M("E", "A", [1, 2], [1, 1], "2026-09-07"),
      M("A", "F", [0, 0], [0, 0], "2026-09-09"),
    ];
    // A: golos no jogo = 2+3+1+2+0 = 1,6 de média; 1ª parte = 0,6; 2ª = 1,0
    expect(goalAvg(avgPool, "A", "total")).toBeCloseTo(1.6, 9);
    expect(goalAvg(avgPool, "A", "fh")).toBeCloseTo(0.6, 9);
    expect(goalAvg(avgPool, "A", "sh")).toBeCloseTo(1.0, 9);
    expect(goalAvgOk({ kind: "avg", side: "home", metric: "goals_total", n: 10, cmp: "gte", v: 1 }, avgPool, "A", "B")).toBe(true);
    expect(goalAvgOk({ kind: "avg", side: "home", metric: "goals_total", n: 10, cmp: "gte", v: 2 }, avgPool, "A", "B")).toBe(false);
    expect(goalAvgOk({ kind: "avg", side: "home", metric: "goals_total", n: 10, cmp: "lte", v: 1.6 }, avgPool, "A", "B")).toBe(true);
    expect(goalAvgOk({ kind: "avg", side: "home", metric: "goals_fh", n: 10, cmp: "gte", v: 0.5 }, avgPool, "A", "B")).toBe(true);
    expect(goalAvgOk({ kind: "avg", side: "home", metric: "goals_sh", n: 10, cmp: "lte", v: 1 }, avgPool, "A", "B")).toBe(true);
    // sem historial → fail closed
    expect(goalAvgOk({ kind: "avg", side: "away", metric: "goals_total", n: 10, cmp: "gte", v: 1 }, avgPool, "A", "Z")).toBe(false);
  });
  it("avg golos por parte precisa de HT em 5 jogos", () => {
    expect(goalAvgOk({ kind: "avg", side: "home", metric: "goals_fh", n: 10, cmp: "gte", v: 0.5 }, pool, "A", "B")).toBe(false);
    const noHt: PlayedMatch[] = [
      M("A", "B", [2, 1], null, "2026-09-01"),
      M("C", "A", [0, 2], null, "2026-09-03"),
      M("A", "D", [1, 0], null, "2026-09-05"),
      M("E", "A", [1, 1], null, "2026-09-07"),
      M("A", "F", [0, 1], null, "2026-09-09"),
    ];
    expect(goalAvgOk({ kind: "avg", side: "home", metric: "goals_fh", n: 10, cmp: "gte", v: 0.5 }, noHt, "A", "B")).toBe(false);
    expect(goalAvgOk({ kind: "avg", side: "home", metric: "goals_total", n: 10, cmp: "gte", v: 1 }, noHt, "A", "B")).toBe(true);
  });
});

describe("oddPregameOk / favStateOk", () => {
  const pre = { home: 1.5, away: 6.0 }; // favorito = casa
  it("favStateOk lê o placar ao vivo do lado favorito", () => {
    expect(favStateOk("winning", "home", 1, 0)).toBe(true);
    expect(favStateOk("winning", "home", 1, 1)).toBe(false);
    expect(favStateOk("drawing", "away", 0, 0)).toBe(true);
    expect(favStateOk("losing", "away", 2, 0)).toBe(true);
    expect(favStateOk("not_winning", "home", 1, 1)).toBe(true);
    expect(favStateOk("not_winning", "home", 2, 0)).toBe(false);
    expect(favStateOk("any", "home", 0, 3)).toBe(true);
  });
  it("limiar aplica-se ao lado escolhido (fav = odd mais baixa)", () => {
    expect(oddPregameOk({ kind: "odd", which: "fav", cmp: "lte", v: 2, favState: "any" }, pre, 0, 0)).toBe(true);
    expect(oddPregameOk({ kind: "odd", which: "fav", cmp: "lte", v: 1.2, favState: "any" }, pre, 0, 0)).toBe(false);
    expect(oddPregameOk({ kind: "odd", which: "home", cmp: "gte", v: 1.5, favState: "any" }, pre, 0, 0)).toBe(true);
    expect(oddPregameOk({ kind: "odd", which: "away", cmp: "lte", v: 2, favState: "any" }, pre, 0, 0)).toBe(false);
  });
  it("estado do favorito conta no resultado", () => {
    expect(oddPregameOk({ kind: "odd", which: "fav", cmp: "lte", v: 2, favState: "winning" }, pre, 1, 0)).toBe(true);
    expect(oddPregameOk({ kind: "odd", which: "fav", cmp: "lte", v: 2, favState: "winning" }, pre, 0, 0)).toBe(false);
    expect(oddPregameOk({ kind: "odd", which: "fav", cmp: "lte", v: 2, favState: "losing" }, pre, 0, 1)).toBe(true);
  });
  it("sem odds pré-jogo o jogo fica de fora (fail closed)", () => {
    expect(oddPregameOk({ kind: "odd", which: "fav", cmp: "lte", v: 2, favState: "any" }, null, 0, 0)).toBe(false);
  });
});

describe("pregameOk (multi-kinds)", () => {
  it("either needs one side, thin second-half history fails", () => {
    expect(pregameOk({ side: "either", metric: "btts", n: 10, pct: 50 }, pool, "A", "B")).toBe(true);
    expect(pregameOk({ side: "home", metric: "sh_over15", n: 10, pct: 10 }, pool, "A", "B")).toBe(false);
    expect(pregameOk({ side: "home", metric: "total_over15", n: 10, pct: 50 }, pool, "Z", "B")).toBe(false);
  });
  it("first-half over needs 5 games with half-time scores", () => {
    const big: PlayedMatch[] = [
      M("X", "B", [2, 1], [1, 0], "2026-08-01"),
      M("C", "X", [1, 1], [0, 1], "2026-08-02"),
      M("X", "D", [0, 0], [0, 0], "2026-08-03"),
      M("E", "X", [3, 2], [2, 0], "2026-08-04"),
      M("X", "F", [1, 0], [1, 0], "2026-08-05"),
      M("G", "X", [0, 0], [0, 0], "2026-08-06"),
    ];
    expect(pregameOk({ side: "home", metric: "fh_over05", n: 10, pct: 60 }, big, "X", "B")).toBe(true);
    expect(pregameOk({ side: "home", metric: "fh_over05", n: 10, pct: 80 }, big, "X", "B")).toBe(false);
    expect(pregameOk({ side: "home", metric: "fh_over05", n: 10, pct: 10 }, pool, "A", "B")).toBe(false);
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
  it("settles 1st-half over from the half-time score", () => {
    expect(settleAlert("fh_over05", 0, 0, 1, 1, 30, 1, 0)).toBe(true);
    expect(settleAlert("fh_over05", 0, 0, 0, 0, 30, 0, 0)).toBe(false);
    expect(settleAlert("fh_over05", 0, 0, 2, 1, 30, null, null)).toBeNull();
    expect(settleAlert("fh_over05", 0, 0, 0, 0, 30)).toBeNull();
  });
  it("judges mais1 against HT when the bot lives in the 1st half", () => {
    // Fired at 25' in a 0-0 game: a first-half bot needs a goal BEFORE the
    // break — 0-0 HT is a miss even if the game goes on to 2-1 final.
    expect(settleAlert("mais1", 0, 0, 2, 1, 25, 0, 0, true)).toBe(false);
    expect(settleAlert("mais1", 0, 0, 2, 1, 25, 1, 0, true)).toBe(true);
    expect(settleAlert("mais1", 0, 0, 1, 0, 25, null, null, true)).toBeNull();
    // Same game, final-horizon bot (period second/full): final decides.
    expect(settleAlert("mais1", 0, 0, 2, 1, 70, 0, 0, false)).toBe(true);
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

describe("statsOk big chances", () => {
  it("passes on total, fails closed when missing", async () => {
    const { statsOk, statOk } = await import("../bots");
    expect(statOk("big_total", 2, { big_total: 3 })).toBe(true);
    expect(statOk("big_total", 4, { big_total: 3 })).toBe(false);
    expect(statOk("big_total", 1, {})).toBe(false);
    expect(statsOk("and", [{ k: "big_total", v: 2 }], { big_total: 2 })).toBe(true);
  });
});
