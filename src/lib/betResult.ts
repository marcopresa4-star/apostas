import type { BetStatus } from "./database.types";

// A half result settles each half of the stake separately: "meia ganha" wins
// one half and gets the other back, "meia perdida" loses one half and gets the
// other back. So they count as half a Green / half a Red, and the returned
// half is counted nowhere (exactly like a Devolvida).
export function greenWeight(status: BetStatus): number {
  if (status === "green") return 1;
  if (status === "half_green") return 0.5;
  return 0;
}

export function redWeight(status: BetStatus): number {
  if (status === "red") return 1;
  if (status === "half_red") return 0.5;
  return 0;
}

export function sumGreen(picks: { status: BetStatus }[]): number {
  return picks.reduce((total, p) => total + greenWeight(p.status), 0);
}

export function sumRed(picks: { status: BetStatus }[]): number {
  return picks.reduce((total, p) => total + redWeight(p.status), 0);
}

// 12 stays "12", 12.5 becomes "12,5".
export function formatCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}
