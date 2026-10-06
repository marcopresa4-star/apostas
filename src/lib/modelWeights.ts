// Hand-tuned model weights for the Comparar tab: sliders that bend the club
// model's expected goals after the fit. footballModel.ts stays untouched —
// everything here reuses its exported pieces (strengthOf, predictionFromLambdas…)
// or mirrors them, and neutral weights reproduce predict() exactly (tested).
//
// Honesty note, same as the injury rules: only the venue-form weight was
// backtested (it made results worse). The rest are untested heuristics with
// documented directions, not fitted parameters.
import {
  blendedStrength,
  leagueRates,
  predict,
  predictionFromLambdas,
  shotRates,
  shotStrengthOf,
  strengthOf,
  venueStrengthOf,
  type LeagueRates,
  type PlayedMatch,
  type Prediction,
  type Strength,
} from "./footballModel";

export interface ModelWeights {
  attack: number; // 0 = opponent defence only … 50 = as fitted … 100 = own attack only
  homeAdv: number; // 50 = league home edge as fitted; 0 halves it, 100 adds half again
  venue: number; // 0-100: same blend predict() already does (old forma_local)
  historic: number; // 0-100: pull expected total towards the league average
  standings: number; // 0-100: nudge by table positions
  sot: number; // 0-100: shots-on-target share of strength (50 = as fitted)
  recency: number; // 0-100: memory length (50 = 365-day half-life, as fitted)
  h2h: number; // 0-100: blend towards head-to-head averages
}

export const NEUTRAL_WEIGHTS: ModelWeights = {
  attack: 50,
  homeAdv: 50,
  venue: 0,
  historic: 0,
  standings: 0,
  sot: 50,
  recency: 50,
  h2h: 0,
};

// -1 = defensivo, 0 = equilibrado, 1 = ofensivo (the reader's own call).
export type TeamStyle = -1 | 0 | 1;

export interface WeightsCtx {
  homePos: number | null; // 1-based table positions, official table preferred
  awayPos: number | null;
  teamCount: number;
  h2hHome: number | null; // average scored by each side across the meetings
  h2hAway: number | null;
  h2hGames: number;
}

export const WEIGHT_KEYS = [
  "w_ataque",
  "w_casa",
  "w_local",
  "w_hist",
  "w_class",
  "w_sot",
  "w_rec",
  "w_h2h",
  "estilo_casa",
  "estilo_fora",
] as const;

const clampW = (v: string | undefined, fb: number): number => {
  if (v === undefined || v.trim() === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fb;
};

// Reads the sliders from the address (hand-editable, so everything is
// clamped). w_local also honours the retired forma_local values.
export function weightsFromParams(params: Record<string, string | undefined>): {
  weights: ModelWeights;
  styles: { home: TeamStyle; away: TeamStyle };
} {
  const style = (v: string | undefined): TeamStyle =>
    v === "ofensivo" ? 1 : v === "defensivo" ? -1 : 0;
  const legacyVenue = ["25", "50", "75", "100"].includes(params.forma_local ?? "")
    ? Number(params.forma_local)
    : null;
  return {
    weights: {
      attack: clampW(params.w_ataque, 50),
      homeAdv: clampW(params.w_casa, 50),
      venue: params.w_local !== undefined && params.w_local !== "" ? clampW(params.w_local, 0) : (legacyVenue ?? 0),
      historic: clampW(params.w_hist, 0),
      standings: clampW(params.w_class, 0),
      sot: clampW(params.w_sot, 50),
      recency: clampW(params.w_rec, 50),
      h2h: clampW(params.w_h2h, 0),
    },
    styles: { home: style(params.estilo_casa), away: style(params.estilo_fora) },
  };
}

export function isNeutralW(w: ModelWeights, styles: { home: TeamStyle; away: TeamStyle }): boolean {
  return (
    w.attack === 50 &&
    w.homeAdv === 50 &&
    w.venue === 0 &&
    w.historic === 0 &&
    w.standings === 0 &&
    w.sot === 50 &&
    w.recency === 50 &&
    w.h2h === 0 &&
    styles.home === 0 &&
    styles.away === 0
  );
}

const DAY_MS = 86_400_000;
const PRIOR = 8; // same caution as the model's own prior

// Half-life in days for the recency slider: 0 = long memory (~4 anos),
// 50 = 365 dias (as fitted), 100 = ~91 dias (mostly the latest games).
const halfLifeOf = (recency: number): number => 365 * 4 ** ((50 - recency) / 50);

function decayWeight(date: string, now: Date, halfLife: number): number {
  const age = (now.getTime() - new Date(`${date}T12:00:00`).getTime()) / DAY_MS;
  return 0.5 ** (Math.max(0, age) / halfLife);
}

interface Averages {
  rates: LeagueRates;
  home: Strength & { games: number };
  away: Strength & { games: number };
}

// Strengths with a custom memory length. At recency 50 this path is never
// used (the caller keeps the model's own functions, bit for bit).
function customAverages(
  matches: PlayedMatch[],
  home: string,
  away: string,
  now: Date,
  recency: number,
  venueW: number,
  shotW: number
): Averages {
  const hl = halfLifeOf(recency);
  const wof = (date: string): number => decayWeight(date, now, hl);
  const ratesOf = (): LeagueRates => {
    let w = 0;
    let h = 0;
    let a = 0;
    let htGoals = 0;
    let ftGoalsWithHt = 0;
    for (const m of matches) {
      const weight = wof(m.date);
      w += weight;
      h += weight * m.ft[0];
      a += weight * m.ft[1];
      if (m.ht) {
        htGoals += weight * (m.ht[0] + m.ht[1]);
        ftGoalsWithHt += weight * (m.ft[0] + m.ft[1]);
      }
    }
    if (w === 0) return { home: 1.4, away: 1.1, perTeam: 1.25, firstHalfShare: 0.44 };
    return {
      home: h / w,
      away: a / w,
      perTeam: (h + a) / (2 * w),
      firstHalfShare: ftGoalsWithHt > 0 ? htGoals / ftGoalsWithHt : 0.44,
    };
  };
  const rates = ratesOf();
  const strength = (team: string, onlyVenue: "home" | "away" | null): Strength => {
    let w = 0;
    let scored = 0;
    let conceded = 0;
    let games = 0;
    for (const m of matches) {
      const isHome = m.team1 === team;
      if (!isHome && m.team2 !== team) continue;
      if (onlyVenue === "home" && !isHome) continue;
      if (onlyVenue === "away" && isHome) continue;
      const weight = wof(m.date);
      w += weight;
      scored += weight * (isHome ? m.ft[0] : m.ft[1]);
      conceded += weight * (isHome ? m.ft[1] : m.ft[0]);
      games++;
    }
    const g = rates.perTeam;
    return {
      attack: (scored + PRIOR * g) / (w + PRIOR) / g,
      defense: (conceded + PRIOR * g) / (w + PRIOR) / g,
      games,
    };
  };
  // Venue splits compare against what the league scores there, like the model.
  const venueStrength = (team: string, venue: "home" | "away"): Strength => {
    let w = 0;
    let scored = 0;
    let conceded = 0;
    let games = 0;
    for (const m of matches) {
      if ((venue === "home" ? m.team1 : m.team2) !== team) continue;
      const isHome = venue === "home";
      const weight = wof(m.date);
      w += weight;
      scored += weight * (isHome ? m.ft[0] : m.ft[1]);
      conceded += weight * (isHome ? m.ft[1] : m.ft[0]);
      games++;
    }
    const scoredRef = venue === "home" ? rates.home : rates.away;
    const concededRef = venue === "home" ? rates.away : rates.home;
    return {
      attack: (scored + PRIOR * scoredRef) / (w + PRIOR) / scoredRef,
      defense: (conceded + PRIOR * concededRef) / (w + PRIOR) / concededRef,
      games,
    };
  };
  const shotStrength = (team: string, shotAvg: number): Strength => {
    let w = 0;
    let scored = 0;
    let conceded = 0;
    let games = 0;
    for (const m of matches) {
      if (!m.sot) continue;
      const isHome = m.team1 === team;
      if (!isHome && m.team2 !== team) continue;
      const weight = wof(m.date);
      w += weight;
      scored += weight * (isHome ? m.sot[0] : m.sot[1]);
      conceded += weight * (isHome ? m.sot[1] : m.sot[0]);
      games++;
    }
    if (shotAvg === 0) return { attack: 1, defense: 1, games };
    return {
      attack: (scored + PRIOR * shotAvg) / (w + PRIOR) / shotAvg,
      defense: (conceded + PRIOR * shotAvg) / (w + PRIOR) / shotAvg,
      games,
    };
  };
  const blend = (overall: Strength, venueS: Strength): Strength => ({
    attack: (1 - venueW) * overall.attack + venueW * venueS.attack,
    defense: (1 - venueW) * overall.defense + venueW * venueS.defense,
    games: overall.games,
  });
  let h = strength(home, null);
  let a = strength(away, null);
  if (venueW > 0) {
    h = blend(h, venueStrength(home, "home"));
    a = blend(a, venueStrength(away, "away"));
  }
  // Shot average under the same memory (falls back to goals-only alone).
  let sw = 0;
  let st = 0;
  for (const m of matches) {
    if (!m.sot) continue;
    const weight = wof(m.date);
    sw += weight;
    st += weight * (m.sot[0] + m.sot[1]);
  }
  const shotAvg = sw > 0 ? st / (2 * sw) : 0;
  if (shotAvg > 0) {
    const blendS = (s: Strength, shot: Strength): Strength => ({
      attack: (1 - shotW) * s.attack + shotW * shot.attack,
      defense: (1 - shotW) * s.defense + shotW * shot.defense,
      games: s.games,
    });
    h = blendS(h, shotStrength(home, shotAvg));
    a = blendS(a, shotStrength(away, shotAvg));
  }
  return { rates, home: h, away: a };
}

// Full prediction with the weights applied. Neutral weights (+balanced
// styles) return predict() untouched, bit for bit.
export function predictWeighted(
  matches: PlayedMatch[],
  home: string,
  away: string,
  now: Date,
  ratio: number,
  weights: ModelWeights,
  styles: { home: TeamStyle; away: TeamStyle },
  ctx: WeightsCtx
): Prediction {
  if (isNeutralW(weights, styles)) return predict(matches, home, away, now, ratio, 0);

  const venueW = weights.venue / 100;
  const shotW = weights.sot / 100;
  const custom = weights.recency !== 50;
  let rates: LeagueRates;
  let h: Strength;
  let a: Strength;
  if (!custom) {
    rates = leagueRates(matches, now);
    h = strengthOf(matches, home, rates, now);
    a = strengthOf(matches, away, rates, now);
    if (venueW > 0) {
      const hv = venueStrengthOf(matches, home, "home", rates, now);
      const av = venueStrengthOf(matches, away, "away", rates, now);
      h = { ...h, attack: (1 - venueW) * h.attack + venueW * hv.attack, defense: (1 - venueW) * h.defense + venueW * hv.defense };
      a = { ...a, attack: (1 - venueW) * a.attack + venueW * av.attack, defense: (1 - venueW) * a.defense + venueW * av.defense };
    }
    const shots = shotRates(matches, now);
    if (shots.perTeam > 0) {
      h = blendedStrength(h, shotStrengthOf(matches, home, shots, now), shotW);
      a = blendedStrength(a, shotStrengthOf(matches, away, shots, now), shotW);
    }
  } else {
    const avg = customAverages(matches, home, away, now, weights.recency, venueW, shotW);
    rates = avg.rates;
    h = avg.home;
    a = avg.away;
  }

  // Attack balance: geometric split between own attack and opponent defence
  // (50/50 is the fitted product).
  const alpha = weights.attack / 50;
  const beta = 2 - alpha;
  let lh = rates.home * h.attack ** alpha * a.defense ** beta * ratio;
  let la = (rates.away * a.attack ** alpha * h.defense ** beta) / ratio;

  // Home advantage scale (50 = the league edge as fitted).
  const hm = 1 + (weights.homeAdv - 50) / 100;
  lh *= hm;
  la /= hm;

  // Reader styles: an open game lifts both sides' scoring.
  const own = (s: TeamStyle): number => 1 + 0.08 * s;
  const opp = (s: TeamStyle): number => 1 + 0.05 * s;
  lh *= own(styles.home) * opp(styles.away);
  la *= own(styles.away) * opp(styles.home);

  // Pull towards the league's average scoring.
  const total = lh + la;
  const leagueTotal = rates.perTeam * 2;
  if (total > 0 && weights.historic > 0) {
    const s = 1 - weights.historic / 100 + (weights.historic / 100) * (leagueTotal / total);
    lh *= s;
    la *= s;
  }

  // Table positions (official table preferred): better-placed scores more.
  if (weights.standings > 0 && ctx.homePos !== null && ctx.awayPos !== null && ctx.teamCount > 1) {
    const diff = (ctx.awayPos - ctx.homePos) / ctx.teamCount;
    const t = (weights.standings / 100) * diff * 0.25;
    lh *= 1 + t;
    la *= 1 - t;
  }

  // Head-to-head averages, shrunk towards the model when meetings are few.
  if (weights.h2h > 0 && ctx.h2hGames > 0) {
    const t = (weights.h2h / 100) * Math.min(1, ctx.h2hGames / 6);
    if (ctx.h2hHome !== null) lh = (1 - t) * lh + t * ctx.h2hHome;
    if (ctx.h2hAway !== null) la = (1 - t) * la + t * ctx.h2hAway;
  }

  return predictionFromLambdas(lh, la, rates.firstHalfShare, h.games, a.games);
}
