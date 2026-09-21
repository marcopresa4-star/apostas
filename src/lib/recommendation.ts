import { OVER_LINES, fairOdd, type PlayedMatch, type Prediction } from "./footballModel";

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

export type PickGroup = "result" | "goals" | "btts";

const TRUST: Record<PickGroup, number> = { result: 1, goals: 0.5, btts: 0.5 };

// A bet is only offered if it is not a sure thing that pays nothing (over 0.5
// goals) nor a long shot.
const MIN_P = 0.4;
const MAX_P = 0.77;
// How far above the league's usual rate the chance must be, in points, after
// that pull-back. Below this nothing is suggested.
const MIN_LIFT = 0.04;
// The odd must beat the fair one by this much to be worth it.
export const VALUE_MARGIN = 0.05;
const MAX_PICKS = 3;

export interface Pick {
  group: PickGroup;
  label: string;
  p: number; // the model's chance
  base: number; // how often it happens in this league
  fairOdd: number;
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
}

// How often each thing happens in the league's games.
export function baseRates(matches: PlayedMatch[]): BaseRates {
  const n = matches.length || 1;
  const share = (test: (m: PlayedMatch) => boolean) => matches.filter(test).length / n;
  const over: Record<string, number> = {};
  for (const line of OVER_LINES) over[String(line)] = share((m) => m.ft[0] + m.ft[1] > line);
  return {
    home: share((m) => m.ft[0] > m.ft[1]),
    draw: share((m) => m.ft[0] === m.ft[1]),
    away: share((m) => m.ft[0] < m.ft[1]),
    over,
    btts: share((m) => m.ft[0] > 0 && m.ft[1] > 0),
  };
}

const num = (n: number) => n.toFixed(1).replace(".", ",");

export function recommend(
  prediction: Prediction,
  base: BaseRates,
  home: string,
  away: string
): Pick[] {
  const ft = prediction.fullTime;
  type Candidate = {
    group: PickGroup;
    label: string;
    p: number;
    base: number;
    won: (score: [number, number]) => boolean;
  };
  const candidates: Candidate[] = [
    { group: "result", label: `Vitória de ${home}`, p: ft.home, base: base.home, won: ([h, a]) => h > a },
    { group: "result", label: `Vitória de ${away}`, p: ft.away, base: base.away, won: ([h, a]) => a > h },
    {
      group: "result",
      label: `${home} ou empate (1X)`,
      p: ft.home + ft.draw,
      base: base.home + base.draw,
      won: ([h, a]) => h >= a,
    },
    {
      group: "result",
      label: `${away} ou empate (X2)`,
      p: ft.away + ft.draw,
      base: base.away + base.draw,
      won: ([h, a]) => a >= h,
    },
    { group: "btts", label: "Ambas marcam: sim", p: prediction.bothScore, base: base.btts, won: ([h, a]) => h > 0 && a > 0 },
    {
      group: "btts",
      label: "Ambas marcam: não",
      p: 1 - prediction.bothScore,
      base: 1 - base.btts,
      won: ([h, a]) => !(h > 0 && a > 0),
    },
  ];
  for (const line of [1.5, 2.5, 3.5]) {
    const over = prediction.over[String(line)];
    candidates.push(
      { group: "goals", label: `Mais de ${num(line)} golos`, p: over, base: base.over[String(line)], won: ([h, a]) => h + a > line },
      { group: "goals", label: `Menos de ${num(line)} golos`, p: 1 - over, base: 1 - base.over[String(line)], won: ([h, a]) => h + a < line }
    );
  }

  const ranked = candidates
    .map((c) => ({ ...c, p: c.base + TRUST[c.group] * (c.p - c.base) }))
    .filter((c) => c.p >= MIN_P && c.p <= MAX_P && c.p - c.base >= MIN_LIFT)
    .sort((a, b) => b.p - b.base - (a.p - a.base));

  // At most one per family, so the suggestions do not just repeat each other
  // (a win and "win or draw" are the same idea).
  const picks: Pick[] = [];
  const used = new Set<PickGroup>();
  for (const c of ranked) {
    if (used.has(c.group)) continue;
    used.add(c.group);
    picks.push({
      group: c.group,
      label: c.label,
      p: c.p,
      base: c.base,
      fairOdd: fairOdd(c.p),
      minOdd: fairOdd(c.p) * (1 + VALUE_MARGIN),
      won: c.won,
    });
    if (picks.length === MAX_PICKS) break;
  }
  return picks;
}
