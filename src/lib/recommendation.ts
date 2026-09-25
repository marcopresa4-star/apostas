import { OVER_LINES, fairOdd, leagueRates, strengthOf, type PlayedMatch, type Prediction } from "./footballModel";

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
// (home -1.5, away +1). Direct Poisson like the halves above.
export function ahWinPush(
  lh: number,
  la: number,
  side: "home" | "away",
  line: number
): { win: number; push: number } {
  const dd = diffDist(lh, la);
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
  const withHt = matches.filter((m) => m.ht !== null);
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
  matches: PlayedMatch[] = []
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
  for (const line of [0.5, 1.5, 2, 2.5, 3, 3.5, 4.5]) {
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
  // (goals family caution). Only with matches behind the league rates, and
  // only .0/.5 lines (quarter lines split stakes — no honest single price).
  if (matches.length > 0) {
    const fmtLine = (line: number): string => `${line > 0 ? "+" : ""}${num(line)}`;
    for (const line of [-1.5, -0.5, 0.5, 1.5]) {
      for (const side of ["home", "away"] as const) {
        const { win, push } = ahWinPush(prediction.lambdaHome, prediction.lambdaAway, side, line);
        const team = side === "home" ? home : away;
        const covered = matches.filter((m) => {
          const d = side === "home" ? m.ft[0] - m.ft[1] : m.ft[1] - m.ft[0];
          return d + line > 0;
        }).length;
        candidates.push({
          group: "goals",
          key: `ah:${side}:${line}`,
          label: `Handicap ${team} ${fmtLine(line)}`,
          p: win,
          base: covered / matches.length,
          push,
          won: ([h, a]) => {
            const d = side === "home" ? h - a : a - h;
            return d + line > 0;
          },
        });
      }
    }
    for (const line of [0.5, 1.5, 2.5]) {
      for (const side of ["home", "away"] as const) {
        const mu = side === "home" ? prediction.lambdaHome : prediction.lambdaAway;
        const team = side === "home" ? home : away;
        for (const dir of ["over", "under"] as const) {
          const { win, push } = teamTotalWinPush(mu, line, dir);
          const got = matches.filter((m) => {
            const g = side === "home" ? m.ft[0] : m.ft[1];
            return dir === "over" ? g > line : g < line;
          }).length;
          candidates.push({
            group: "goals",
            key: dir === "over" ? `to:${side}:${line}` : `tu:${side}:${line}`,
            label: `${team} ${dir === "over" ? "mais" : "menos"} de ${num(line)}`,
            p: dir === "over" ? win : 1 - win - push,
            base: dir === "over" ? got / matches.length : 1 - got / matches.length,
            push,
            won: ([h, a]) => {
              const g = side === "home" ? h : a;
              return dir === "over" ? g > line : g < line;
            },
          });
        }
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

  return candidates.map((c) => ({ ...c, p: c.base + TRUST[c.group] * (c.p - c.base) }));
}

export function recommend(
  prediction: Prediction,
  base: BaseRates,
  home: string,
  away: string,
  firstHalfShare = 0.44,
  matches: PlayedMatch[] = []
): Pick[] {
  const ranked = candidatesFor(prediction, base, home, away, firstHalfShare, matches)
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
    picks.push({
      group: c.group,
      key: c.key,
      label: c.label,
      p: c.p,
      base: c.base,
      push: c.push,
      fairOdd: fair,
      minOdd: fair === Infinity ? Infinity : fair * (1 + VALUE_MARGIN[c.group]),
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
    return `Esperados ${comma(total)} golos no jogo; a média da liga é ${comma(rates.perTeam * 2)}.`;
  }
  if (key === "btts:yes" || key === "btts:no") {
    return `${home}: ${scoring(home)}. ${away}: ${scoring(away)}.`;
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
    return `${team} tem de cobrir ${line.replace(".", ",")} para este jogo, pelos golos esperados.`;
  }
  if (key.startsWith("to:") || key.startsWith("tu:")) {
    const parts = key.split(":");
    const team = parts[1] === "away" ? away : home;
    const line = parts[2] ?? "";
    const dir = key.startsWith("to:") ? "mais" : "menos";
    return `${team}: ${scoring(team)}; precisa de ${dir} de ${line.replace(".", ",")}.`;
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
      (m) => (m.team1 === team || m.team2 === team) && m.ht !== null
    );
    const first = withHt.filter((m) => (m.team1 === team ? m.ht![0] : m.ht![1]) > 0).length;
    const second = withHt.filter((m) => (m.team1 === team ? m.ft[0] - m.ht![0] : m.ft[1] - m.ht![1]) > 0).length;
    const share = withHt.length > 0 ? ` (marca na 1.ª em ${Math.round((first / withHt.length) * 100)}% e na 2.ª em ${Math.round((second / withHt.length) * 100)}% dos jogos com intervalo)` : "";
    return `${team}: esperados ${comma(key === "halves:away" ? a1 : h1)} na 1.ª e ${comma(key === "halves:away" ? a2 : h2)} na 2.ª parte${share}.`;
  }
  return "";
}
