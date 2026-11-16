// What a league really does, from the games it has already played: how often
// each market happened, how that changes across the season and between clear
// favourites and even games, and how the model priced those same games before
// kick-off. Pure (no Supabase, no scraper) so the page only fetches the
// fixtures and the numbers stay testable.
import type { PlayedMatch } from "./footballModel";

export interface MarketRates {
  games: number;
  goals: number;
  perGame: number;
  homeGoals: number;
  awayGoals: number;
  over05: number;
  over15: number;
  over25: number;
  over35: number;
  btts: number;
  homeWin: number;
  draw: number;
  awayWin: number;
  // Only games with a half-time score count here (older feeds may lack it).
  withHt: number;
  firstHalfGoal: number;
  ht00: number;
  bothHalves: number;
  comeback: number;
}

const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

export function marketRates(matches: PlayedMatch[]): MarketRates {
  const played = matches.filter((m) => Array.isArray(m.ft));
  let goals = 0;
  let homeGoals = 0;
  let awayGoals = 0;
  let over05 = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let btts = 0;
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let withHt = 0;
  let firstHalfGoal = 0;
  let ht00 = 0;
  let bothHalves = 0;
  let comeback = 0;

  for (const m of played) {
    const [h, a] = m.ft;
    const total = h + a;
    goals += total;
    homeGoals += h;
    awayGoals += a;
    if (total > 0.5) over05++;
    if (total > 1.5) over15++;
    if (total > 2.5) over25++;
    if (total > 3.5) over35++;
    if (h > 0 && a > 0) btts++;
    if (h > a) homeWin++;
    else if (h === a) draw++;
    else awayWin++;

    if (!m.ht) continue;
    const [hh, ha] = m.ht;
    const htTotal = hh + ha;
    withHt++;
    if (htTotal > 0) firstHalfGoal++;
    else ht00++;
    if (htTotal > 0 && total - htTotal > 0) bothHalves++;
    // A side behind at the break that still won.
    if ((hh < ha && h > a) || (ha < hh && a > h)) comeback++;
  }

  const n = played.length;
  return {
    games: n,
    goals,
    perGame: share(goals, n),
    homeGoals: share(homeGoals, n),
    awayGoals: share(awayGoals, n),
    over05: share(over05, n),
    over15: share(over15, n),
    over25: share(over25, n),
    over35: share(over35, n),
    btts: share(btts, n),
    homeWin: share(homeWin, n),
    draw: share(draw, n),
    awayWin: share(awayWin, n),
    withHt,
    firstHalfGoal: share(firstHalfGoal, withHt),
    ht00: share(ht00, withHt),
    bothHalves: share(bothHalves, withHt),
    comeback: share(comeback, withHt),
  };
}

export interface Segment {
  label: string;
  rates: MarketRates;
}

const byDate = (matches: PlayedMatch[]): PlayedMatch[] =>
  [...matches].sort((a, b) => `${a.date}`.localeCompare(`${b.date}`));

// First half of the season against the second: a league that starts tight and
// opens up (or the other way round) hides that in a single average.
export function splitChronology(matches: PlayedMatch[]): Segment[] {
  const sorted = byDate(matches).filter((m) => Array.isArray(m.ft));
  if (sorted.length < 2) return [];
  const mid = Math.ceil(sorted.length / 2);
  return [
    { label: "1.ª metade da época", rates: marketRates(sorted.slice(0, mid)) },
    { label: "2.ª metade da época", rates: marketRates(sorted.slice(mid)) },
  ].filter((s) => s.rates.games > 0);
}

export interface Probabilities {
  over15: number;
  over25: number;
  btts: number;
  home: number;
  draw: number;
  away: number;
}

// The model as it stood before each game: `prior` holds only the matches
// played earlier, so nothing from the future leaks into the calibration.
export type Predictor = (prior: PlayedMatch[], home: string, away: string, when: Date) => Probabilities;

export interface CalibrationRow {
  key: keyof Probabilities;
  label: string;
  games: number;
  model: number;
  real: number;
  brier: number;
}

const MARKETS: {
  key: keyof Probabilities;
  label: string;
  hit: (m: PlayedMatch) => boolean;
}[] = [
  { key: "over15", label: "Over 1,5", hit: (m) => m.ft[0] + m.ft[1] > 1.5 },
  { key: "over25", label: "Over 2,5", hit: (m) => m.ft[0] + m.ft[1] > 2.5 },
  { key: "btts", label: "Ambas marcam", hit: (m) => m.ft[0] > 0 && m.ft[1] > 0 },
  { key: "home", label: "Vitória casa", hit: (m) => m.ft[0] > m.ft[1] },
  { key: "draw", label: "Empate", hit: (m) => m.ft[0] === m.ft[1] },
  { key: "away", label: "Vitória fora", hit: (m) => m.ft[0] < m.ft[1] },
];

// Real frequency next to the average probability the model gave, plus the
// Brier score (lower is better; 0.25 = a coin flip). `minPrior` keeps the
// first games of a season out: the model has nothing to learn from yet.
export function calibration(matches: PlayedMatch[], predictor: Predictor, minPrior = 20): CalibrationRow[] {
  const sorted = byDate(matches).filter((m) => Array.isArray(m.ft));
  const acc = MARKETS.map((mk) => ({ mk, n: 0, p: 0, hit: 0, sq: 0 }));
  for (let i = minPrior; i < sorted.length; i++) {
    const m = sorted[i];
    const when = new Date(`${m.date}T12:00:00`);
    const prior = sorted.slice(0, i);
    const probs = predictor(prior, m.team1, m.team2, when);
    for (const a of acc) {
      const p = probs[a.mk.key];
      if (!Number.isFinite(p)) continue;
      const hit = a.mk.hit(m) ? 1 : 0;
      a.n++;
      a.p += p;
      a.hit += hit;
      a.sq += (p - hit) * (p - hit);
    }
  }
  return acc
    .filter((a) => a.n > 0)
    .map((a) => ({
      key: a.mk.key,
      label: a.mk.label,
      games: a.n,
      model: a.p / a.n,
      real: a.hit / a.n,
      brier: a.sq / a.n,
    }));
}

// Clear favourite (the model gave one side 55%+) against an even game: tells
// whether the league's goals come from mismatches or from open, balanced ties.
export function favouriteSegments(matches: PlayedMatch[], predictor: Predictor, minPrior = 20): Segment[] {
  const sorted = byDate(matches).filter((m) => Array.isArray(m.ft));
  const favourite: PlayedMatch[] = [];
  const even: PlayedMatch[] = [];
  for (let i = minPrior; i < sorted.length; i++) {
    const m = sorted[i];
    const when = new Date(`${m.date}T12:00:00`);
    const probs = predictor(sorted.slice(0, i), m.team1, m.team2, when);
    const best = Math.max(probs.home, probs.draw, probs.away);
    (best >= 0.55 ? favourite : even).push(m);
  }
  return [
    { label: "Favorito claro (modelo ≥ 55%)", rates: marketRates(favourite) },
    { label: "Jogo equilibrado", rates: marketRates(even) },
  ].filter((s) => s.rates.games > 0);
}

// Same 15-minute blocks as the team goal-timing table (stoppage folded into
// the block it belongs to, 76+ in the last one).
export const GOAL_BLOCKS = ["0–15", "16–30", "31–45", "46–60", "61–75", "76–90"] as const;

export function goalBlock(minute: number): number {
  if (minute <= 15) return 0;
  if (minute <= 30) return 1;
  if (minute <= 45) return 2;
  if (minute <= 60) return 3;
  if (minute <= 75) return 4;
  return 5;
}

export function goalBlocks(minutes: number[]): number[] {
  const out = GOAL_BLOCKS.map(() => 0);
  for (const m of minutes) {
    if (!Number.isFinite(m) || m < 0) continue;
    out[goalBlock(m)]++;
  }
  return out;
}
