import { isMatchOver } from "./matchStatus";

// A bet still without a result: a simple bet you entered, or one game of a
// multiple.
export interface OpenBet {
  id: string;
  kind: "pick" | "leg";
  match_date: string;
  match_time: string;
  live_ended: boolean;
  competition: string;
  home: string;
  away: string;
  selection: string;
  odd: number | null;
  live: boolean;
  // The two teams' own names plus any other names they go by, for matching
  // against the free result data.
  homeNames: string[];
  awayNames: string[];
  // Looked up in the data we already have, when the game is old enough to be
  // in it: the real final score (home first), and, only for the plainest
  // wordings, whether the bet came off. Both null until looked up or not found.
  actualScore?: [number, number] | null;
  suggestion?: "green" | "red" | null;
}

// The open bets whose game is already over (by hand or by the clock), the
// oldest game first: the ones waiting for you to mark the result.
export function unsettledBets(open: OpenBet[], now: Date): OpenBet[] {
  return open
    .filter((b) => isMatchOver(b.match_date, b.match_time, b.live_ended, now))
    .sort((a, b) => `${a.match_date}T${a.match_time}`.localeCompare(`${b.match_date}T${b.match_time}`));
}
