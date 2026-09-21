import { predictionFromLambdas, type Prediction } from "./footballModel";

// A goals model for national teams. In a league every team plays all the others,
// so a team's goals against the league average say how strong it is. National
// teams play very different opponents (Spain scores a lot against weak sides), so
// the strengths have to be worked out together: each team's attack and defence
// are the ones that, with the opponents' own, best explain every result. This is
// the same Poisson model as for the leagues, fitted by repeating the update of
// every team's numbers until they settle.

export interface IntlGame {
  date: string; // YYYY-MM-DD
  home: string;
  away: string;
  hg: number;
  ag: number;
  neutral: boolean;
  tournament: string;
}

export interface IntlFit {
  attack: Map<string, number>; // 1 = average
  defense: Map<string, number>; // 1 = average, above 1 concedes more
  games: Map<string, number>; // games in the window of the fit
  mu: number; // goals per side against an average team, away or at a neutral venue
  homeAdv: number; // what playing at home multiplies a side's goals by
}

// Numbers chosen by testing on the games of 2024/25 and checking on those of
// 2025/26 and the summer of 2026 (each game predicted from earlier ones only): a
// result counts half as much every HALF_LIFE_DAYS, only the last WINDOW_YEARS are
// used, and a team is pulled towards the average as if it had already scored and
// conceded PRIOR goals in line with its opponents. Friendlies weighed the same as
// the rest did as well as any other choice, so they are not told apart.
export const HALF_LIFE_DAYS = 1095;
export const WINDOW_YEARS = 8;
const PRIOR = 2;
const ITERATIONS = 40;
const MAX_LAMBDA = 5;

const DAY_MS = 86_400_000;

// `games` in any order; only those in the WINDOW_YEARS before `now` count.
export function fitInternational(games: IntlGame[], now: Date, opts: { halfLife?: number; prior?: number; windowYears?: number } = {}): IntlFit {
  const from = new Date(now.getTime() - (opts.windowYears ?? WINDOW_YEARS) * 365 * DAY_MS).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const used = games.filter((g) => g.date >= from && g.date < today);
  const prior = opts.prior ?? PRIOR;
  const weights = used.map((g) => {
    const age = (now.getTime() - new Date(`${g.date}T12:00:00`).getTime()) / DAY_MS;
    return 0.5 ** (Math.max(0, age) / (opts.halfLife ?? HALF_LIFE_DAYS));
  });

  const teams = [...new Set(used.flatMap((g) => [g.home, g.away]))];
  const attack = new Map(teams.map((t) => [t, 1]));
  const defense = new Map(teams.map((t) => [t, 1]));
  const count = new Map<string, number>();
  for (const g of used) {
    count.set(g.home, (count.get(g.home) ?? 0) + 1);
    count.set(g.away, (count.get(g.away) ?? 0) + 1);
  }
  let mu = 1.3;
  let homeAdv = 1.25;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Attack: the goals a team scored against what it was expected to score.
    const scored = new Map<string, number>();
    const expected = new Map<string, number>();
    used.forEach((g, i) => {
      const w = weights[i];
      const adv = g.neutral ? 1 : homeAdv;
      scored.set(g.home, (scored.get(g.home) ?? 0) + w * g.hg);
      expected.set(g.home, (expected.get(g.home) ?? 0) + w * mu * defense.get(g.away)! * adv);
      scored.set(g.away, (scored.get(g.away) ?? 0) + w * g.ag);
      expected.set(g.away, (expected.get(g.away) ?? 0) + w * mu * defense.get(g.home)!);
    });
    for (const t of teams) attack.set(t, ((scored.get(t) ?? 0) + prior) / ((expected.get(t) ?? 0) + prior));

    // Defence: the goals a team conceded against what it was expected to concede.
    const conceded = new Map<string, number>();
    const exp2 = new Map<string, number>();
    used.forEach((g, i) => {
      const w = weights[i];
      const adv = g.neutral ? 1 : homeAdv;
      conceded.set(g.home, (conceded.get(g.home) ?? 0) + w * g.ag);
      exp2.set(g.home, (exp2.get(g.home) ?? 0) + w * mu * attack.get(g.away)!);
      conceded.set(g.away, (conceded.get(g.away) ?? 0) + w * g.hg);
      exp2.set(g.away, (exp2.get(g.away) ?? 0) + w * mu * attack.get(g.home)! * adv);
    });
    for (const t of teams) defense.set(t, ((conceded.get(t) ?? 0) + prior) / ((exp2.get(t) ?? 0) + prior));

    // The overall level, and what playing at home adds.
    let goals = 0;
    let modelled = 0;
    let homeGoals = 0;
    let homeModelled = 0;
    used.forEach((g, i) => {
      const w = weights[i];
      const adv = g.neutral ? 1 : homeAdv;
      const lh = mu * attack.get(g.home)! * defense.get(g.away)! * adv;
      const la = mu * attack.get(g.away)! * defense.get(g.home)!;
      goals += w * (g.hg + g.ag);
      modelled += w * (lh + la);
      if (!g.neutral) {
        homeGoals += w * g.hg;
        homeModelled += w * (lh / adv);
      }
    });
    const scale = modelled > 0 ? goals / modelled : 1;
    mu *= scale;
    // What was modelled for the home sides scales with mu, so it is measured with the new one.
    if (homeModelled > 0) homeAdv = Math.min(2, Math.max(1, homeGoals / (homeModelled * scale)));
  }
  return { attack, defense, games: count, mu, homeAdv };
}

// The model's view of a game between two national teams. `ratio` shifts the
// balance by hand, like in the leagues; a neutral venue takes the home advantage
// away. Teams the fit has never seen count as average.
export function predictInternational(
  fit: IntlFit,
  home: string,
  away: string,
  opts: { neutral?: boolean; ratio?: number } = {}
): Prediction {
  const adv = opts.neutral ? 1 : fit.homeAdv;
  const ratio = opts.ratio ?? 1;
  const ah = fit.attack.get(home) ?? 1;
  const dh = fit.defense.get(home) ?? 1;
  const aa = fit.attack.get(away) ?? 1;
  const da = fit.defense.get(away) ?? 1;
  // Multiplying an excellent attack by a terrible defence overshoots (9.7 goals
  // for Spain against San Marino): no side is expected to score more than this.
  const lambdaHome = Math.min(MAX_LAMBDA, fit.mu * ah * da * adv * ratio);
  const lambdaAway = Math.min(MAX_LAMBDA, (fit.mu * aa * dh) / ratio);
  return predictionFromLambdas(lambdaHome, lambdaAway, 0.44, fit.games.get(home) ?? 0, fit.games.get(away) ?? 0);
}
