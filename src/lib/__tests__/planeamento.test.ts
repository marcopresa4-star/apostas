import { describe, expect, it } from "vitest";
import {
  countIn,
  criterionLabel,
  evaluateCriterion,
  intervalLabel,
  sanitizeTable,
  type LiveCriterion,
  type LiveTableDef,
} from "../planeamento";

const crit = (over: Partial<LiveCriterion> = {}): LiveCriterion => ({
  id: "c1",
  metric: "cantos",
  from: 0,
  to: 45,
  agg: "avg",
  target: 2,
  minPct: 70,
  ...over,
});

describe("planeamento", () => {
  it("labels intervals and criteria", () => {
    expect(intervalLabel(0, 90)).toBe("Jogo");
    expect(intervalLabel(0, 45)).toBe("1ª parte");
    expect(intervalLabel(45, 90)).toBe("2ª parte");
    expect(intervalLabel(30, 45)).toBe("30–45′");
    expect(intervalLabel(75, 90)).toBe("75–90′");
    expect(criterionLabel(crit())).toBe("Cantos 1ª parte: ≥ 2 esperados");
    expect(criterionLabel(crit({ agg: "pct", target: 1, minPct: 70, metric: "amarelos" }))).toBe(
      "Amarelos 1ª parte: 70%+ com 1+"
    );
  });

  it("allows decimal expected averages but keeps % thresholds whole", () => {
    expect(criterionLabel(crit({ metric: "golos", agg: "avg", target: 1.5 }))).toBe(
      "Golos 1ª parte: ≥ 1,5 esperados"
    );
    const clean = sanitizeTable({
      id: "",
      name: "Golos",
      leaguesMode: "all",
      leagues: [],
      sample: "last10",
      venueSplit: false,
      criteria: [
        crit({ metric: "golos", agg: "avg", target: 1.5 }),
        crit({ metric: "golos", agg: "pct", target: 1.5, minPct: 70 }),
      ],
    });
    expect(clean?.criteria[0].target).toBe(1.5);
    expect(clean?.criteria[1].target).toBe(2);
  });

  it("counts minutes per interval", () => {
    expect(countIn([12, 30, 44, 48, 61], 0, 45)).toBe(3);
    expect(countIn([12, 30, 44, 45, 48, 61], 0, 45)).toBe(4); // 45' counts
    expect(countIn([12, 30, 44, 48, 61], 45, 90)).toBe(2);
    expect(countIn([75, 90, 93], 75, 90)).toBe(3); // 90' and 90+3' count
  });

  it("evaluates avg and pct pass rules", () => {
    const counts = [3, 2, 4, 1, 3, 2, 5, 0, 3, 2]; // avg 2.5, 80% >= 2
    const avg = evaluateCriterion(counts, crit({ agg: "avg", target: 2 }));
    expect(avg.avg).toBeCloseTo(2.5);
    expect(avg.pct).toBe(80);
    expect(avg.pass).toBe(true);
    expect(evaluateCriterion(counts, crit({ agg: "avg", target: 3 })).pass).toBe(false);
    expect(evaluateCriterion(counts, crit({ agg: "pct", target: 2, minPct: 70 })).pass).toBe(true);
    expect(evaluateCriterion(counts, crit({ agg: "pct", target: 2, minPct: 90 })).pass).toBe(false);
    expect(evaluateCriterion([], crit()).pass).toBe(false);
  });

  it("snaps corner intervals to halves and rejects empty tables", () => {
    const t: LiveTableDef = {
      id: "",
      name: "  +2 cantos HT  ",
      leaguesMode: "all",
      leagues: [],
      sample: "last10",
      venueSplit: false,
      criteria: [crit({ metric: "cantos", from: 30, to: 45 }), crit({ metric: "golos", from: 60, to: 75, agg: "pct" })],
    };
    const clean = sanitizeTable(t);
    expect(clean?.name).toBe("+2 cantos HT");
    expect(clean?.criteria[0]).toMatchObject({ from: 0, to: 45 });
    expect(clean?.criteria[1]).toMatchObject({ from: 60, to: 75 });
    expect(sanitizeTable({ ...t, name: "   " })).toBeNull();
    expect(sanitizeTable({ ...t, criteria: [] })).toBeNull();
  });
});
