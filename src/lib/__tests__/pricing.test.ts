// Preços justos (fair odds) das linhas de golos e liquidação automática.
//
// Só importa módulos client-safe (puros, sem "server-only" nem next/):
// recommendation.ts (via footballModel.ts, puro), bets.ts e oddsParse.ts.
//
// Convenção de preço da app: fair = (1 - push) / p. Nas linhas de quartos,
// `push` é sempre metade do meio; `p` conta os full wins mais metade do meio
// no caso half-win (over x.75, under x.25) e só os full wins no caso
// half-loss (over x.25, under x.75). O retorno esperado E fecha a 1.00 nos
// dois casos (ver testes half-win/half-loss abaixo).
import { describe, it, expect } from "vitest";
import { predictionFromLambdas, type PlayedMatch } from "../footballModel";
import {
  ahWinPush,
  baseRates,
  candidatesFor,
  matchTotalOver,
  matchTotalPush,
  pickWhy,
  quarterHalfWins,
  recommend,
  teamTotalWinPush,
  type Pick,
} from "../recommendation";
import { tuneFromRows } from "../autoTune";
import { settleWon } from "../bets";
import { oddsKeyFor } from "../oddsParse";

const LH = 1.6;
const LA = 1.2;

// Poisson directa (P(X=k)), matemática independente da convolução usada em
// recommendation.ts (matchTotalOver/matchTotalPush).
function poisDirect(k: number, mu: number): number {
  let p = Math.exp(-mu);
  for (let i = 1; i <= k; i++) p *= mu / i;
  return p;
}

// Soma de Poissons independentes é Poisson: P(total = t) directo.
function totalDirect(t: number, lh: number, la: number): number {
  return poisDirect(t, lh + la);
}

// PRNG determinístico para os matches fictícios (mulberry32).
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Amostra de Poisson (Knuth) com o PRNG dado.
function poisSample(mu: number, rnd: () => number): number {
  const l = Math.exp(-mu);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rnd();
  } while (p > l);
  return k - 1;
}

// ~200 jogos fictícios à volta de lambdas 1.6/1.2, determinísticos.
function fakeMatches(n = 200, seed = 42): PlayedMatch[] {
  const rnd = mulberry32(seed);
  const teams = ["AFC", "BFC", "CFC", "DFC"];
  const out: PlayedMatch[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      date: `2026-01-${String(1 + (i % 28)).padStart(2, "0")}`,
      team1: teams[i % teams.length],
      team2: teams[(i + 1) % teams.length],
      ft: [poisSample(LH, rnd), poisSample(LA, rnd)],
      ht: null,
    });
  }
  return out;
}

// Retorno esperado de 1 unidade de stake numa linha de quartos ao fair F:
//   half-win (over x.75, under x.25): o meio ganha metade e devolve metade;
//   half-loss (over x.25, under x.75): o meio perde metade e devolve metade.
function quarterEV(
  dir: "over" | "under",
  line: number,
  wFull: number,
  hMid: number,
  fair: number
): number {
  const frac = Math.abs(line % 1);
  const halfWin =
    dir === "over" ? Math.abs(frac - 0.75) < 1e-9 : Math.abs(frac - 0.25) < 1e-9;
  return halfWin ? wFull * fair + hMid * ((fair + 1) / 2) : wFull * fair + hMid * 0.5;
}

describe("linhas inteiras: preço justo", () => {
  it("over 3.0 com 1.6/1.2 fecha a E = 1 com fair = (1-push)/win", () => {
    const win = matchTotalOver(LH, LA, 3);
    const push = matchTotalPush(LH, LA, 3);
    const fair = (1 - push) / win;
    expect(fair).toBeCloseTo(2.524, 3);
    // Metade ganha (total > 3 paga fair), o exacto devolve: E = win*fair + push.
    expect(win * fair + push).toBeCloseTo(1, 10);
  });
});

describe("linhas de quartos: preço justo", () => {
  it("over 1.75 do jogo: win ~53%, middle ~24%, fair ~@1.36, E ~1.00", () => {
    const m = Math.round(1.75);
    const fullOver = matchTotalOver(LH, LA, m);
    const middle = matchTotalPush(LH, LA, m);
    expect(fullOver).toBeCloseTo(0.53, 2);
    expect(middle).toBeCloseTo(0.24, 2);
    const p = fullOver + middle / 2;
    const push = middle / 2;
    const fair = (1 - push) / p;
    expect(fair).toBeCloseTo(1.36, 2);
    expect(quarterEV("over", 1.75, fullOver, middle, fair)).toBeCloseTo(1, 10);
  });

  it("equipa over 1.75 com mu 1.6: fair ~@2.52, E ~1.00", () => {
    const { win, push } = teamTotalWinPush(1.6, 2, "over");
    const p = win + push / 2;
    const refund = push / 2;
    const fair = (1 - refund) / p;
    expect(fair).toBeCloseTo(2.52, 2);
    // Half-win no meio (exactamente 2: metade ganha, metade devolve).
    expect(win * fair + push * ((fair + 1) / 2)).toBeCloseTo(1, 10);
  });

  it("under 2.25 do jogo: E ~1.00 (meio half-win)", () => {
    const m = Math.round(2.25);
    const fullOver = matchTotalOver(LH, LA, m);
    const middle = matchTotalPush(LH, LA, m);
    const wUnder = 1 - fullOver - middle;
    const p = wUnder + middle / 2;
    const push = middle / 2;
    const fair = (1 - push) / p;
    // Under 2.25 é under x.25: o meio (exactamente 2) é half-win.
    expect(quarterEV("under", 2.25, wUnder, middle, fair)).toBeCloseTo(1, 10);
  });

  it("half-loss (over x.25): fair = (1-push)/win fecha a E = 1", () => {
    // Over 2.25 com exactamente 2: metade devolve (over 2.0) e metade PERDE
    // (over 2.5). A app conta só os full wins em p e metade do meio em push:
    // fair = (1 - middle/2) / P(T>2), que fecha a 1.
    const fullOver = matchTotalOver(LH, LA, 2);
    const middle = matchTotalPush(LH, LA, 2);
    const p = fullOver;
    const push = middle / 2;
    const fair = (1 - push) / p;
    expect(fair).toBeGreaterThan(1.5);
    expect(quarterEV("over", 2.25, fullOver, middle, fair)).toBeCloseTo(1, 10);
  });

  it("half-loss (under x.75): fair fecha a E = 1", () => {
    // Under 1.75 com exactamente 2: metade PERDE (under 1.5) e metade devolve
    // (under 2.0). Mesma dobra: p conta só P(T<2).
    const fullOver = matchTotalOver(LH, LA, 2);
    const middle = matchTotalPush(LH, LA, 2);
    const wUnder = 1 - fullOver - middle;
    const push = middle / 2;
    const fair = (1 - push) / wUnder;
    expect(quarterEV("under", 1.75, wUnder, middle, fair)).toBeCloseTo(1, 10);
  });
});

describe("candidatesFor/recommend/pickWhy", () => {
  it("candidato over:1.75 com push ~ middle/2 do Poisson e fair ~ fórmula", () => {
    const matches = fakeMatches();
    const prediction = predictionFromLambdas(LH, LA, 0.44, 50, 50);
    const base = baseRates(matches);
    const cands = candidatesFor(prediction, base, "AFC", "BFC", 0.44, matches);
    const cand = cands.find((c) => c.key === "over:1.75");
    expect(cand).toBeDefined();
    if (!cand) throw new Error("candidato over:1.75 em falta");
    // push vem directo do Poisson, sem encolhimento: compara com a conta
    // independente (soma de Poissons) em vez da própria função.
    expect(cand.push ?? NaN).toBeCloseTo(totalDirect(2, LH, LA) / 2, 6);
    // p é encolhido para a taxa da liga (TRUST goals = 0.5): tolerância larga.
    const raw = matchTotalOver(LH, LA, 2) + matchTotalPush(LH, LA, 2) / 2;
    expect(cand.p).toBeCloseTo(raw, 1);
    expect((1 - (cand.push ?? 0)) / cand.p).toBeCloseTo(1.36, 1);
  });

  it("recommend() liga o preço (1-push)/p em todos os picks com push", () => {
    const matches = fakeMatches();
    const prediction = predictionFromLambdas(LH, LA, 0.44, 50, 50);
    const base = baseRates(matches);
    const picks = recommend(prediction, base, "AFC", "BFC", 0.44, matches);
    expect(Array.isArray(picks)).toBe(true);
    for (const pick of picks) {
      const expected =
        pick.push !== undefined && pick.push !== 0 ? (1 - pick.push) / pick.p : 1 / pick.p;
      expect(pick.fairOdd).toBeCloseTo(expected, 12);
    }
  });

  it("pickWhy do over:1.75 explica que metade devolve", () => {
    const matches = fakeMatches();
    const prediction = predictionFromLambdas(LH, LA, 0.44, 50, 50);
    const base = baseRates(matches);
    const cand = candidatesFor(prediction, base, "AFC", "BFC", 0.44, matches).find(
      (c) => c.key === "over:1.75"
    );
    if (!cand) throw new Error("candidato over:1.75 em falta");
    const pick: Pick = {
      group: "goals",
      key: "over:1.75",
      label: "Mais de 1,75 golos",
      p: cand.p,
      base: cand.base,
      push: cand.push,
      fairOdd: (1 - (cand.push ?? 0)) / cand.p,
      minOdd: ((1 - (cand.push ?? 0)) / cand.p) * 1.08,
      won: ([h, a]) => h + a > 2,
    };
    expect(pickWhy(pick, { matches, home: "AFC", away: "BFC", prediction })).toContain(
      "metade devolve"
    );
  });
});

describe("settleWon", () => {
  it("over:2.5 ganha/perde; over:3 anula no total exacto", () => {
    expect(settleWon("over:2.5", [2, 1])).toBe("won");
    expect(settleWon("over:2.5", [1, 0])).toBe("lost");
    expect(settleWon("over:3", [2, 1])).toBe("void");
    expect(settleWon("under:3", [2, 1])).toBe("void");
  });

  it("dnb:home anula no empate", () => {
    expect(settleWon("dnb:home", [1, 1])).toBe("void");
    expect(settleWon("dnb:home", [2, 0])).toBe("won");
    expect(settleWon("dnb:home", [0, 2])).toBe("lost");
  });

  it("to:home:1.5 ganha/perde pelos golos da casa", () => {
    expect(settleWon("to:home:1.5", [2, 0])).toBe("won");
    expect(settleWon("to:home:1.5", [1, 0])).toBe("lost");
  });

  it("linhas de quartos ficam manuais (null)", () => {
    // BUG REAL (ver relatório): over:1.75 devolve "won" em vez de null —
    // o regex do over/under aceita quartos, ao contrário do ah/to/tu que
    // passam por validAsianLine. O valor correcto é null (manual).
    expect(settleWon("over:1.75", [2, 0])).toBeNull();
    expect(settleWon("ah:home:-1.75", [2, 0])).toBeNull();
  });

  it("btts:yes", () => {
    expect(settleWon("btts:yes", [1, 1])).toBe("won");
    expect(settleWon("btts:yes", [1, 0])).toBe("lost");
  });

  it("htover:1.5 liquida com ht e fica manual sem ht", () => {
    expect(settleWon("htover:1.5", [3, 1], { ht: [1, 1] })).toBe("won");
    expect(settleWon("htover:1.5", [0, 0], { ht: [0, 0] })).toBe("lost");
    expect(settleWon("htover:1.5", [3, 1])).toBeNull();
  });
});

describe("oddsKeyFor", () => {
  it("mapeia chaves do modelo para chaves de odds", () => {
    expect(oddsKeyFor("over:1.75", "Benfica", "Porto")).toBe("ou:1.75:over");
    expect(oddsKeyFor("under:2.25", "Benfica", "Porto")).toBe("ou:2.25:under");
    expect(oddsKeyFor("ah:home:-1.5", "Benfica", "Porto")).toBe("ah:-1.5:benfica");
    expect(oddsKeyFor("to:home:1.5", "Benfica", "Porto")).toBeNull();
    expect(oddsKeyFor("home", "Benfica", "Porto")).toBe("ft:home");
  });
});

describe("histerese e edge cases", () => {
  it("matchTotalPush soma ~ P(total = m) directo", () => {
    for (const [lh, la] of [
      [1.6, 1.2],
      [2.3, 0.7],
    ]) {
      for (let m = 0; m <= 6; m++) {
        expect(matchTotalPush(lh, la, m)).toBeCloseTo(totalDirect(m, lh, la), 9);
      }
    }
  });

  it("teamTotalWinPush: win + push <= 1", () => {
    for (const mu of [0.5, 1.6, 2.5]) {
      for (let m = 0; m <= 4; m++) {
        for (const side of ["over", "under"] as const) {
          const { win, push } = teamTotalWinPush(mu, m, side);
          expect(win + push).toBeLessThanOrEqual(1);
          expect(win).toBeGreaterThanOrEqual(0);
          expect(push).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

// Distribuição da diferença de golos (casa - fora), directa e independente
// do diffDist interno: P(D=d) = soma_a P(a;la)·P(a+d;lh).
function diffDirect(d: number, lh: number, la: number): number {
  let p = 0;
  for (let a = 0; a <= 14; a++) p += poisDirect(a, la) * poisDirect(a + d, lh);
  return p;
}

describe("handicap de quartos: preço justo", () => {
  it("casa -1.75 (half-win no 2-0): p conta metade do meio", () => {
    // Metades -2.0 e -1.5: full win com diferença >= 3, meio com d = 2.
    const w = [3, 4, 5, 6, 7, 8].reduce((s, d) => s + diffDirect(d, LH, LA), 0);
    const h = diffDirect(2, LH, LA);
    const { win, push } = ahWinPush(LH, LA, "home", -1.75);
    expect(win).toBeCloseTo(w + h / 2, 6);
    expect(push).toBeCloseTo(h / 2, 6);
    const fair = (1 - push) / win;
    expect(w * fair + h * ((fair + 1) / 2)).toBeCloseTo(1, 6);
  });

  it("casa -1.25 (half-loss no 1-0): p conta só full wins", () => {
    // Metades -1.0 e -1.5: full win com diferença >= 2, meio com d = 1
    // (metade devolve, metade perde).
    const w = [2, 3, 4, 5, 6, 7, 8].reduce((s, d) => s + diffDirect(d, LH, LA), 0);
    const h = diffDirect(1, LH, LA);
    const { win, push } = ahWinPush(LH, LA, "home", -1.25);
    expect(win).toBeCloseTo(w, 6);
    expect(push).toBeCloseTo(h / 2, 6);
    const fair = (1 - push) / win;
    expect(w * fair + h * 0.5).toBeCloseTo(1, 6);
  });

  it("fora +1.25 (half-win ao perder por 1): conta metade do meio", () => {
    // Metades +1.0 e +1.5 sobre (a-h): full win com a-h >= 0, meio com -1
    // (metade ganha, metade devolve). Grelha truncada como o diffDist
    // interno (|diferença| <= 8, golos <= 14).
    let full = 0;
    let mid = 0;
    for (let a = 0; a <= 14; a++) {
      for (let hg = 0; hg <= 14; hg++) {
        if (Math.abs(a - hg) > 8) continue;
        const q = poisDirect(hg, LH) * poisDirect(a, LA);
        if (a - hg >= 0) full += q;
        else if (a - hg === -1) mid += q;
      }
    }
    const { win, push } = ahWinPush(LH, LA, "away", 1.25);
    expect(win).toBeCloseTo(full + mid / 2, 6);
    expect(push).toBeCloseTo(mid / 2, 6);
    const fair = (1 - push) / win;
    expect(full * fair + mid * ((fair + 1) / 2)).toBeCloseTo(1, 6);
  });

  it("quarterHalfWins: over x.75 e under x.25 ganham metade", () => {
    expect(quarterHalfWins(1.75, "over")).toBe(true);
    expect(quarterHalfWins(2.25, "under")).toBe(true);
    expect(quarterHalfWins(2.25, "over")).toBe(false);
    expect(quarterHalfWins(1.75, "under")).toBe(false);
  });
});

describe("quartos da 1.ª parte: preço justo", () => {
  it("over 0.75 HT fecha a E = 1 (half-win com exactamente 1)", () => {
    const pred = predictionFromLambdas(LH, LA, 0.44, 30, 30);
    const w = pred.halfTime.over10;
    const h = pred.halfTime.push10;
    const p = w + h / 2;
    const push = h / 2;
    const fair = (1 - push) / p;
    expect(w * fair + h * ((fair + 1) / 2)).toBeCloseTo(1, 6);
  });

  it("over 1.25 HT fecha a E = 1 (half-loss com exactamente 1)", () => {
    const pred = predictionFromLambdas(LH, LA, 0.44, 30, 30);
    const w = pred.halfTime.over10;
    const h = pred.halfTime.push10;
    const fair = (1 - h / 2) / w;
    expect(w * fair + h * 0.5).toBeCloseTo(1, 6);
  });

  it("candidatesFor com intervalo nos dados inclui htover:0.75 e htunder:1.25", () => {
    const withHt: PlayedMatch[] = fakeMatches(200, 7).map((m, i) => ({
      ...m,
      ht: [Math.min(m.ft[0], i % 3 === 0 ? 1 : 0), 0] as [number, number],
    }));
    const pred = predictionFromLambdas(LH, LA, 0.44, 30, 30);
    const base = baseRates(withHt);
    const cands = candidatesFor(pred, base, "AFC", "BFC", 0.44, withHt);
    const over = cands.find((c) => c.key === "htover:0.75");
    const under = cands.find((c) => c.key === "htunder:1.25");
    if (!over || !under) throw new Error("candidatos HT de quartos em falta");
    // O push não leva pull-back; o p sim (metade para a média da liga).
    expect(over.push).toBeCloseTo(pred.halfTime.push10 / 2, 6);
    const rawOver = pred.halfTime.over10 + pred.halfTime.push10 / 2;
    expect(over.p).toBeCloseTo(over.base + 0.5 * (rawOver - over.base), 6);
    const wUnder = 1 - pred.halfTime.over10 - pred.halfTime.push10;
    const rawUnder = wUnder + pred.halfTime.push10 / 2;
    expect(under.p).toBeCloseTo(under.base + 0.5 * (rawUnder - under.base), 6);
    expect(under.push).toBeCloseTo(pred.halfTime.push10 / 2, 6);
  });

  it("candidatesFor inclui totais de 2.ª parte pré-match (ht2*)", () => {
    const withHt: PlayedMatch[] = fakeMatches(200, 7).map((m, i) => ({
      ...m,
      ht: [Math.min(m.ft[0], i % 3 === 0 ? 1 : 0), 0] as [number, number],
    }));
    const pred = predictionFromLambdas(LH, LA, 0.44, 30, 30);
    const base = baseRates(withHt);
    const cands = candidatesFor(pred, base, "AFC", "BFC", 0.44, withHt);
    const over = cands.find((c) => c.key === "ht2over:0.5");
    const under = cands.find((c) => c.key === "ht2under:0.5");
    const team = cands.find((c) => c.key === "ht2to:home:1.5");
    if (!over || !under || !team) throw new Error("candidatos 2.ª parte em falta");
    // Sem pushes: over + under fecham a 1 antes do pull-back para a base.
    expect(over.p + under.p).toBeCloseTo(over.base + under.base, 9);
    expect(over.p).toBeGreaterThan(0);
    expect(over.p).toBeLessThan(1);
    expect(team.p).toBeGreaterThan(0);
    expect(team.push).toBeUndefined();
  });
});

describe("auto-afinação pela calibração", () => {
  const rows = (n: number, hits: number, p: number, base: number, group = "goals") =>
    Array.from({ length: n }, (_, i) => ({
      pick_group: group,
      p,
      base,
      result: i < hits ? "won" : "lost",
    }));

  it("abaixo de 50 decididas não afina nada", () => {
    const tune = tuneFromRows(rows(10, 5, 0.6, 0.5));
    expect(tune.groups.goals.tuned).toBe(false);
    expect(tune.groups.goals.trustMult).toBe(1);
    expect(tune.groups.goals.marginMult).toBe(1);
  });

  it("família a correr quente encolhe a confiança e pede mais margem", () => {
    // Diz 60%, acontece 50% em 60 casos: lift realizado 0, previsto 0.1.
    const tune = tuneFromRows(rows(60, 30, 0.6, 0.5));
    expect(tune.groups.goals.tuned).toBe(true);
    expect(tune.groups.goals.trustMult).toBeCloseTo(0.3, 6);
    expect(tune.groups.goals.marginMult).toBeCloseTo(1.2, 6);
  });

  it("família calibrada mantém tudo", () => {
    const tune = tuneFromRows(rows(60, 36, 0.6, 0.5));
    expect(tune.groups.goals.tuned).toBe(true);
    expect(tune.groups.goals.trustMult).toBeCloseTo(1, 6);
    expect(tune.groups.goals.marginMult).toBeCloseTo(1, 6);
  });
});
