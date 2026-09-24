import type { LivePrediction } from "./liveModel";
import { fairOdd } from "./footballModel";
import { VALUE_MARGIN } from "./recommendation";

// A bet worth looking at in a game in progress, from the live model: the results
// (still to be won, or to be saved) and the goals still to come. The next goal is
// left out on purpose: the data has no minute of the goals, so it cannot be tested.

export type LiveGroup = "result" | "goals" | "btts";

export interface LiveCandidate {
  group: LiveGroup;
  // "home", "away", "1x", "x2", "12", "over:<line>", "under:<line>", "btts:yes", "btts:no"
  key: string;
  label: string;
  p: number;
  // Whether it came off, given the final score.
  won: (final: [number, number]) => boolean;
}

const dot = (n: number) => n.toFixed(1).replace(".", ",");

export function liveCandidates(
  p: LivePrediction,
  ctx: { home: string; away: string; homeGoals: number; awayGoals: number }
): LiveCandidate[] {
  const { home, away, homeGoals, awayGoals } = ctx;
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
  return out;
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
export const LIVE_HAIRCUT: Record<LiveGroup, number> = { result: 0.99, goals: 0.94, btts: 1 };

export interface LivePick extends LiveCandidate {
  fairOdd: number;
  // The odd from which it would be worth it: the fair odd of the chance cut back
  // (LIVE_HAIRCUT), plus the usual margin.
  minOdd: number;
}

// The most probable bet that still pays at least `minOdd` by the model's own
// reckoning (its fair odd), and the best of each of the other kinds. Under 35% a
// bet is not offered.
export function suggestLive(
  candidates: LiveCandidate[],
  opts: { minOdd: number; haircut?: Record<LiveGroup, number> }
): { main: LivePick | null; others: LivePick[] } {
  const haircut = opts.haircut ?? LIVE_HAIRCUT;
  const priced = (c: LiveCandidate): LivePick => ({
    ...c,
    fairOdd: fairOdd(c.p),
    minOdd: fairOdd(c.p * haircut[c.group]) * (1 + VALUE_MARGIN[c.group]),
  });
  const eligible = candidates.filter((c) => c.p < TOO_SURE && c.p >= TOO_UNLIKELY && fairOdd(c.p) >= opts.minOdd).map(priced);
  const best = new Map<LiveGroup, LivePick>();
  for (const c of eligible) {
    const top = best.get(c.group);
    if (!top || c.p > top.p) best.set(c.group, c);
  }
  const ranked = [...best.values()].sort((a, b) => b.p - a.p);
  return { main: ranked[0] ?? null, others: ranked.slice(1) };
}
