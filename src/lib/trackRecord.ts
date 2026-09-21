import type { BetStatus } from "./database.types";
import { greenWeight, redWeight } from "./betResult";
import { effectiveOdd, multipleStatus, lastLegDate, type MultipleLeg } from "./multiples";

// One bet as the track record sees it. `multiplier` is what the stake came
// back as once settled (2.5 pays 1.5 profit), or null when the odd is unknown.
export interface RecordBet {
  status: BetStatus;
  multiplier: number | null;
  // Kickoff (or the last game of a multiple), to put the recent ones in order.
  when: string;
}

// What a simple bet pays back per unit staked: a half win keeps half the stake
// and wins half the profit, a half loss returns half the stake.
export function payout(status: BetStatus, odd: number | null): number | null {
  switch (status) {
    case "green":
      return odd;
    case "half_green":
      return odd === null ? null : (odd + 1) / 2;
    case "half_red":
      return 0.5;
    case "void":
      return 1;
    case "red":
      return 0;
    default:
      return null;
  }
}

export function pickBet(
  pick: { status: BetStatus; odd: number | null; entry_odd: number | null },
  when: string
): RecordBet {
  return { status: pick.status, multiplier: payout(pick.status, pick.entry_odd ?? pick.odd), when };
}

// A multiple's payout is already worked out from its games.
export function multipleBet(legs: MultipleLeg[]): RecordBet {
  const status = multipleStatus(legs);
  return {
    status,
    multiplier: status === "red" ? 0 : status === "pending" ? null : effectiveOdd(legs),
    when: `${lastLegDate(legs)}T23:59`,
  };
}

export interface TrackRecord {
  settled: number; // bets with a result (a returned one counts as settled)
  pending: number;
  green: number; // half results count as half
  red: number;
  hitRate: number | null; // green / (green + red)
  // Profit in units of a flat stake of 1 per bet, over the settled bets that
  // have an odd; `withoutOdd` were left out of it.
  profit: number | null;
  roi: number | null; // profit per unit staked
  withoutOdd: number;
  recent: ("green" | "red")[]; // last results, most recent first (returned ones skipped)
}

const RECENT = 10;

export function trackRecord(bets: RecordBet[]): TrackRecord {
  let green = 0;
  let red = 0;
  let settled = 0;
  let pending = 0;
  let withoutOdd = 0;
  let profit = 0;
  let staked = 0;
  for (const b of bets) {
    if (b.status === "pending") {
      pending++;
      continue;
    }
    settled++;
    green += greenWeight(b.status);
    red += redWeight(b.status);
    if (b.multiplier === null) {
      withoutOdd++;
      continue;
    }
    profit += b.multiplier - 1;
    staked += 1;
  }
  const decided = green + red;
  const recent = bets
    .filter((b) => greenWeight(b.status) > 0 || redWeight(b.status) > 0)
    .sort((a, b) => b.when.localeCompare(a.when))
    .slice(0, RECENT)
    .map((b) => (greenWeight(b.status) > 0 ? ("green" as const) : ("red" as const)));
  return {
    settled,
    pending,
    green,
    red,
    hitRate: decided > 0 ? green / decided : null,
    profit: staked > 0 ? profit : null,
    roi: staked > 0 ? profit / staked : null,
    withoutOdd,
    recent,
  };
}
