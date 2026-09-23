import type { BetStatus, BetType } from "./database.types";
import { greenWeight, redWeight } from "./betResult";
import { isMatchOver } from "./matchStatus";

export interface MultipleLeg {
  id: string;
  selection: string;
  odd: number;
  status: BetStatus;
  entry_minute: number | null;
  match_date: string;
  match_time: string;
  competition: { name: string; country: { name: string } | null } | null;
  // Other names of a club, separated by " | ": the live widget looks it up
  // by all of them.
  home_team: { id: string; name: string; aliases?: string | null } | null;
  away_team: { id: string; name: string; aliases?: string | null } | null;
  category: { name: string } | null;
}

export interface MultipleRow {
  id: string;
  bet_type: BetType;
  reason: string | null;
  // Left out of the Comunidade queries on purpose: they stay private.
  bookmaker_url?: string | null;
  is_published?: boolean;
  legs: MultipleLeg[];
}

const LEG_SELECT = `id, selection, odd, status, entry_minute, match_date, match_time,
    competition:competitions(id, name, country:countries(name)),
    home_team:teams!multiple_legs_home_team_id_fkey(id, name, aliases),
    away_team:teams!multiple_legs_away_team_id_fkey(id, name, aliases),
    category:bet_categories(id, name)`;

// Same joins for every page that lists your own multiples.
export const MULTIPLE_SELECT = `id, bet_type, reason, bookmaker_url, is_published,
  legs:multiple_legs(${LEG_SELECT})`;

// What the Comunidade may see: no bookmaker link.
export const PUBLIC_MULTIPLE_SELECT = `id, bet_type, reason, legs:multiple_legs(${LEG_SELECT})`;

const round2 = (n: number) => Math.round(n * 100) / 100;

// The odd the multiple was placed at: every leg's odd multiplied together.
export function totalOdd(odds: number[]): number {
  return round2(odds.reduce((product, odd) => product * odd, 1));
}

// What each leg actually multiplies the stake by once it is settled. A returned
// leg drops out (x1), half a win pays half the profit, half a loss gives half
// the stake back. A lost leg keeps its odd: the multiple is already lost.
function legFactor(leg: Pick<MultipleLeg, "odd" | "status">): number {
  switch (leg.status) {
    case "void":
      return 1;
    case "half_green":
      return (leg.odd + 1) / 2;
    case "half_red":
      return 0.5;
    default:
      return leg.odd;
  }
}

export function placedOdd(legs: Pick<MultipleLeg, "odd">[]): number {
  return totalOdd(legs.map((l) => l.odd));
}

// The odd after returned and half results are taken into account; equals
// placedOdd when every leg was a plain win (or is still open).
export function effectiveOdd(legs: Pick<MultipleLeg, "odd" | "status">[]): number {
  return round2(legs.reduce((product, leg) => product * legFactor(leg), 1));
}

// The multiple's result, worked out from its legs:
//  - one lost leg loses the whole multiple, even if others are still open;
//  - otherwise it stays pending until every leg is settled;
//  - all legs returned means the stake comes back;
//  - a half result on any leg makes the whole thing a half result (a half loss
//    wins over a half win).
export function multipleStatus(legs: Pick<MultipleLeg, "status">[]): BetStatus {
  if (legs.length === 0) return "pending";
  if (legs.some((l) => l.status === "red")) return "red";
  if (legs.some((l) => l.status === "pending")) return "pending";
  if (legs.every((l) => l.status === "void")) return "void";
  if (legs.some((l) => l.status === "half_red")) return "half_red";
  if (legs.some((l) => l.status === "half_green")) return "half_green";
  return "green";
}

function legKickoff(leg: Pick<MultipleLeg, "match_date" | "match_time">): string {
  return `${leg.match_date}T${leg.match_time}`;
}

// The multiple belongs to the day its last game is played: that is when it is
// settled, and the day it counts on in the calendar.
export function lastLegDate(legs: Pick<MultipleLeg, "match_date">[]): string {
  return legs.reduce((last, l) => (l.match_date > last ? l.match_date : last), "");
}

export function firstLegKickoff(legs: Pick<MultipleLeg, "match_date" | "match_time">[]): string {
  return legs.map(legKickoff).sort()[0] ?? "";
}

// 2 -> "2,00", the way odds are written elsewhere.
export function formatOdd(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

// A multiple is over once every one of its games is (same time window the
// "Em direto" badge uses).
export function isMultipleOver(legs: Pick<MultipleLeg, "match_date" | "match_time">[], now: Date) {
  return legs.every((l) => isMatchOver(l.match_date, l.match_time, false, now));
}

// Adds multiples to a calendar's day stats: each counts as one bet on the day
// of its last game, and gets listed under that day. They stay out of the team,
// competition and bet type rankings on purpose (the result belongs to the whole
// combination, not to any one team). Never mutates `dayStats`.
export function withMultiples(
  dayStats: Record<string, { green: number; red: number }>,
  multiples: MultipleRow[]
) {
  const stats = { ...dayStats };
  const byDay: Record<string, MultipleRow[]> = {};
  let hasResolved = false;

  for (const multiple of multiples) {
    const day = lastLegDate(multiple.legs);
    if (!day) continue;
    (byDay[day] ??= []).push(multiple);

    const status = multipleStatus(multiple.legs);
    const green = greenWeight(status);
    const red = redWeight(status);
    if (green === 0 && red === 0) continue;
    hasResolved = true;
    const entry = stats[day] ?? { green: 0, red: 0 };
    stats[day] = { green: entry.green + green, red: entry.red + red };
  }

  return { dayStats: stats, multiplesByDay: byDay, hasResolved };
}
