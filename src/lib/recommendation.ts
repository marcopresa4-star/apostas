import { OVER_LINES, fairOdd, leagueRates, strengthOf, type PlayedMatch, type Prediction } from "./footballModel";
import type { AutoTune } from "./autoTune";

// Small Poisson toolkit for the markets the score grids don't spell out
// (handicaps, team totals, halves): same Poisson assumption as the grids.
const factorial = (() => {
  const t = [1];
  for (let k = 1; k <= 16; k++) t[k] = t[k - 1] * k;
  return t;
})();

function poisson(k: number, mu: number): number {
  if (k < 0 || k > 16 || mu <= 0) return k === 0 && mu <= 0 ? 1 : 0;
  return (Math.exp(-mu) * Math.pow(mu, k)) / factorial[k];
}

// P(more than `line` total goals), direct Poisson on the two means: for the
// whole-number lines the model's own over-lines don't exist.
export function matchTotalOver(lh: number, la: number, line: number): number {
  let p = 0;
  for (let t = Math.floor(line) + 1; t <= 16; t++) {
    let pt = 0;
    for (let h = 0; h <= t; h++) pt += poisson(h, lh) * poisson(t - h, la);
    p += pt;
  }
  return p;
}

// P(homeGoals - awayGoals == d) for d in -8..8, joint independent Poissons.
function diffDist(lh: number, la: number): number[] {
  const out: number[] = [];
  for (let d = -8; d <= 8; d++) {
    let p = 0;
    for (let a = 0; a <= 14; a++) p += poisson(a, la) * poisson(a + d, lh);
    out.push(p);
  }
  return out;
}

// Asian handicap from one side's view: P(cover), P(push) for a signed line
// (home -1.5, away +1). Direct Poisson like the halves above. Quarter lines
// split the stake over their two neighbours: the middle goal-difference
// half-wins or half-loses (the view is always the side's own difference).
// Either way half of it comes back, so push counts half the middle — only
// the counted wins differ (full covers plus half the middle on half-win,
// full covers alone on half-loss).
export function ahWinPush(
  lh: number,
  la: number,
  side: "home" | "away",
  line: number
): { win: number; push: number } {
  const dd = diffDist(lh, la);
  const frac = Math.abs(line % 1);
  if (frac === 0.25 || frac === 0.75) {
    let win = 0;
    let halfWin = 0;
    let halfLoss = 0;
    for (let d = -8; d <= 8; d++) {
      const v = side === "home" ? d : -d;
      const w1 = v + (line - 0.25) > 0;
      const w2 = v + (line + 0.25) > 0;
      const tied = v + (line - 0.25) === 0 || v + (line + 0.25) === 0;
      if (w1 && w2) win += dd[d + 8];
      else if (tied) {
        if (w1 || w2) halfWin += dd[d + 8];
        else halfLoss += dd[d + 8];
      }
    }
    const half = halfWin + halfLoss;
    return { win: win + halfWin / 2, push: half / 2 };
  }
  let win = 0;
  let push = 0;
  for (let d = -8; d <= 8; d++) {
    const v = side === "home" ? d + line : -d + line;
    if (v > 0) win += dd[d + 8];
    else if (v === 0) push += dd[d + 8];
  }
  return { win, push };
}

// Team total over/under a line: P(team scores more / fewer), P(exactly).
export function teamTotalWinPush(
  mu: number,
  line: number,
  side: "over" | "under"
): { win: number; push: number } {
  let win = 0;
  let push = 0;
  for (let k = 0; k <= 14; k++) {
    const p = poisson(k, mu);
    if (k === line) push += p;
    else if ((side === "over") === (k > line)) win += p;
  }
  return { win, push };
}

// P(BTTS e mais de 2,5) e P(BTTS ou mais de 2,5): a mesma grelha de
// Dixon-Coles do modelo (footballModel.ts fica intocado — isto espelha-a).
const DC_RHO = -0.08;
export function bttsOver25Probs(lh: number, la: number): { both: number; either: number } {
  const MAX = 10;
  const pois = (k: number, mu: number): number => {
    let p = Math.exp(-mu);
    for (let i = 1; i <= k; i++) p *= mu / i;
    return p;
  };
  const tau = (x: number, y: number): number => {
    if (x === 0 && y === 0) return 1 - lh * la * DC_RHO;
    if (x === 0 && y === 1) return 1 + lh * DC_RHO;
    if (x === 1 && y === 0) return 1 + la * DC_RHO;
    if (x === 1 && y === 1) return 1 - DC_RHO;
    return 1;
  };
  const cell: number[][] = [];
  let total = 0;
  for (let h = 0; h <= MAX; h++) {
    cell[h] = [];
    for (let a = 0; a <= MAX; a++) {
      const p = pois(h, lh) * pois(a, la) * tau(h, a);
      cell[h][a] = p;
      total += p;
    }
  }
  let both = 0;
  let either = 0;
  for (let h = 0; h <= MAX; h++) {
    for (let a = 0; a <= MAX; a++) {
      const p = cell[h][a] / total;
      const btts = h > 0 && a > 0;
      const over = h + a > 2.5;
      if (btts && over) both += p;
      if (btts || over) either += p;
    }
  }
  return { both, either };
}

// Whole match-total lines push on the exact number.
export function matchTotalPush(lh: number, la: number, line: number): number {
  let push = 0;
  for (let t = 0; t <= 16; t++) {
    let pt = 0;
    for (let h = 0; h <= t; h++) pt += poisson(h, lh) * poisson(t - h, la);
    if (t === line) push += pt;
  }
  return push;
}

// A suggestion of what to bet on a game, from the model's numbers.
//
// Without the odds a bookmaker really offers there is no way to say a bet is
// good value, so this does not try to. It looks for the markets where the model
// believes clearly more than what happens in that league in general, and says
// from which odd on each one would pay off (the fair odd plus a margin).
//
// The model was tested on 2025/26: its chances for who wins came out right (it
// said 63%, it happened 65%), but for goals and both-teams-score the games it
// liked most only came off about half way between what it said and the league
// average. So for those markets its chance is pulled that far back towards the
// league rate (TRUST) before anything is ranked or priced.

export type PickGroup = "result" | "goals" | "btts" | "halves";

// How much the model's own chance counts for each kind of market, the rest
// pulled towards the league's own rate (see the note at the top of this file).
// Halves are priced but untested (no backtest with goal minutes), so they get
// the cautious half like goals.
export const TRUST: Record<PickGroup, number> = { result: 1, goals: 0.5, btts: 0.5, halves: 0.5 };

// A bet is only offered if it is not a sure thing that pays nothing (over 0.5
// goals) nor a long shot.
const MIN_P = 0.4;
const MAX_P = 0.77;
// How far above the league's usual rate the chance must be, in points, after
// that pull-back. Below this nothing is suggested.
const MIN_LIFT = 0.04;
// The odd must beat the fair one by this much to be worth it, by market
// family. Results are well calibrated (the model said 63%, it happened 65%),
// so 3% of edge is enough; goals and both-score run hot (said 58,9%,
// happened 55,5%), so they pay 8%. Halves are untested: 8% too.
export const VALUE_MARGIN: Record<PickGroup, number> = { result: 0.03, goals: 0.08, btts: 0.08, halves: 0.08 };

// Asian handicap lines priced everywhere. The handicap itself stays on .0/.5
// lines only; the totals below also price quarter lines (1.25, 1.75...). Whole
// lines push on exact.
export const AH_LINES = [-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2];
// Quarter handicaps (±0.25, ±0.75...): priced like the quarter totals, with
// the middle goal-difference half-won or half-lost (see quarterHalfWins).
export const AH_QUARTER_LINES = [-1.75, -1.25, -0.75, -0.25, 0.25, 0.75, 1.25, 1.75];
export const AH_ALL_LINES = [...AH_LINES, ...AH_QUARTER_LINES].sort((a, b) => a - b);
// Quarter total-goals lines, game and per side: each splits the stake over its
// two neighbours. On a half-win middle (over x.75, under x.25) half the stake
// wins and half comes back; on a half-loss middle (over x.25, under x.75)
// half comes back and half is lost. Either way the refunded half prices as
// push = middle/2 — only the counted wins differ (full wins plus half the
// middle on half-win, full wins alone on half-loss). (1 - push) / p stays
// the honest fair odd in both cases.
export const ASIAN_QUARTERS = [1.25, 1.75, 2.25, 2.75, 3.25, 3.75, 4.25];
export const TEAM_ASIAN_QUARTERS = [0.75, 1.25, 1.75, 2.25, 2.75];
// Whether a quarter line's exact middle half-wins (the other half comes back
// on top) or half-loses (only the half back).
export const quarterHalfWins = (line: number, dir: "over" | "under"): boolean => {
  const frac = Math.abs(line % 1);
  return dir === "over" ? frac === 0.75 : frac === 0.25;
};
// A bet is only suggested when the team with the fewest games in the data has
// at least MIN_GAMES. Tested on 2025/26 (18 leagues), the model beats the
// league's own rates clearly only from SOLID_GAMES up (log-loss gain 0.068,
// against about 0.01 for 5 to 11 games), so below that the estimate is
// flagged as fragile.
export const MIN_GAMES = 5;
export const SOLID_GAMES = 12;
const MAX_PICKS = 3;

export interface Pick {
  group: PickGroup;
  // The candidate kind ("home", "over:2.5", "btts:yes"...): maps a suggestion
  // to the bookmaker's real odd for the profit check.
  key: string;
  label: string;
  p: number; // the model's chance
  base: number; // how often it happens in this league
  push?: number; // chance the stake comes back (draws on DNB, exact ties)
  fairOdd: number; // pays the refund out: (1 - push) / win
  minOdd: number; // the odd from which the bet is worth it
  // Whether it came off, given the final score (home, away).
  won: (ft: [number, number]) => boolean;
}

export interface BaseRates {
  home: number;
  draw: number;
  away: number;
  over: Record<string, number>;
  btts: number;
  // How often each half has goals, over the games WITH half-time scores.
  // Null when fewer than half the games carry them: then halves markets are
  // not suggested (no league rate to pull towards).
  halves: { both: number; home: number; away: number } | null;
}

// How often each thing happens in the league's games.
export function baseRates(matches: PlayedMatch[]): BaseRates {
  const n = matches.length || 1;
  const share = (test: (m: PlayedMatch) => boolean) => matches.filter(test).length / n;
  const over: Record<string, number> = {};
  for (const line of OVER_LINES) over[String(line)] = share((m) => m.ft[0] + m.ft[1] > line);
  const withHt = matches.filter((m) => m.ht !== null && m.ht !== undefined);
  const halves =
    withHt.length >= matches.length / 2 && withHt.length > 0
      ? {
          both: withHt.filter((m) => m.ht![0] + m.ht![1] > 0 && m.ft[0] + m.ft[1] - (m.ht![0] + m.ht![1]) > 0).length / withHt.length,
          home: withHt.filter((m) => m.ht![0] > 0 && m.ft[0] - m.ht![0] > 0).length / withHt.length,
          away: withHt.filter((m) => m.ht![1] > 0 && m.ft[1] - m.ht![1] > 0).length / withHt.length,
        }
      : null;
  return {
    home: share((m) => m.ft[0] > m.ft[1]),
    draw: share((m) => m.ft[0] === m.ft[1]),
    away: share((m) => m.ft[0] < m.ft[1]),
    over,
    btts: share((m) => m.ft[0] > 0 && m.ft[1] > 0),
    halves,
  };
}

const num = (n: number) => n.toFixed(1).replace(".", ",");
// Quarter lines need both decimals ("1,75", not "1,8").
const qnum = (n: number) => n.toFixed(2).replace(".", ",");

// A bet the model can price, with its chance already pulled back towards the
// league's rate for the markets it is less sure about (see TRUST). `push` is
// the chance the stake comes back (draws on DNB, exact ties on whole lines):
// the fair odd pays it out, (1 - push) / win.
export interface Candidate {
  group: PickGroup;
  // What kind of bet it is: "home", "away", "1x", "x2", "btts:yes", "btts:no",
  // "over:2.5", "under:2.5", "halves:both", "halves:home", "dnb:home",
  // "ah:home:-1.5", "to:home:1.5"...
  key: string;
  label: string;
  p: number;
  base: number; // how often it happens in the league
  push?: number;
  // Whether it came off, given the final score (and, for halves markets, the
  // half-time score — without it they cannot be checked).
  won: (score: [number, number], ht?: [number, number] | null) => boolean;
}

export function candidatesFor(
  prediction: Prediction,
  base: BaseRates,
  home: string,
  away: string,
  firstHalfShare = 0.44,
  matches: PlayedMatch[] = [],
  tune?: AutoTune | null
): Candidate[] {
  const ft = prediction.fullTime;
  const candidates: Candidate[] = [
    { group: "result", key: "home", label: `Vitória de ${home}`, p: ft.home, base: base.home, won: ([h, a]) => h > a },
    { group: "result", key: "away", label: `Vitória de ${away}`, p: ft.away, base: base.away, won: ([h, a]) => a > h },
    {
      group: "result",
      key: "1x",
      label: `${home} ou empate (1X)`,
      p: ft.home + ft.draw,
      base: base.home + base.draw,
      won: ([h, a]) => h >= a,
    },
    {
      group: "result",
      key: "x2",
      label: `${away} ou empate (X2)`,
      p: ft.away + ft.draw,
      base: base.away + base.draw,
      won: ([h, a]) => a >= h,
    },
    { group: "btts", key: "btts:yes", label: "Ambas marcam: sim", p: prediction.bothScore, base: base.btts, won: ([h, a]) => h > 0 && a > 0 },
    {
      group: "btts",
      key: "btts:no",
      label: "Ambas marcam: não",
      p: 1 - prediction.bothScore,
      base: 1 - base.btts,
      won: ([h, a]) => !(h > 0 && a > 0),
    },
  ];
  // BTTS combinada com o mais de 2,5 (a combinação que as casas mais vendem):
  // e (as duas) e ou (pelo menos uma). Mesma família das ambas marcam.
  const combo = bttsOver25Probs(prediction.lambdaHome, prediction.lambdaAway);
  const baseBoth =
    matches.length > 0
      ? matches.filter((m) => m.ft[0] > 0 && m.ft[1] > 0 && m.ft[0] + m.ft[1] > 2.5).length / matches.length
      : 0.3;
  const baseEither =
    matches.length > 0
      ? matches.filter((m) => (m.ft[0] > 0 && m.ft[1] > 0) || m.ft[0] + m.ft[1] > 2.5).length / matches.length
      : 0.7;
  candidates.push(
    {
      group: "btts",
      key: "combo:btts-over25",
      label: "Ambas marcam e mais de 2,5",
      p: combo.both,
      base: baseBoth,
      won: ([h, a]) => h > 0 && a > 0 && h + a > 2.5,
    },
    {
      group: "btts",
      key: "combo:btts-or-over25",
      label: "Ambas marcam ou mais de 2,5",
      p: combo.either,
      base: baseEither,
      won: ([h, a]) => (h > 0 && a > 0) || h + a > 2.5,
    }
  );
  for (const line of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]) {
    const over =
      prediction.over[String(line)] ?? matchTotalOver(prediction.lambdaHome, prediction.lambdaAway, line);
    const push = Number.isInteger(line) ? matchTotalPush(prediction.lambdaHome, prediction.lambdaAway, line) : 0;
    const baseOver =
      base.over[String(line)] ??
      (matches.length > 0 ? matches.filter((m) => m.ft[0] + m.ft[1] > line).length / matches.length : 0.5);
    const basePush =
      Number.isInteger(line) && matches.length > 0
        ? matches.filter((m) => m.ft[0] + m.ft[1] === line).length / matches.length
        : 0;
    candidates.push(
      { group: "goals", key: `over:${line}`, label: `Mais de ${num(line)} golos`, p: over, base: baseOver, push, won: ([h, a]) => h + a > line },
      { group: "goals", key: `under:${line}`, label: `Menos de ${num(line)} golos`, p: 1 - over - push, base: 1 - baseOver - basePush, push, won: ([h, a]) => h + a < line }
    );
  }
  // Draw-no-bet: the 1X2 without the draw (pushes on it). Same family as the
  // result, so it never doubles a 1X2 suggestion.
  candidates.push(
    {
      group: "result",
      key: "dnb:home",
      label: `Empate anula: ${home}`,
      p: ft.home / (ft.home + ft.away || 1),
      base: base.home / (base.home + base.away || 1),
      push: ft.draw,
      won: ([h, a]) => h > a,
    },
    {
      group: "result",
      key: "dnb:away",
      label: `Empate anula: ${away}`,
      p: ft.away / (ft.home + ft.away || 1),
      base: base.away / (base.home + base.away || 1),
      push: ft.draw,
      won: ([h, a]) => h < a,
    }
  );
  // Asian handicaps and team totals, priced straight from the Poisson means
  // (goals family caution). Only with matches behind the league rates. The
  // handicap covers .0/.5 lines plus quarter lines (same half-win/half-refund
  // folding as the quarter totals below); team totals also price quarters.
  if (matches.length > 0) {
    const fmtLine = (line: number): string => {
      const sign = line > 0 ? "+" : "";
      const frac = Math.abs(line % 1);
      return frac === 0.25 || frac === 0.75 ? `${sign}${qnum(line)}` : Number.isInteger(line) ? `${sign}${line}` : `${sign}${num(line)}`;
    };
    for (const line of AH_ALL_LINES) {
      for (const side of ["home", "away"] as const) {
        const { win, push } = ahWinPush(prediction.lambdaHome, prediction.lambdaAway, side, line);
        const team = side === "home" ? home : away;
        const covered =
          matches.filter((m) => {
            const d = side === "home" ? m.ft[0] - m.ft[1] : m.ft[1] - m.ft[0];
            return d + (line - 0.25) > 0;
          }).length + matches.filter((m) => {
            const d = side === "home" ? m.ft[0] - m.ft[1] : m.ft[1] - m.ft[0];
            return d + (line + 0.25) > 0;
          }).length;
        candidates.push({
          group: "goals",
          key: `ah:${side}:${line}`,
          label: `Handicap ${team} ${fmtLine(line)}`,
          p: win,
          base: covered / (2 * matches.length),
          push,
          won: ([h, a]) => {
            const d = side === "home" ? h - a : a - h;
            return d + line > 0;
          },
        });
      }
    }
    for (const line of [0.5, 1, 1.5, 2, 2.5]) {
      for (const side of ["home", "away"] as const) {
        const mu = side === "home" ? prediction.lambdaHome : prediction.lambdaAway;
        const team = side === "home" ? home : away;
        for (const dir of ["over", "under"] as const) {
          const { win, push } = teamTotalWinPush(mu, line, dir);
          const got = matches.filter((m) => {
            const g = side === "home" ? m.ft[0] : m.ft[1];
            return dir === "over" ? g > line : g < line;
          }).length;
          // teamTotalWinPush already returns THIS side's win chance (and its
          // base counts THIS side's hits), so both are used directly: 1-win
          // here would price the opposite bet.
          candidates.push({
            group: "goals",
            key: dir === "over" ? `to:${side}:${line}` : `tu:${side}:${line}`,
            label: `${team} ${dir === "over" ? "mais" : "menos"} de ${num(line)}`,
            p: win,
            base: got / matches.length,
            push,
            won: ([h, a]) => {
              const g = side === "home" ? h : a;
              return dir === "over" ? g > line : g < line;
            },
          });
        }
      }
    }
  // Asian quarter totals for the game (1.25, 1.75...): pure Poisson like the
  // whole lines above (the model's grid only holds .5 lines). The league rate
  // is the average of the two neighbours' shares — the empirical version of
  // the same full-wins-plus-half-the-middle count.
  const asianBase = (test: (total: number) => boolean): number =>
    matches.filter((m) => test(m.ft[0] + m.ft[1])).length / matches.length;
  for (const line of ASIAN_QUARTERS) {
    const m = Math.round(line);
    const fullOver = matchTotalOver(prediction.lambdaHome, prediction.lambdaAway, m);
    const middle = matchTotalPush(prediction.lambdaHome, prediction.lambdaAway, m);
    const fullUnder = 1 - fullOver - middle;
    const lo = line - 0.25;
    const hi = line + 0.25;
    const push = middle / 2;
    candidates.push(
      {
        group: "goals",
        key: `over:${line}`,
        label: `Mais de ${qnum(line)} golos`,
        p: quarterHalfWins(line, "over") ? fullOver + push : fullOver,
        base: (asianBase((t) => t > lo) + asianBase((t) => t > hi)) / 2,
        push,
        won: ([h, a]) => h + a > m,
      },
      {
        group: "goals",
        key: `under:${line}`,
        label: `Menos de ${qnum(line)} golos`,
        p: quarterHalfWins(line, "under") ? fullUnder + push : fullUnder,
        base: (asianBase((t) => t < lo) + asianBase((t) => t < hi)) / 2,
        push,
        won: ([h, a]) => h + a < m,
      }
    );
  }
  // Same for each side's own total (0.75 upwards): the win/push split at the
  // middle integer comes straight from the Poisson of its expected goals.
  for (const line of TEAM_ASIAN_QUARTERS) {
    const m = Math.round(line);
    const lo = line - 0.25;
    const hi = line + 0.25;
    for (const side of ["home", "away"] as const) {
      const mu = side === "home" ? prediction.lambdaHome : prediction.lambdaAway;
      const team = side === "home" ? home : away;
      const scored = matches.map((mt) => (side === "home" ? mt.ft[0] : mt.ft[1]));
      const share = (test: (g: number) => boolean): number => scored.filter(test).length / matches.length;
      const o = teamTotalWinPush(mu, m, "over");
      const u = teamTotalWinPush(mu, m, "under");
      candidates.push(
        {
          group: "goals",
          key: `to:${side}:${line}`,
          label: `${team} mais de ${qnum(line)}`,
          p: quarterHalfWins(line, "over") ? o.win + o.push / 2 : o.win,
          base: (share((g) => g > lo) + share((g) => g > hi)) / 2,
          push: o.push / 2,
          won: ([h, a]) => (side === "home" ? h : a) > m,
        },
        {
          group: "goals",
          key: `tu:${side}:${line}`,
          label: `${team} menos de ${qnum(line)}`,
          p: quarterHalfWins(line, "under") ? u.win + u.push / 2 : u.win,
          base: (share((g) => g < lo) + share((g) => g < hi)) / 2,
          push: u.push / 2,
          won: ([h, a]) => (side === "home" ? h : a) < m,
        }
      );
    }
  }
  }
  // Halves markets price the two halves as independent Poisson halves (the
  // same assumption the model's own half-time grid makes): a goal in each
  // half, or one side scoring in both. Untested like goals, same caution.
  if (base.halves) {
    const h1 = prediction.lambdaHome * firstHalfShare;
    const a1 = prediction.lambdaAway * firstHalfShare;
    const h2 = prediction.lambdaHome * (1 - firstHalfShare);
    const a2 = prediction.lambdaAway * (1 - firstHalfShare);
    const some1 = 1 - Math.exp(-(h1 + a1));
    const some2 = 1 - Math.exp(-(h2 + a2));
    candidates.push(
      {
        group: "halves",
        key: "halves:both",
        label: "Golos nas 2 partes",
        p: some1 * some2,
        base: base.halves.both,
        won: ([h, a], ht) => !!ht && ht[0] + ht[1] > 0 && h + a - (ht[0] + ht[1]) > 0,
      },
      {
        group: "halves",
        key: "halves:home",
        label: `${home} marca nas 2 partes`,
        p: (1 - Math.exp(-h1)) * (1 - Math.exp(-h2)),
        base: base.halves.home,
        won: ([h, a], ht) => !!ht && ht[0] > 0 && h - ht[0] > 0,
      },
      {
        group: "halves",
        key: "halves:away",
        label: `${away} marca nas 2 partes`,
        p: (1 - Math.exp(-a1)) * (1 - Math.exp(-a2)),
        base: base.halves.away,
        won: ([h, a], ht) => !!ht && ht[1] > 0 && a - ht[1] > 0,
      }
    );
  }

  // First-half totals (0.5, 1 and 1.5, game and per side): the model's own
  // half-time grid, same caution family as the halves above. Only with
  // half-time scores behind the league rates; whole lines push on the exact
  // number. Without half-time scores there is no league rate to pull towards.
  const withHt = matches.filter((m) => m.ht !== null && m.ht !== undefined);
  if (withHt.length > 0 && withHt.length >= matches.length / 2) {
    const ht = prediction.halfTime;
    const n = withHt.length;
    const totOver = (line: number): number => withHt.filter((m) => m.ht![0] + m.ht![1] > line).length / n;
    const totPush = (line: number): number => withHt.filter((m) => m.ht![0] + m.ht![1] === line).length / n;
    const teamGoals = withHt.flatMap((m) => [m.ht![0], m.ht![1]]);
    const sideOver = (line: number): number => teamGoals.filter((g) => g > line).length / teamGoals.length;
    const sidePush = (line: number): number => teamGoals.filter((g) => g === line).length / teamGoals.length;
    const htName = (line: number): string => (line === 1 ? "1 golo" : `${num(line)} golos`);
    const tot: Record<string, { over: number; push: number }> = {
      "0.5": { over: ht.over05, push: 0 },
      "1": { over: ht.over10, push: ht.push10 },
      "1.5": { over: ht.over15, push: 0 },
    };
    const sideProbs = (isHome: boolean): Record<string, { over: number; push: number }> =>
      isHome
        ? {
            "0.5": { over: ht.homeOver05, push: 0 },
            "1": { over: ht.homeOver10, push: ht.homePush10 },
            "1.5": { over: ht.homeOver15, push: 0 },
          }
        : {
            "0.5": { over: ht.awayOver05, push: 0 },
            "1": { over: ht.awayOver10, push: ht.awayPush10 },
            "1.5": { over: ht.awayOver15, push: 0 },
          };
    for (const line of [0.5, 1, 1.5]) {
      const t = tot[String(line)];
      const basePush = Number.isInteger(line) ? totPush(line) : 0;
      candidates.push(
        {
          group: "halves",
          key: `htover:${line}`,
          label: `Mais de ${htName(line)} (1.ª parte)`,
          p: t.over,
          base: totOver(line),
          push: t.push,
          won: ([h, a], htScore) => !!htScore && htScore[0] + htScore[1] > line,
        },
        {
          group: "halves",
          key: `htunder:${line}`,
          label: `Menos de ${htName(line)} (1.ª parte)`,
          p: 1 - t.over - t.push,
          base: 1 - totOver(line) - basePush,
          push: t.push,
          won: ([h, a], htScore) => !!htScore && htScore[0] + htScore[1] < line,
        }
      );
      for (const side of ["home", "away"] as const) {
        const team = side === "home" ? home : away;
        const s = sideProbs(side === "home")[String(line)];
        const baseSidePush = Number.isInteger(line) ? sidePush(line) : 0;
        candidates.push(
          {
            group: "halves",
            key: `htto:${side}:${line}`,
            label: `${team} mais de ${htName(line)} (1.ª parte)`,
            p: s.over,
            base: sideOver(line),
            push: s.push,
            won: ([h, a], htScore) => {
              if (!htScore) return false;
              const g = side === "home" ? htScore[0] : htScore[1];
              return g > line;
            },
          },
          {
            group: "halves",
            key: `httu:${side}:${line}`,
            label: `${team} menos de ${htName(line)} (1.ª parte)`,
            p: 1 - s.over - s.push,
            base: 1 - sideOver(line) - baseSidePush,
            push: s.push,
            won: ([h, a], htScore) => {
              if (!htScore) return false;
              const g = side === "home" ? htScore[0] : htScore[1];
              return g < line;
            },
          }
        );
      }
    }
    // First-half quarter totals (0.75, 1.25, game and per side): each splits
    // on exactly 1 goal — over 0.75 and under 1.25 half-win there, over 1.25
    // and under 0.75 half-lose (see quarterHalfWins). Same halves caution.
    const htQName = (line: number): string => `${qnum(line)} golos`;
    for (const line of [0.75, 1.25]) {
      const fullOver = ht.over10;
      const middle = ht.push10;
      const fullUnder = 1 - fullOver - middle;
      const push = middle / 2;
      const lo = line - 0.25;
      const hi = line + 0.25;
      candidates.push(
        {
          group: "halves",
          key: `htover:${line}`,
          label: `Mais de ${htQName(line)} (1.ª parte)`,
          p: quarterHalfWins(line, "over") ? fullOver + push : fullOver,
          base: (totOver(lo) + totOver(hi)) / 2,
          push,
          won: ([h, a], htScore) => !!htScore && htScore[0] + htScore[1] > 1,
        },
        {
          group: "halves",
          key: `htunder:${line}`,
          label: `Menos de ${htQName(line)} (1.ª parte)`,
          p: quarterHalfWins(line, "under") ? fullUnder + push : fullUnder,
          base: (withHt.filter((m) => m.ht![0] + m.ht![1] < lo).length / n + withHt.filter((m) => m.ht![0] + m.ht![1] < hi).length / n) / 2,
          push,
          won: ([h, a], htScore) => !!htScore && htScore[0] + htScore[1] < 1,
        }
      );
      for (const side of ["home", "away"] as const) {
        const team = side === "home" ? home : away;
        const g = side === "home"
          ? { over10: ht.homeOver10, push10: ht.homePush10 }
          : { over10: ht.awayOver10, push10: ht.awayPush10 };
        const sFullOver = g.over10;
        const sMiddle = g.push10;
        const sFullUnder = 1 - sFullOver - sMiddle;
        const sPush = sMiddle / 2;
        candidates.push(
          {
            group: "halves",
            key: `htto:${side}:${line}`,
            label: `${team} mais de ${htQName(line)} (1.ª parte)`,
            p: quarterHalfWins(line, "over") ? sFullOver + sPush : sFullOver,
            base: (teamGoals.filter((g) => g > lo).length / teamGoals.length + teamGoals.filter((g) => g > hi).length / teamGoals.length) / 2,
            push: sPush,
            won: ([h, a], htScore) => {
              if (!htScore) return false;
              return (side === "home" ? htScore[0] : htScore[1]) > 1;
            },
          },
          {
            group: "halves",
            key: `httu:${side}:${line}`,
            label: `${team} menos de ${htQName(line)} (1.ª parte)`,
            p: quarterHalfWins(line, "under") ? sFullUnder + sPush : sFullUnder,
            base: (teamGoals.filter((g) => g < lo).length / teamGoals.length + teamGoals.filter((g) => g < hi).length / teamGoals.length) / 2,
            push: sPush,
            won: ([h, a], htScore) => {
              if (!htScore) return false;
              return (side === "home" ? htScore[0] : htScore[1]) < 1;
            },
          }
        );
      }
    }
  }

  // The pull-back towards the league rate, with the self-tuning multiplier
  // when the calibration log has enough decided picks in this family.
  const trustOf = (group: PickGroup): number => TRUST[group] * (tune?.groups[group]?.trustMult ?? 1);
  return candidates.map((c) => ({ ...c, p: c.base + trustOf(c.group) * (c.p - c.base) }));
}

export function recommend(
  prediction: Prediction,
  base: BaseRates,
  home: string,
  away: string,
  firstHalfShare = 0.44,
  matches: PlayedMatch[] = [],
  tune?: AutoTune | null
): Pick[] {
  const ranked = candidatesFor(prediction, base, home, away, firstHalfShare, matches, tune)
    .filter((c) => c.p >= MIN_P && c.p <= MAX_P && c.p - c.base >= MIN_LIFT)
    .sort((a, b) => b.p - b.base - (a.p - a.base));

  // At most one per family, so the suggestions do not just repeat each other
  // (a win and "win or draw" are the same idea).
  const picks: Pick[] = [];
  const used = new Set<PickGroup>();
  for (const c of ranked) {
    if (used.has(c.group)) continue;
    used.add(c.group);
    // With pushes, the fair odd pays the refund out: (1 - push) / win.
    const fair = c.p > 0 ? (c.push ? (1 - c.push) / c.p : fairOdd(c.p)) : Infinity;
    const margin = VALUE_MARGIN[c.group] * (tune?.groups[c.group]?.marginMult ?? 1);
    picks.push({
      group: c.group,
      key: c.key,
      label: c.label,
      p: c.p,
      base: c.base,
      push: c.push,
      fairOdd: fair,
      minOdd: fair === Infinity ? Infinity : fair * (1 + margin),
      won: c.won,
    });
    if (picks.length === MAX_PICKS) break;
  }
  return picks;
}

// One honest sentence for why the model suggests this bet, from the same
// numbers (strengths, recent form, expected goals) — never invented.
export function pickWhy(
  pick: Pick,
  ctx: { matches: PlayedMatch[]; home: string; away: string; prediction: Prediction }
): string {
  const { matches, home, away, prediction } = ctx;
  const now = new Date();
  const rates = leagueRates(matches, now);
  const comma = (n: number) => n.toFixed(1).replace(".", ",");
  const formOf = (team: string): string => {
    const last5 = matches
      .filter((m) => m.team1 === team || m.team2 === team)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
    const w = last5.filter(
      (m) => (m.team1 === team ? m.ft[0] : m.ft[1]) > (m.team1 === team ? m.ft[1] : m.ft[0])
    ).length;
    const d = last5.filter((m) => m.ft[0] === m.ft[1]).length;
    return `${w}V-${d}E-${last5.length - w - d}D nos últimos ${last5.length}`;
  };
  const scoring = (team: string): string => {
    const games = matches.filter((m) => m.team1 === team || m.team2 === team);
    if (games.length === 0) return "sem jogos";
    const gf = games.reduce((s, m) => s + (m.team1 === team ? m.ft[0] : m.ft[1]), 0) / games.length;
    const ga = games.reduce((s, m) => s + (m.team1 === team ? m.ft[1] : m.ft[0]), 0) / games.length;
    return `${comma(gf)} marcados e ${comma(ga)} sofridos por jogo`;
  };
  const key = pick.key;
  if (key === "home" || key === "away" || key === "1x" || key === "x2") {
    const team = key === "away" || key === "x2" ? away : home;
    const s = strengthOf(matches, team, rates, now);
    const scoringSide = key === "away" || key === "x2" ? "fora" : "casa";
    return `${team} ataca ${comma(s.attack)}× a média e defende ${comma(s.defense)}× (${formOf(team)}); conta como ${scoringSide} para este jogo.`;
  }
  if (key.startsWith("over:") || key.startsWith("under:")) {
    const total = prediction.lambdaHome + prediction.lambdaAway;
    const lv = Number(key.split(":")[1]);
    // Quarter lines split on the exact middle: half the stake comes back,
    // and the other half wins (half-win) or is lost (half-loss).
    const frac = Number.isFinite(lv) ? Math.abs(lv % 1) : 0;
    const isQuarter = frac === 0.25 || frac === 0.75;
    const half = !isQuarter
      ? ""
      : quarterHalfWins(lv, key.startsWith("over:") ? "over" : "under")
        ? ` Com exatamente ${Math.round(lv)}, metade devolve.`
        : ` Com exatamente ${Math.round(lv)}, metade perde.`;
    return `Esperados ${comma(total)} golos no jogo; a média da liga é ${comma(rates.perTeam * 2)}.${half}`;
  }
  if (key.startsWith("htover:") || key.startsWith("htunder:")) {
    const line = key.split(":")[1] ?? "";
    const lv = Number(line);
    const fhs = rates.firstHalfShare;
    const htExp = (prediction.lambdaHome + prediction.lambdaAway) * fhs;
    const avgHt = rates.perTeam * 2 * fhs;
    const frac = Number.isFinite(lv) ? Math.abs(lv % 1) : 0;
    const dev =
      line === "1"
        ? " Com exatamente 1 devolve."
        : frac === 0.25 || frac === 0.75
          ? quarterHalfWins(lv, key.startsWith("htover:") ? "over" : "under")
            ? " Com exatamente 1, metade devolve."
            : " Com exatamente 1, metade perde."
          : "";
    return `Esperados ${comma(htExp)} golos na 1.ª parte (média da liga ${comma(avgHt)}).${dev}`;
  }
  if (key.startsWith("htto:") || key.startsWith("httu:")) {
    const parts = key.split(":");
    const team = parts[1] === "away" ? away : home;
    const line = parts[2] ?? "";
    const lv = Number(line);
    const frac = Number.isFinite(lv) ? Math.abs(lv % 1) : 0;
    const dir = key.startsWith("htto:") ? "mais" : "menos";
    const dev =
      line === "1"
        ? " Com exatamente 1 devolve."
        : frac === 0.25 || frac === 0.75
          ? quarterHalfWins(lv, key.startsWith("htto:") ? "over" : "under")
            ? " Com exatamente 1, metade devolve."
            : " Com exatamente 1, metade perde."
          : "";
    return `${team}: ${scoring(team)}; precisa de ${dir} de ${line.replace(".", ",")} na 1.ª parte.${dev}`;
  }
  if (key === "btts:yes" || key === "btts:no") {
    return `${home}: ${scoring(home)}. ${away}: ${scoring(away)}.`;
  }
  if (key === "combo:btts-over25" || key === "combo:btts-or-over25") {
    const total = prediction.lambdaHome + prediction.lambdaAway;
    const conj = key === "combo:btts-over25" ? "as duas" : "pelo menos uma";
    return `Esperados ${comma(total)} golos no jogo; ${home}: ${scoring(home)}. ${away}: ${scoring(away)}. Precisa de ${conj}.`;
  }
  if (key === "dnb:home" || key === "dnb:away") {
    const team = key === "dnb:away" ? away : home;
    const s = strengthOf(matches, team, rates, now);
    return `${team} sem o empate: ataca ${comma(s.attack)}× a média (${formOf(team)}); o empate devolve.`;
  }
  if (key.startsWith("ah:")) {
    const parts = key.split(":");
    const team = parts[1] === "away" ? away : home;
    const line = parts[2] ?? "";
    const lv = Number(line);
    const frac = Number.isFinite(lv) ? Math.abs(lv % 1) : 0;
    // Quarter handicaps split on the exact margin: half the stake comes back,
    // and the other half wins (half-win) or is lost (half-loss).
    // (The view is always the side's own goal difference, home or away.)
    let half = "";
    if (frac === 0.25 || frac === 0.75) {
      const wholeHalf = Number.isInteger(lv + 0.25) ? lv + 0.25 : lv - 0.25;
      const margin = -wholeHalf;
      const wins = (lv > 0) === (frac === 0.25);
      const fate = wins ? "metade devolve" : "metade perde";
      half =
        margin > 0
          ? ` Ganhando por exatamente ${margin}, ${fate}.`
          : margin < 0
            ? ` Perdendo por exatamente ${-margin}, ${fate}.`
            : ` Com empate, ${fate}.`;
    }
    return `${team} tem de cobrir ${line.replace(".", ",")} para este jogo, pelos golos esperados.${half}`;
  }
  if (key.startsWith("to:") || key.startsWith("tu:")) {
    const parts = key.split(":");
    const team = parts[1] === "away" ? away : home;
    const line = parts[2] ?? "";
    const lv = Number(line);
    const frac = Number.isFinite(lv) ? Math.abs(lv % 1) : 0;
    const isQuarter = frac === 0.25 || frac === 0.75;
    const half = !isQuarter
      ? ""
      : quarterHalfWins(lv, key.startsWith("to:") ? "over" : "under")
        ? ` Com exatamente ${Math.round(lv)}, metade devolve.`
        : ` Com exatamente ${Math.round(lv)}, metade perde.`;
    const dir = key.startsWith("to:") ? "mais" : "menos";
    return `${team}: ${scoring(team)}; precisa de ${dir} de ${line.replace(".", ",")}.${half}`;
  }
  if (key === "halves:both" || key === "halves:home" || key === "halves:away") {
    const fhs = rates.firstHalfShare;
    const h1 = prediction.lambdaHome * fhs;
    const a1 = prediction.lambdaAway * fhs;
    const h2 = prediction.lambdaHome * (1 - fhs);
    const a2 = prediction.lambdaAway * (1 - fhs);
    if (key === "halves:both") {
      return `Esperados ${comma(h1 + a1)} golos na 1.ª e ${comma(h2 + a2)} na 2.ª parte.`;
    }
    const team = key === "halves:away" ? away : home;
    const withHt = matches.filter(
      (m) => (m.team1 === team || m.team2 === team) && m.ht !== null && m.ht !== undefined
    );
    const first = withHt.filter((m) => (m.team1 === team ? m.ht![0] : m.ht![1]) > 0).length;
    const second = withHt.filter((m) => (m.team1 === team ? m.ft[0] - m.ht![0] : m.ft[1] - m.ht![1]) > 0).length;
    const share = withHt.length > 0 ? ` (marca na 1.ª em ${Math.round((first / withHt.length) * 100)}% e na 2.ª em ${Math.round((second / withHt.length) * 100)}% dos jogos com intervalo)` : "";
    return `${team}: esperados ${comma(key === "halves:away" ? a1 : h1)} na 1.ª e ${comma(key === "halves:away" ? a2 : h2)} na 2.ª parte${share}.`;
  }
  return "";
}
