import type { LivePrediction } from "./liveModel";
import { fairOdd } from "./footballModel";
import { VALUE_MARGIN } from "./recommendation";

// A bet worth looking at in a game in progress, from the live model: the results
// (still to be won, or to be saved) and the goals still to come. The next goal is
// left out on purpose: the data has no minute of the goals, so it cannot be tested.

export type LiveGroup = "result" | "goals" | "btts" | "halves";

export interface LiveCandidate {
  group: LiveGroup;
  // "home", "away", "1x", "x2", "12", "over:<line>", "under:<line>", "btts:yes", "btts:no",
  // "dnb:home", "to:home:<line>", "htover:<line>", "htto:home:<line>"...
  key: string;
  label: string;
  p: number;
  // Chance the stake comes back (draws on DNB, exact ties on whole lines).
  push?: number;
  // Whether it came off, given the final score (and, for 1.ª-parte markets,
  // the half-time score — without it they cannot be checked).
  won: (final: [number, number], ht?: [number, number] | null) => boolean;
}

const dot = (n: number) => n.toFixed(1).replace(".", ",");

export interface HtLineProb {
  over: number;
  under: number;
  // Chance the stake comes back (exact ties on whole lines).
  push: number;
}

// First-half totals including the goals already scored (the caller only uses
// this while the 1st half is ongoing, so every goal so far is a first-half
// goal): P(HT total over/under 0.5, 1 and 1.5) for the game and per side.
// Push only exists on the whole line. Same approximation as the model's own
// HT figures (no zero-inflation, no score effect inside the half).
export function htLiveProbs(
  p: LivePrediction,
  homeGoals: number,
  awayGoals: number
): { total: Record<string, HtLineProb>; home: Record<string, HtLineProb>; away: Record<string, HtLineProb> } {
  const mk = (over: number, push: number): HtLineProb => ({ over, under: Math.max(0, 1 - over - push), push });
  const scored = homeGoals + awayGoals;
  const joint = (test: (i: number, j: number) => boolean): number => {
    let s = 0;
    for (let i = 0; i < p.htHomePmf.length; i++) {
      for (let j = 0; j < p.htAwayPmf.length; j++) {
        if (test(i, j)) s += p.htHomePmf[i] * p.htAwayPmf[j];
      }
    }
    return s;
  };
  const side = (pmf: number[], scoredSide: number): Record<string, HtLineProb> => {
    const out: Record<string, HtLineProb> = {};
    for (const line of [0.5, 1, 1.5]) {
      let over = 0;
      for (let k = 0; k < pmf.length; k++) if (scoredSide + k > line) over += pmf[k];
      const push = Number.isInteger(line) ? (pmf[line - scoredSide] ?? 0) : 0;
      out[String(line)] = mk(over, push);
    }
    return out;
  };
  const total: Record<string, HtLineProb> = {};
  for (const line of [0.5, 1, 1.5]) {
    const over = joint((i, j) => scored + i + j > line);
    const push = Number.isInteger(line) ? joint((i, j) => scored + i + j === line) : 0;
    total[String(line)] = mk(over, push);
  }
  return { total, home: side(p.htHomePmf, homeGoals), away: side(p.htAwayPmf, awayGoals) };
}

export function liveCandidates(
  p: LivePrediction,
  ctx: { home: string; away: string; homeGoals: number; awayGoals: number; minute: number }
): LiveCandidate[] {
  const { home, away, homeGoals, awayGoals, minute } = ctx;
  const total = homeGoals + awayGoals;
  const out: LiveCandidate[] = [
    { group: "result", key: "home", label: `${home} vence`, p: p.fullTime.home, won: (f) => f[0] > f[1] },
    { group: "result", key: "away", label: `${away} vence`, p: p.fullTime.away, won: (f) => f[0] < f[1] },
    { group: "result", key: "1x", label: `${home} ou empate (1X)`, p: p.fullTime.home + p.fullTime.draw, won: (f) => f[0] >= f[1] },
    { group: "result", key: "x2", label: `${away} ou empate (X2)`, p: p.fullTime.away + p.fullTime.draw, won: (f) => f[0] <= f[1] },
    { group: "result", key: "12", label: "Sem empate (12)", p: p.fullTime.home + p.fullTime.away, won: (f) => f[0] !== f[1] },
  ];
  // The lines still open: more than total + 0.5, + 1.5... and less than the same.
  for (let k = 0; k < 4; k++) {
    const line = total + k + 0.5;
    const over = p.over[String(line)];
    if (over === undefined) continue;
    out.push(
      { group: "goals", key: `over:${line}`, label: `Mais de ${dot(line)} golos`, p: over, won: (f) => f[0] + f[1] > line },
      { group: "goals", key: `under:${line}`, label: `Menos de ${dot(line)} golos`, p: 1 - over, won: (f) => f[0] + f[1] < line }
    );
  }
  // Both to score: only while it is still open.
  if (homeGoals === 0 || awayGoals === 0) {
    out.push(
      { group: "btts", key: "btts:yes", label: "Ambas marcam: sim", p: p.bothScore, won: (f) => f[0] > 0 && f[1] > 0 },
      { group: "btts", key: "btts:no", label: "Ambas marcam: não", p: 1 - p.bothScore, won: (f) => !(f[0] > 0 && f[1] > 0) }
    );
  }
  // Draw-no-bet on each side (pushes on the draw): same family as the result.
  const denom = p.fullTime.home + p.fullTime.away;
  if (denom > 0) {
    out.push(
      { group: "result", key: "dnb:home", label: `Empate anula: ${home}`, p: p.fullTime.home / denom, push: p.fullTime.draw, won: (f) => f[0] > f[1] },
      { group: "result", key: "dnb:away", label: `Empate anula: ${away}`, p: p.fullTime.away / denom, push: p.fullTime.draw, won: (f) => f[0] < f[1] }
    );
  }
  // Team totals over the game (absolute lines): tail of each side's own
  // remaining-goals distribution. Lines stay .5, so nothing pushes.
  for (const line of [0.5, 1.5, 2.5]) {
    for (const side of ["home", "away"] as const) {
      const scored = side === "home" ? homeGoals : awayGoals;
      const pmf = side === "home" ? p.homePmf : p.awayPmf;
      const team = side === "home" ? home : away;
      let over = 0;
      for (let i = 0; i < pmf.length; i++) if (scored + i > line) over += pmf[i];
      const under = 1 - over;
      out.push(
        { group: "goals", key: `to:${side}:${line}`, label: `${team} mais de ${dot(line)}`, p: over, won: (f) => (side === "home" ? f[0] : f[1]) > line },
        { group: "goals", key: `tu:${side}:${line}`, label: `${team} menos de ${dot(line)}`, p: under, won: (f) => (side === "home" ? f[0] : f[1]) < line }
      );
    }
  }
  // First-half markets, only while the 1st half is ongoing: totals include
  // the goals already scored (all first-half goals so far). Whole lines push
  // on the exact number. Untested like the model's own HT figures (no
  // score effect inside the half), so they share the goals caution.
  if (minute < 45) {
    const ht = htLiveProbs(p, homeGoals, awayGoals);
    const htLabel = (line: number): string => (line === 1 ? "1 golo" : `${dot(line)} golos`);
    for (const line of [0.5, 1, 1.5]) {
      const t = ht.total[String(line)];
      const push = Number.isInteger(line) && t.push >= 0.005 ? t.push : undefined;
      out.push(
        {
          group: "halves",
          key: `htover:${line}`,
          label: `Mais de ${htLabel(line)} (1.ª parte)`,
          p: t.over,
          ...(push !== undefined ? { push } : {}),
          won: (f, htScore) => !!htScore && htScore[0] + htScore[1] > line,
        },
        {
          group: "halves",
          key: `htunder:${line}`,
          label: `Menos de ${htLabel(line)} (1.ª parte)`,
          p: t.under,
          ...(push !== undefined ? { push } : {}),
          won: (f, htScore) => !!htScore && htScore[0] + htScore[1] < line,
        }
      );
      for (const side of ["home", "away"] as const) {
        const team = side === "home" ? home : away;
        const s = (side === "home" ? ht.home : ht.away)[String(line)];
        const spush = Number.isInteger(line) && s.push >= 0.005 ? s.push : undefined;
        out.push(
          {
            group: "halves",
            key: `htto:${side}:${line}`,
            label: `${team} mais de ${htLabel(line)} (1.ª parte)`,
            p: s.over,
            ...(spush !== undefined ? { push: spush } : {}),
            won: (f, htScore) => {
              if (!htScore) return false;
              const g = side === "home" ? htScore[0] : htScore[1];
              return g > line;
            },
          },
          {
            group: "halves",
            key: `httu:${side}:${line}`,
            label: `${team} menos de ${htLabel(line)} (1.ª parte)`,
            p: s.under,
            ...(spush !== undefined ? { push: spush } : {}),
            won: (f, htScore) => {
              if (!htScore) return false;
              const g = side === "home" ? htScore[0] : htScore[1];
              return g < line;
            },
          }
        );
      }
    }
  }
  return out;
}

// One honest sentence for why the model suggests a live bet, from the same
// numbers (minute, score, what each side still scores) — never invented.
// Short on purpose: it sits under every suggested bet.
export function livePickWhy(
  key: string,
  p: LivePrediction,
  ctx: {
    home: string;
    away: string;
    minute: number;
    homeGoals: number;
    awayGoals: number;
    redsHome: number;
    redsAway: number;
    // Actual xG so far (synced games only) and the pre-match expectation
    // (which embodies each side's form over all its games): the evidence the
    // explanation cites. H2H is deliberately absent — neither model uses it.
    // Shown, like everything else here — never invented, never priced twice
    // (the nudge is already inside the remaining goals above).
    xg?: { home: number; away: number };
    expectedHome?: number;
    expectedAway?: number;
  }
): string {
  const { home, away, minute: m, homeGoals: h, awayGoals: a } = ctx;
  const comma = (n: number) => n.toFixed(1).replace(".", ",");
  const left = m < 90 ? `~${90 - m} min` : "descontos";
  const score = `${h}–${a} aos ${m}'`;
  const rh = p.remainingHome;
  const ra = p.remainingAway;
  const rem = rh + ra;
  const reds = ctx.redsHome + ctx.redsAway > 0 ? " Com menos um em campo (já contado)." : "";
  // Evidence builders: pre-match expectation first, live output so far
  // second, then the condition. Short on purpose: at most two sentences.
  const f2 = (v: number) => v.toFixed(2).replace(".", ",");
  const ritmo = (isHome: boolean): string => {
    const mult = isHome ? (p.formMult?.home ?? 1) : (p.formMult?.away ?? 1);
    return mult > 1.05 ? "acima do ritmo" : mult < 0.95 ? "abaixo do ritmo" : "em ritmo";
  };
  const bits: string[] = [];
  if (ctx.xg && p.formMult) bits.push(`xG ${f2(ctx.xg.home)}–${f2(ctx.xg.away)}`);
  if (ctx.expectedHome !== undefined && ctx.expectedAway !== undefined)
    bits.push(`pré-jogo ${comma(ctx.expectedHome)}–${comma(ctx.expectedAway)}`);
  // ", xG …; pré-jogo …" or "" — spliced into a running sentence.
  const evComma = bits.length > 0 ? `, ${bits.join("; ")}` : "";
  // " (xG …; pré-jogo …)" or "" — standalone parenthetical.
  const evParen = bits.length > 0 ? ` (${bits.join("; ")})` : "";
  // "cria R (xG A, ritmo; pré-jogo E)" — one side's whole story.
  const evSide = (isHome: boolean, rest: number): string => {
    const x = isHome ? ctx.xg?.home : ctx.xg?.away;
    const e = isHome ? ctx.expectedHome : ctx.expectedAway;
    const inner: string[] = [];
    if (x !== undefined && p.formMult) inner.push(`xG ${f2(x)}, ${ritmo(isHome)}`);
    if (e !== undefined) inner.push(`pré-jogo ${comma(e)}`);
    return `cria ${comma(rest)}${inner.length > 0 ? ` (${inner.join("; ")})` : ""}`;
  };
  // First-half markets: only live output (a full-game prior would mislead).
  const htXg = ctx.xg && p.formMult ? `, xG ${f2(ctx.xg.home)}–${f2(ctx.xg.away)}` : "";
  const htXgSide = (isHome: boolean): string => {
    const x = isHome ? ctx.xg?.home : ctx.xg?.away;
    return x !== undefined && p.formMult ? `, xG ${f2(x)}` : "";
  };
  // First-half markets (only suggested while the 1st half is ongoing, so the
  // current score IS the half-time score so far).
  const htht = /^(htover|htunder):(\d+(?:\.\d+)?)$/.exec(key);
  if (htht) {
    const line = Number(htht[2]);
    const scoredHT = h + a;
    const dev = Number.isInteger(line) ? " Com exatamente 1 devolve." : "";
    if (htht[1] === "htover") {
      if (scoredHT > line) return `Já ${h}–${a} na 1.ª parte.`;
      return `Vão ${h}–${a} aos ${m}'${htXg} na 1.ª parte.${dev}`;
    }
    if (scoredHT > line) return `Já ${h}–${a} na 1.ª parte.`;
    return `Vão ${h}–${a} aos ${m}'${htXg} na 1.ª parte.${dev}`;
  }
  const htteam = /^(htto|httu):(home|away):(\d+(?:\.\d+)?)$/.exec(key);
  if (htteam) {
    const team = htteam[2] === "home" ? home : away;
    const s = htteam[2] === "home" ? h : a;
    const line = Number(htteam[3]);
    const dev = Number.isInteger(line) ? " Com exatamente 1 devolve." : "";
    if (htteam[1] === "htto") {
      if (s > line) return `Já ${team} com ${s} na 1.ª parte.`;
      const kh = htteam[2] === "home";
      return `${team} com ${s} aos ${m}'${htXgSide(kh)} na 1.ª parte.${dev}`;
    }
    if (s > line) return `Já ${team} com ${s} na 1.ª parte.`;
    const kh = htteam[2] === "home";
    return `${team} com ${s} aos ${m}'${htXgSide(kh)} na 1.ª parte.${dev}`;
  }
  const ou = /^(over|under):(\d+(?:\.\d+)?)$/.exec(key);
  if (ou) {
    return `${score}: ${comma(rem)} esperados (${home} ${comma(rh)}, ${away} ${comma(ra)}${evComma}).${reds}`;
  }
  const team = /^(to|tu):(home|away):(\d+(?:\.\d+)?)$/.exec(key);
  if (team) {
    const side = team[2] === "home" ? home : away;
    const scored = team[2] === "home" ? h : a;
    const rest = team[2] === "home" ? rh : ra;
    const line = Number(team[3]);
    const kh = team[2] === "home";
    if (team[1] === "to" && scored > line) return `Já coberto: ${side} tem ${scored}.`;
    if (team[1] === "tu" && scored > line) return `Perdido: ${side} já tem ${scored}.`;
    return `Aos ${m}', ${side} tem ${scored} e ${evSide(kh, rest)}.${reds}`;
  }
  switch (key) {
    case "home":
    case "away": {
      const t = key === "home" ? home : away;
      const kh = key === "home";
      const r = kh ? rh : ra;
      const ro = kh ? ra : rh;
      if (h === a) return `Empatado ${score} em ${left}: ${t} ${evSide(kh, r)} contra ${comma(ro)}.${reds}`;
      const ahead = kh === h > a;
      return ahead
        ? `A ganhar ${score} em ${left}: ${t} ${evSide(kh, r)} contra ${comma(ro)}.${reds}`
        : `A perder ${score} em ${left}: ${t} ${evSide(kh, r)} contra ${comma(ro)}.${reds}`;
    }
    case "1x":
    case "x2": {
      const t = key === "1x" ? home : away;
      const r = key === "1x" ? rh : ra;
      return `${score}${evParen}: ${t} a criar ${comma(r)}, empate a ${Math.round(p.fullTime.draw * 100)}%.${reds}`;
    }
    case "12":
      return `${score}${evParen}: empate a ${Math.round(p.fullTime.draw * 100)}% com ${comma(rem)} esperados.`;
    case "dnb:home":
    case "dnb:away": {
      const t = key === "dnb:home" ? home : away;
      const r = key === "dnb:home" ? rh : ra;
      return `${score}${evParen}: ${t} a criar ${comma(r)}, empate a ${Math.round(p.fullTime.draw * 100)}% (devolve).${reds}`;
    }
    case "btts:yes": {
      if (h > 0 && a > 0) return `${score}.`;
      if (h === 0 && a === 0) return `${score} sem golos com ${comma(rem)} esperados${evComma}.${reds}`;
      const missing = h === 0 ? home : away;
      const missingHome = h === 0;
      const r = missingHome ? rh : ra;
      return `Aos ${m}', ${missing} tem 0 e ${evSide(missingHome, r)}.${reds}`;
    }
    case "btts:no": {
      if (h > 0 && a > 0) return `${score}.`;
      if (h === 0 && a === 0)
        return `Pouco criado até agora${evComma} com ${comma(rem)} esperados.${reds}`;
      const other = h > 0 ? away : home;
      const otherHome = h === 0;
      const r = otherHome ? rh : ra;
      return `${other} tem 0 com ${score}: ${evSide(otherHome, r)}.${reds}`;
    }
    default:
      return "";
  }
}

// A bet at 97% or more is not a bet: nothing is left to win. One under 35% is a
// long shot, not a suggestion.
const TOO_SURE = 0.97;
const TOO_UNLIKELY = 0.35;
// From this minute on, there is too little game left for a suggestion to mean much.
export const LAST_MINUTES = 88;

// The chance is cut back before working out from which odd a bet is worth it.
// Tested at half time on 6,062 games of 2025/26 (the main bet of each game): what
// the model said and what happened were 62.0% and 61.9% for results, 60.9% and
// 61.6% for both teams to score, but 58.9% and 55.5% for goals, which it
// overrates, hence the heavier cut there.
export const LIVE_HAIRCUT: Record<LiveGroup, number> = { result: 0.99, goals: 0.94, btts: 1, halves: 0.94 };

export interface LivePick extends LiveCandidate {
  fairOdd: number;
  // The odd from which it would be worth it: the fair odd of the chance cut back
  // (LIVE_HAIRCUT), plus the usual margin.
  minOdd: number;
}

// The most probable bet that still pays at least `minOdd` by the model's own
// reckoning (its fair odd), and the best of each of the other kinds. Under 35% a
// bet is not offered. First-half markets demand at least 1.8: their chances
// are an untested approximation (no score effect inside the half), so they
// only run when they pay for the extra uncertainty.
const HALVES_MIN_ODD = 1.8;
export function suggestLive(
  candidates: LiveCandidate[],
  opts: { minOdd: number; haircut?: Record<LiveGroup, number> }
): { main: LivePick | null; others: LivePick[] } {
  const haircut = opts.haircut ?? LIVE_HAIRCUT;
  const priced = (c: LiveCandidate): LivePick => {
    const push = c.push ?? 0;
    const fair = c.p > 0 ? (push > 0 ? (1 - push) / c.p : fairOdd(c.p)) : Infinity;
    const cut = c.p * haircut[c.group];
    const minFair = cut > 0 ? (push > 0 ? (1 - push) / cut : fairOdd(cut)) : Infinity;
    return {
      ...c,
      fairOdd: fair,
      minOdd: Number.isFinite(minFair) ? minFair * (1 + VALUE_MARGIN[c.group]) : Infinity,
    };
  };
  const fairOf = (c: LiveCandidate): number => {
    const push = c.push ?? 0;
    return c.p > 0 ? (push > 0 ? (1 - push) / c.p : fairOdd(c.p)) : Infinity;
  };
  const minFor = (c: LiveCandidate): number => (c.group === "halves" ? Math.max(opts.minOdd, HALVES_MIN_ODD) : opts.minOdd);
  const eligible = candidates
    .filter((c) => c.p < TOO_SURE && c.p >= TOO_UNLIKELY && fairOf(c) >= minFor(c))
    .map(priced);
  const best = new Map<LiveGroup, LivePick>();
  for (const c of eligible) {
    const top = best.get(c.group);
    if (!top || c.p > top.p) best.set(c.group, c);
  }
  const ranked = [...best.values()].sort((a, b) => b.p - a.p);
  return { main: ranked[0] ?? null, others: ranked.slice(1) };
}
