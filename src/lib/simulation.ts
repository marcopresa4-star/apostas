// A season played out many times from here to the end, using each team's
// current strength (frozen for the whole run, as if nobody's form changed) to
// draw a random score for every game still to play. Counting how often each
// team finishes in each position gives its chances honestly, from the same
// model as the rest of the app, instead of just today's table.

import { predict, type Fixture, type PlayedMatch } from "./footballModel";
import { buildStandings } from "./standings";

export interface SimTeam {
  team: string;
  played: number;
  points: number; // as of now
  remaining: number; // games left in the data
  // Chance of finishing in each position, index 0 = 1st place, summing to ~1.
  positions: number[];
  title: number; // positions[0]
  top3: number;
  lastThree: number;
  avgPoints: number; // expected final total
  avgPosition: number;
}

export interface SeasonSimulation {
  trials: number;
  teams: SimTeam[]; // in the current table's order
}

// Knuth's method: fine for the goal counts a game has (means well under 10).
function poissonSample(lambda: number, rand: () => number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > limit);
  return k - 1;
}

const DEFAULT_TRIALS = 3000;

// `fixtures` is a season's full calendar (played and to come); `matches` is
// what `predict` draws on. Each remaining game's expected goals are worked out
// once, from today's strengths, and then only the score is redrawn every trial
// (cheap), so this stays fast for a whole season of fixtures.
export function simulateSeason(
  fixtures: Fixture[],
  matches: PlayedMatch[],
  now: Date,
  options: { trials?: number; rand?: () => number } = {}
): SeasonSimulation | null {
  const trials = options.trials ?? DEFAULT_TRIALS;
  const rand = options.rand ?? Math.random;

  const current = buildStandings(fixtures);
  if (current.length === 0) return null;
  const teams = current.map((r) => r.team);
  const n = teams.length;
  const index = new Map(teams.map((t, i) => [t, i]));

  const games = fixtures
    .filter((f) => !f.ft && index.has(f.team1) && index.has(f.team2))
    .map((f) => {
      const p = predict(matches, f.team1, f.team2, now);
      return { home: index.get(f.team1)!, away: index.get(f.team2)!, lh: p.lambdaHome, la: p.lambdaAway };
    });

  const remainingCount = new Array(n).fill(0);
  for (const g of games) {
    remainingCount[g.home]++;
    remainingCount[g.away]++;
  }

  const basePoints = current.map((r) => r.points);
  const baseGoalDiff = current.map((r) => r.gd);
  const baseGf = current.map((r) => r.gf);

  const posCount: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const pointsSum = new Array(n).fill(0);

  const pts = new Array<number>(n);
  const gd = new Array<number>(n);
  const gf = new Array<number>(n);
  const order = new Array<number>(n);
  for (let i = 0; i < n; i++) order[i] = i;

  for (let t = 0; t < trials; t++) {
    for (let i = 0; i < n; i++) {
      pts[i] = basePoints[i];
      gd[i] = baseGoalDiff[i];
      gf[i] = baseGf[i];
    }
    for (const g of games) {
      const hg = poissonSample(g.lh, rand);
      const ag = poissonSample(g.la, rand);
      gf[g.home] += hg;
      gf[g.away] += ag;
      gd[g.home] += hg - ag;
      gd[g.away] += ag - hg;
      if (hg > ag) pts[g.home] += 3;
      else if (hg === ag) {
        pts[g.home] += 1;
        pts[g.away] += 1;
      } else pts[g.away] += 3;
    }
    // Same tie-break as the standings table: points, goal difference, goals scored, name.
    order.sort((a, b) => pts[b] - pts[a] || gd[b] - gd[a] || gf[b] - gf[a] || teams[a].localeCompare(teams[b]));
    for (let rank = 0; rank < n; rank++) {
      const i = order[rank];
      posCount[i][rank]++;
      pointsSum[i] += pts[i];
    }
  }

  const results: SimTeam[] = current.map((r, i) => {
    const positions = posCount[i].map((c) => c / trials);
    const avgPosition = positions.reduce((s, p, k) => s + p * (k + 1), 0);
    return {
      team: r.team,
      played: r.played,
      points: r.points,
      remaining: remainingCount[i],
      positions,
      title: positions[0] ?? 0,
      top3: positions.slice(0, 3).reduce((s, p) => s + p, 0),
      lastThree: positions.slice(Math.max(0, n - 3)).reduce((s, p) => s + p, 0),
      avgPoints: pointsSum[i] / trials,
      avgPosition,
    };
  });

  return { trials, teams: results };
}
