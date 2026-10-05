// Club Elo ratings from league results: standard Elo update (K=20, home edge
// +50) over every game in the data, oldest first. Each team's curve is its
// rating after each of its own last games. Pure math, client-safe.
import type { PlayedMatch } from "./footballModel";

const START = 1500;
const K = 20;
const HOME_EDGE = 50;

export interface EloPoint {
  date: string;
  elo: number;
  opponent: string;
  atHome: boolean;
  gf: number;
  ga: number;
  // Rating change from this game (vs the previous point, or vs 1500 first).
  delta: number;
}

const expected = (a: number, b: number): number => 1 / (1 + Math.pow(10, -(a - b) / 400));

// Rating of every team after walking the whole pool, plus each side's curve
// (last `limit` of its own games). One pass: opponents' ratings evolve in the
// same walk, like a real Elo table would.
export function eloCurves(
  pool: PlayedMatch[],
  home: string,
  away: string,
  limit = 10
): { home: EloPoint[]; away: EloPoint[] } {
  const sorted = [...pool].sort((a, b) => a.date.localeCompare(b.date));
  const rating = new Map<string, number>();
  const curves = new Map<string, EloPoint[]>();
  const get = (t: string): number => rating.get(t) ?? START;
  for (const m of sorted) {
    const rh = get(m.team1);
    const ra = get(m.team2);
    const scoreHome = m.ft[0] > m.ft[1] ? 1 : m.ft[0] === m.ft[1] ? 0.5 : 0;
    const expHome = expected(rh + HOME_EDGE, ra);
    const nextH = rh + K * (scoreHome - expHome);
    const nextA = ra + K * ((1 - scoreHome) - (1 - expHome));
    rating.set(m.team1, nextH);
    rating.set(m.team2, nextA);
    const push = (team: string, value: number, before: number, foe: string, atHome: boolean, gf: number, ga: number): void => {
      const curve = curves.get(team) ?? [];
      curve.push({
        date: m.date,
        elo: Math.round(value),
        opponent: foe,
        atHome,
        gf,
        ga,
        delta: Math.round((value - before) * 10) / 10,
      });
      curves.set(team, curve);
    };
    push(m.team1, nextH, rh, m.team2, true, m.ft[0], m.ft[1]);
    push(m.team2, nextA, ra, m.team1, false, m.ft[1], m.ft[0]);
  }
  const take = (team: string): EloPoint[] => (curves.get(team) ?? []).slice(-limit);
  return { home: take(home), away: take(away) };
}
