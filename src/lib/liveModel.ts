// What is likely to happen from now to the end of a game in progress, given the
// minute and the score. It starts from the same expected goals the pre-match
// model gives each team and takes away the part of the game already played.
//
// Everything below was measured on the 4,431 games of 2024/25 and 2025/26 that
// have a half time score, and tested at half time on 2025/26 with the numbers
// measured on 2024/25 only:
//
//  - the first half has fewer goals than the second: the league's own share of
//    goals before the break is used (about 44%);
//  - the score changes how a team plays (STATE): a team that is ahead scores
//    less in the second half, one that is behind or level scores more;
//  - goals in a half are more regular than a Poisson says (variance about 0.82
//    of the mean), which the Conway-Maxwell-Poisson law allows (NU), and there
//    are fewer halves with no goal at all than that law still gives (ZERO):
//    without it "one more goal" came out 6 points too low.
//
// Only the half time point can be tested, because the data has the score at the
// break and at the end, not the minute of each goal. At other minutes these
// effects are phased in or out with the time left, which is a reasonable guess
// and nothing more. Red cards count as rough estimates (untested: the data has
// no sending-off minute); injuries and the flow of the game are not known.

// How much a team scores in the second half compared with what the pre-match
// model expected, by its own lead at half time (own goals minus the opponent's).
// The +-2 or more figures rest on ~800 team-halves each and are the least sure.
export const STATE: Record<string, number> = {
  "-2": 0.93, // behind by 2 or more
  "-1": 1.09,
  "0": 1.14,
  "1": 0.92,
  "2": 0.93, // ahead by 2 or more
};

// Dispersion of a team's goals in a half: 1 is a Poisson, above 1 is more regular.
export const NU = 1.3;
// Factor on the chance that neither team scores again.
export const ZERO = 0.75;

export function stateMultiplier(lead: number, table: Record<string, number> = STATE): number {
  return table[String(Math.max(-2, Math.min(2, lead)))];
}

// Net sending-offs from one side's point of view: how many more reds it has
// than the other side. Each one multiplies what it still scores by RED_DOWN
// and what the other side scores by RED_UP.
function redMultiplier(net: number, isHome: boolean): number {
  const down = isHome ? Math.max(0, net) : Math.max(0, -net);
  const up = isHome ? Math.max(0, -net) : Math.max(0, net);
  return Math.pow(RED_DOWN, down) * Math.pow(RED_UP, up);
}

// Share of a half's goals that come in added time (about 5%), which the clock
// below puts at the end of the second half and lets run out over six minutes.
const STOPPAGE_SHARE = 0.05;
const STOPPAGE_MINUTES = 6;
const MAX_GOALS = 14;

export interface LiveInput {
  lambdaHome: number; // expected goals of the whole game, before it started
  lambdaAway: number;
  firstHalfShare: number; // share of a game's goals scored before half time
  minute: number; // 0 to 120
  homeGoals: number;
  awayGoals: number;
  redsHome?: number; // sending-offs so far (0 when unknown)
  redsAway?: number;
}

// A side a man down scores less and concedes more for the rest of the game.
// Rough estimates, NOT measured (the data has no sending-off minute): each
// net red multiplies what the short-handed side still scores by RED_DOWN and
// what the other side scores by RED_UP. Capped at two either way.
const RED_DOWN = 0.75;
const RED_UP = 1.2;

export interface LivePrediction {
  // Expected goals still to come for each side.
  remainingHome: number;
  remainingAway: number;
  // First-half remainder only (zeros once the break passes): over 0.5/1.5 in
  // total and per side, from the HT-only Poisson means. Approximation: no
  // zero-inflation and no score effect inside the half (both unmeasured).
  halfTime: {
    over05: number;
    over15: number;
    homeOver05: number;
    homeOver15: number;
    awayOver05: number;
    awayOver15: number;
  };
  // Full remaining-goals distributions (index = goals still to come).
  homePmf: number[];
  awayPmf: number[];
  // Chance each side scores again before the end (marginal scoreless).
  scoresAgain: { home: number; away: number };
  // Final result, given the current score.
  fullTime: { home: number; draw: number; away: number };
  // Chance of MORE than `line` goals in the whole game (line = 0.5, 1.5, ...).
  over: Record<string, number>;
  bothScore: number;
  // The next goal, or none until the end.
  nextGoal: { home: number; away: number; none: number };
  // The most likely final scores (the goals already scored included).
  finalScores: { home: number; away: number; p: number }[];
}

const LOG_FACT = (() => {
  const t = [0];
  for (let k = 1; k <= MAX_GOALS; k++) t[k] = t[k - 1] + Math.log(k);
  return t;
})();

// Conway-Maxwell-Poisson probabilities 0..MAX_GOALS with the given mean: the
// chance of k is proportional to mu^k / (k!)^nu, and mu is found so that the mean
// comes out right. With nu = 1 this is the Poisson.
function comPoisson(mean: number, nu: number): number[] {
  if (mean <= 1e-9) return [1, ...Array(MAX_GOALS).fill(0)];
  const pmf = (logMu: number) => {
    const w = Array.from({ length: MAX_GOALS + 1 }, (_, k) => Math.exp(k * logMu - nu * LOG_FACT[k]));
    const z = w.reduce((s, x) => s + x, 0);
    return w.map((x) => x / z);
  };
  const meanOf = (p: number[]) => p.reduce((s, x, k) => s + k * x, 0);
  let lo = -14;
  let hi = 8;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (meanOf(pmf(mid)) < mean) lo = mid;
    else hi = mid;
  }
  return pmf((lo + hi) / 2);
}

// The part of a game's expected goals still to come, in what is left of the
// first half and what is left of the second. The second half's share includes
// its added time, which is at the end: the clock never runs backwards.
function remaining(minute: number, firstHalfShare: number): { first: number; second: number } {
  const s2 = 1 - firstHalfShare;
  const m = Math.max(0, Math.min(120, minute));
  if (m < 45) return { first: firstHalfShare * ((45 - m) / 45), second: s2 };
  if (m < 90) return { first: 0, second: s2 * ((1 - STOPPAGE_SHARE) * ((90 - m) / 45) + STOPPAGE_SHARE) };
  // In added time: what is left of it, fading out over a few minutes.
  return { first: 0, second: s2 * STOPPAGE_SHARE * Math.max(0.02, (90 + STOPPAGE_MINUTES - m) / STOPPAGE_MINUTES) };
}

export function predictLive(
  input: LiveInput,
  table: Record<string, number> = STATE,
  nu: number = NU,
  zero: number = ZERO
): LivePrediction {
  const { lambdaHome, lambdaAway, firstHalfShare, homeGoals, awayGoals } = input;
  const minute = Math.max(0, Math.min(120, input.minute));
  const { first, second } = remaining(minute, firstHalfShare);
  const s2 = 1 - firstHalfShare;

  // The score effect is measured over a whole second half: it builds up over the
  // first half, so that at minute 0 nothing is added to the pre-match figures.
  const build = Math.min(1, minute / 45);
  const lead = homeGoals - awayGoals;
  const homeState = 1 + build * (stateMultiplier(lead, table) - 1);
  const awayState = 1 + build * (stateMultiplier(-lead, table) - 1);

  // The regularity of goals was measured over a whole second half too: it also
  // builds up to the break and fades as the time left shrinks.
  const weight = build * Math.min(1, (first + second) / s2);
  const nuNow = 1 + (nu - 1) * weight;
  const zeroNow = 1 - (1 - zero) * weight;

  // Sending-offs so far (+ = home worse off), capped: beyond two the guess
  // would be pure fiction.
  const capped = Math.max(-2, Math.min(2, (input.redsHome ?? 0) - (input.redsAway ?? 0)));

  const remainingHome =
    lambdaHome * (first + second * homeState) * redMultiplier(capped, true);
  const remainingAway =
    lambdaAway * (first + second * awayState) * redMultiplier(capped, false);
  const homePmf = comPoisson(remainingHome, nuNow);
  const awayPmf = comPoisson(remainingAway, nuNow);

  // HT-only distributions from the first-half remainder (same red-card
  // scaling as the totals above).
  const redHome = redMultiplier(capped, true);
  const redAway = redMultiplier(capped, false);
  const htHomePmf = comPoisson(lambdaHome * first * redHome, nuNow);
  const htAwayPmf = comPoisson(lambdaAway * first * redAway, nuNow);
  const htOver = (line: number): number => {
    let p = 0;
    for (let i = 0; i <= MAX_GOALS; i++) {
      for (let j = 0; j <= MAX_GOALS; j++) {
        if (i + j > line) p += htHomePmf[i] * htAwayPmf[j];
      }
    }
    return p;
  };
  const htTeamOver = (pmf: number[], line: number): number => {
    let p = 0;
    for (let k = 0; k < pmf.length; k++) if (k > line) p += pmf[k];
    return p;
  };
  const halfTime = {
    over05: htOver(0.5),
    over15: htOver(1.5),
    homeOver05: htTeamOver(htHomePmf, 0.5),
    homeOver15: htTeamOver(htHomePmf, 1.5),
    awayOver05: htTeamOver(htAwayPmf, 0.5),
    awayOver15: htTeamOver(htAwayPmf, 1.5),
  };

  const fullTime = { home: 0, draw: 0, away: 0 };
  const over: Record<string, number> = {};
  for (let line = 0; line <= 9; line++) over[String(line + 0.5)] = 0;
  let bothScore = 0;
  let total = 0;
  let none = 0;
  const finals: { home: number; away: number; p: number }[] = [];

  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = homePmf[i] * awayPmf[j] * (i === 0 && j === 0 ? zeroNow : 1);
      total += p;
      if (i === 0 && j === 0) none = p;
      const h = homeGoals + i;
      const a = awayGoals + j;
      finals.push({ home: h, away: a, p });
      if (h > a) fullTime.home += p;
      else if (h === a) fullTime.draw += p;
      else fullTime.away += p;
      if (h > 0 && a > 0) bothScore += p;
      for (let line = 0; line <= 9; line++) if (h + a > line + 0.5) over[String(line + 0.5)] += p;
    }
  }

  const norm = (n: number) => n / total;
  for (const key of Object.keys(over)) over[key] = norm(over[key]);

  // Who scores next: in proportion to what each is still expected to score.
  const rate = remainingHome + remainingAway;
  const noGoal = norm(none);
  // Each side's chance of scoring again: its scoreless marginal, normalized
  // with the same total as everything else.
  let homeZero = 0;
  let awayZero = 0;
  for (let j = 0; j <= MAX_GOALS; j++) {
    homeZero += homePmf[0] * awayPmf[j] * (j === 0 ? zeroNow : 1);
    awayZero += awayPmf[0] * homePmf[j] * (j === 0 ? zeroNow : 1);
  }
  return {
    remainingHome,
    remainingAway,
    homePmf,
    awayPmf,
    halfTime,
    scoresAgain: { home: 1 - norm(homeZero), away: 1 - norm(awayZero) },
    finalScores: finals
      .sort((x, y) => y.p - x.p)
      .slice(0, 6)
      .map((f) => ({ ...f, p: norm(f.p) })),
    fullTime: { home: norm(fullTime.home), draw: norm(fullTime.draw), away: norm(fullTime.away) },
    over,
    bothScore: norm(bothScore),
    nextGoal:
      rate <= 1e-9
        ? { home: 0, away: 0, none: 1 }
        : {
            home: (1 - noGoal) * (remainingHome / rate),
            away: (1 - noGoal) * (remainingAway / rate),
            none: noGoal,
          },
  };
}
