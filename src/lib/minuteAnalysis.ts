import type { BetStatus, BetType, PickStage } from "./database.types";
import { greenWeight, redWeight } from "./betResult";

// The stretches of a game a live entry falls into. The last one is everything
// past 90' (added time and extra time).
const BUCKETS = [
  { label: "0–15'", from: 0, to: 15 },
  { label: "16–30'", from: 16, to: 30 },
  { label: "31–45'", from: 31, to: 45 },
  { label: "46–60'", from: 46, to: 60 },
  { label: "61–75'", from: 61, to: 75 },
  { label: "76–90'", from: 76, to: 90 },
  { label: "90'+", from: 91, to: Infinity },
];

// Fewer resolved bets than this and a percentage says little.
export const MIN_SAMPLE = 5;

export interface MinuteBucket {
  label: string;
  // Fractional on purpose: a half win / half loss counts as 0.5.
  green: number;
  red: number;
}

interface MinuteTicket {
  picks: {
    status: BetStatus;
    stage: PickStage;
    bet_type: BetType;
    entry_minute: number | null;
  }[];
}

// How live bets you entered did depending on the game minute you entered at.
// Only single live bets with a result count (multiples stay out of the
// breakdowns, like in the other rankings). Older entries saved without a
// minute cannot be placed, so they are only counted apart.
export function buildMinuteAnalysis(tickets: MinuteTicket[]) {
  const buckets: MinuteBucket[] = BUCKETS.map((b) => ({ label: b.label, green: 0, red: 0 }));
  let withoutMinute = 0;

  for (const ticket of tickets) {
    for (const pick of ticket.picks) {
      if (pick.bet_type !== "live" || pick.stage !== "active") continue;
      const green = greenWeight(pick.status);
      const red = redWeight(pick.status);
      if (green === 0 && red === 0) continue;

      if (pick.entry_minute == null) {
        withoutMinute++;
        continue;
      }
      const index = BUCKETS.findIndex((b) => pick.entry_minute! >= b.from && pick.entry_minute! <= b.to);
      if (index < 0) continue;
      buckets[index].green += green;
      buckets[index].red += red;
    }
  }

  const resolved = buckets.reduce((n, b) => n + b.green + b.red, 0);

  // The best stretch among those with enough bets to mean something.
  let best: MinuteBucket | null = null;
  for (const b of buckets) {
    const total = b.green + b.red;
    if (total < MIN_SAMPLE) continue;
    if (best === null || b.green / total > best.green / (best.green + best.red)) best = b;
  }

  return { buckets, resolved, withoutMinute, best };
}
