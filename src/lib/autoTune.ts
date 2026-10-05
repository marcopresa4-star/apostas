// Self-tuning from the calibration log: when a market family has enough
// decided suggestions, its trust (how much the model's lift counts) shrinks
// towards what actually happened, and its value margin grows when the family
// runs hot. Below MIN_TUNE_N decided picks per family everything stays at
// the defaults, so a thin log changes nothing. Client-safe (types only from
// recommendation); the Supabase read happens in server code.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PickGroup } from "./recommendation";

export const MIN_TUNE_N = 50;

export interface GroupTune {
  n: number;
  hits: number;
  avgP: number;
  avgBase: number;
  // Multiplier on the family's TRUST (<= 1: only ever shrinks).
  trustMult: number;
  // Multiplier on the family's VALUE_MARGIN (>= 1: only ever grows).
  marginMult: number;
  tuned: boolean;
}

export interface AutoTune {
  groups: Record<PickGroup, GroupTune>;
  total: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const fresh = (): GroupTune => ({ n: 0, hits: 0, avgP: 0, avgBase: 0, trustMult: 1, marginMult: 1, tuned: false });

export function tuneFromRows(
  rows: { pick_group: string; p: number; base: number; result: string }[]
): AutoTune {
  const groups: Record<PickGroup, GroupTune> = { result: fresh(), goals: fresh(), btts: fresh(), halves: fresh() };
  const byGroup = new Map<PickGroup, { p: number; base: number; won: boolean }[]>();
  for (const r of rows) {
    if (r.result !== "won" && r.result !== "lost") continue;
    const g = r.pick_group as PickGroup;
    if (!groups[g]) continue;
    if (!Number.isFinite(r.p) || !Number.isFinite(r.base)) continue;
    const list = byGroup.get(g) ?? [];
    list.push({ p: r.p, base: r.base, won: r.result === "won" });
    byGroup.set(g, list);
  }
  let total = 0;
  for (const [g, list] of byGroup) {
    const n = list.length;
    const hits = list.filter((l) => l.won).length;
    const avgP = list.reduce((s, l) => s + l.p, 0) / n;
    const avgBase = list.reduce((s, l) => s + l.base, 0) / n;
    total += n;
    if (n < MIN_TUNE_N) {
      groups[g] = { n, hits, avgP, avgBase, trustMult: 1, marginMult: 1, tuned: false };
      continue;
    }
    // Realized lift vs predicted lift on the suggested population (voids
    // never logged as decided, so every row is won or lost).
    const predictedLift = avgP - avgBase;
    const realizedLift = hits / n - avgBase;
    const trustMult = predictedLift > 0.005 ? clamp(realizedLift / predictedLift, 0.3, 1) : 1;
    // When the family hits below what it says, demand proportionally more edge.
    const hitRate = hits / n;
    const marginMult = hitRate > 0 ? clamp(avgP / hitRate, 1, 2) : 2;
    groups[g] = { n, hits, avgP, avgBase, trustMult, marginMult, tuned: true };
  }
  return { groups, total };
}

export async function loadAutoTune(
  supabase: SupabaseClient,
  userId: string
): Promise<AutoTune | null> {
  const { data, error } = await supabase
    .from("calibration_picks")
    .select("pick_group, p, base, result")
    .eq("user_id", userId)
    .in("result", ["won", "lost"])
    .limit(5000);
  if (error || !data) return null;
  return tuneFromRows(data as { pick_group: string; p: number; base: number; result: string }[]);
}
