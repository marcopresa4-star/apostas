import { fairOdd, predict, type Fixture, type Prediction } from "./footballModel";
import type { LeagueData } from "./footballData";
import { upcomingRounds } from "./rounds";
import { VALUE_MARGIN, baseRates, candidatesFor, type BaseRates, type Candidate, type PickGroup } from "./recommendation";

// Fewer games than this in the data for a team and its games are left out.
const FEW = 8;

// Picking the most probable bet of each game and then the highest of all keeps
// the ones the model overrates. Tested on 2025/26 (2,933 such bets in 18
// leagues): together they came off 58.1% against the 57.7% the model said, but
// the top 5 of each week came off 56.4% against 62.1% (top 10: 57.6% against
// 61.8%), and no more often than the rest. So the "worth it from" odd is worked
// out from 93% of the chance instead of all of it.
export const TOP_HAIRCUT = 0.93;

// The most probable bet of a game that still pays at least `minOdd` by the
// model's own reckoning (its fair odd, 1 over the chance). There are no real
// bookmaker odds here, so this is the ceiling on the chance: a fair odd of 1.60
// is a 62.5% chance, and what a bookmaker really pays is a bit lower.
export function bestBet(
  prediction: Prediction,
  base: BaseRates,
  home: string,
  away: string,
  minOdd: number
): Candidate | null {
  let best: Candidate | null = null;
  for (const c of candidatesFor(prediction, base, home, away)) {
    if (fairOdd(c.p) < minOdd) continue;
    if (best === null || c.p > best.p) best = c;
  }
  return best;
}

export interface TopBet {
  leagueCode: string;
  leagueLabel: string;
  round: string;
  fixture: Fixture;
  group: PickGroup;
  label: string;
  p: number;
  fairOdd: number;
  // The odd from which it would be worth it: the fair odd of the chance cut back
  // by TOP_HAIRCUT, plus the usual margin.
  minOdd: number;
  base: number; // how often it happens in that league
}

export interface TopBets {
  bets: TopBet[];
  games: number; // games looked at (still to play, with enough data)
  leagues: number; // leagues with a round still to come
}

// The `count` most probable bets, one per game, among the games of each league's
// nearest round that pay at least `minOdd`.
export function topBets(
  leagues: { code: string; label: string; data: LeagueData }[],
  today: string,
  now: Date,
  options: { minOdd: number; count: number }
): TopBets {
  const all: TopBet[] = [];
  let games = 0;
  let withRound = 0;
  for (const league of leagues) {
    const round = upcomingRounds(league.data.fixtures, today)[0];
    if (!round) continue;
    withRound++;
    const base = baseRates(league.data.matches);
    for (const fixture of round.fixtures) {
      // Only games still to be played.
      if (fixture.ft || fixture.date < today) continue;
      const prediction = predict(league.data.matches, fixture.team1, fixture.team2, now);
      if (Math.min(prediction.gamesHome, prediction.gamesAway) < FEW) continue;
      games++;
      const best = bestBet(prediction, base, fixture.team1, fixture.team2, options.minOdd);
      if (!best) continue;
      all.push({
        leagueCode: league.code,
        leagueLabel: league.label,
        round: round.name,
        fixture,
        group: best.group,
        label: best.label,
        p: best.p,
        fairOdd: fairOdd(best.p),
        minOdd: fairOdd(best.p * TOP_HAIRCUT) * (1 + VALUE_MARGIN),
        base: best.base,
      });
    }
  }
  return { bets: all.sort((a, b) => b.p - a.p).slice(0, options.count), games, leagues: withRound };
}
