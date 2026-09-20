import type { BetStatus, PickStage } from "./database.types";
import { greenWeight, redWeight } from "./betResult";
import { withMultiples, type MultipleRow } from "./multiples";

// Green / red per day for the History calendars of Apostas and Live: every
// pick you entered counts on its game's day, and each multiple counts once on
// the day of its last game. Pending, returned and never-entered picks colour
// nothing, exactly like the Análise calendar.
export function historyDayStats(
  tickets: { match_date: string; picks: { status: BetStatus; stage: PickStage }[] }[],
  multiples: MultipleRow[]
): Record<string, { green: number; red: number }> {
  const stats: Record<string, { green: number; red: number }> = {};

  for (const ticket of tickets) {
    for (const pick of ticket.picks) {
      if (pick.stage !== "active") continue;
      const green = greenWeight(pick.status);
      const red = redWeight(pick.status);
      if (green === 0 && red === 0) continue;
      const entry = stats[ticket.match_date] ?? { green: 0, red: 0 };
      stats[ticket.match_date] = { green: entry.green + green, red: entry.red + red };
    }
  }

  return withMultiples(stats, multiples).dayStats;
}
