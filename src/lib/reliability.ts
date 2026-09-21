import { predict, type PlayedMatch } from "./footballModel";
import { baseRates, recommend } from "./recommendation";

// Whether the model deserves trust, from its own record: every game in a window
// of dates is predicted using only the games before it, and the prediction is
// compared with what happened and with a naive guess (the league's usual rates
// up to that day).

export interface Reliability {
  games: number;
  // Who wins (home, draw, away).
  accuracy: number;
  baselineAccuracy: number; // always guessing the league's most common result
  logLoss: number; // lower is better
  baselineLogLoss: number;
  // Over 2.5 goals and both teams to score: mean squared error, lower is better.
  over25: number;
  baselineOver25: number;
  btts: number;
  baselineBtts: number;
  // The main suggested bet: how many were made, how often they came off, what
  // the model said they would, and how often the same kind of bet comes off in
  // the league in general.
  picks: { count: number; hitRate: number; claimed: number; leagueRate: number };
}

const FEW = 8;

// `matches` in date order; the games with date from..to (inclusive) are tested.
export function backtest(matches: PlayedMatch[], from: string, to: string): Reliability | null {
  let games = 0;
  let hit = 0;
  let baseHit = 0;
  let ll = 0;
  let baseLl = 0;
  let over = 0;
  let baseOver = 0;
  let both = 0;
  let baseBoth = 0;
  const picks = { count: 0, hit: 0, claimed: 0, league: 0 };

  matches.forEach((m, index) => {
    if (m.date < from || m.date > to || index === 0) return;
    // Everything strictly before this game's date: games on the same day are not known yet.
    let end = index;
    while (end > 0 && matches[end - 1].date >= m.date) end--;
    if (end === 0) return;
    const past = matches.slice(0, end);
    const now = new Date(`${m.date}T12:00:00`);

    const p = predict(past, m.team1, m.team2, now);
    const base = baseRates(past);
    const outcome = m.ft[0] > m.ft[1] ? "home" : m.ft[0] === m.ft[1] ? "draw" : "away";
    const model = { home: p.fullTime.home, draw: p.fullTime.draw, away: p.fullTime.away };
    const naive = { home: base.home, draw: base.draw, away: base.away };
    const best = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];

    games++;
    ll += -Math.log(model[outcome]);
    baseLl += -Math.log(naive[outcome]);
    if (best(model) === outcome) hit++;
    if (best(naive) === outcome) baseHit++;

    const isOver = m.ft[0] + m.ft[1] > 2 ? 1 : 0;
    const isBoth = m.ft[0] > 0 && m.ft[1] > 0 ? 1 : 0;
    over += (p.over["2.5"] - isOver) ** 2;
    baseOver += (base.over["2.5"] - isOver) ** 2;
    both += (p.bothScore - isBoth) ** 2;
    baseBoth += (base.btts - isBoth) ** 2;

    if (Math.min(p.gamesHome, p.gamesAway) >= FEW) {
      const main = recommend(p, base, m.team1, m.team2)[0];
      if (main) {
        picks.count++;
        picks.hit += main.won(m.ft) ? 1 : 0;
        picks.claimed += main.p;
        picks.league += main.base;
      }
    }
  });

  if (games === 0) return null;
  return {
    games,
    accuracy: hit / games,
    baselineAccuracy: baseHit / games,
    logLoss: ll / games,
    baselineLogLoss: baseLl / games,
    over25: over / games,
    baselineOver25: baseOver / games,
    btts: both / games,
    baselineBtts: baseBoth / games,
    picks: {
      count: picks.count,
      hitRate: picks.count ? picks.hit / picks.count : 0,
      claimed: picks.count ? picks.claimed / picks.count : 0,
      leagueRate: picks.count ? picks.league / picks.count : 0,
    },
  };
}

// How much better (positive) or worse (negative) than the naive guess, in %.
export function gain(model: number, baseline: number): number {
  return baseline === 0 ? 0 : ((baseline - model) / baseline) * 100;
}

// The record of several leagues as one, each weighted by its number of games
// (and the suggested bets by their number).
export function combine(list: Reliability[]): Reliability | null {
  const games = list.reduce((n, r) => n + r.games, 0);
  if (games === 0) return null;
  const avg = (value: (r: Reliability) => number) =>
    list.reduce((sum, r) => sum + value(r) * r.games, 0) / games;
  const count = list.reduce((n, r) => n + r.picks.count, 0);
  const avgPicks = (value: (r: Reliability) => number) =>
    count === 0 ? 0 : list.reduce((sum, r) => sum + value(r) * r.picks.count, 0) / count;
  return {
    games,
    accuracy: avg((r) => r.accuracy),
    baselineAccuracy: avg((r) => r.baselineAccuracy),
    logLoss: avg((r) => r.logLoss),
    baselineLogLoss: avg((r) => r.baselineLogLoss),
    over25: avg((r) => r.over25),
    baselineOver25: avg((r) => r.baselineOver25),
    btts: avg((r) => r.btts),
    baselineBtts: avg((r) => r.baselineBtts),
    picks: {
      count,
      hitRate: avgPicks((r) => r.picks.hitRate),
      claimed: avgPicks((r) => r.picks.claimed),
      leagueRate: avgPicks((r) => r.picks.leagueRate),
    },
  };
}
