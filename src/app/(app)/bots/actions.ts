"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BotMarket, BotMode, BotPeriod, BotStat, GoalCmp, GoalRules, PregameAvgStat, PregameFavState, PregameRow, PregameRule, PregameSide } from "@/lib/bots";
import { BOT_MARKETS, BOT_SCORES, BOT_STATS, PREGAME_AVG_STATS, PREGAME_FAV_STATES, PREGAME_METRICS } from "@/lib/bots";

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  return { supabase, user };
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown, lo: number, hi: number, fb: number): number => {
  const n = num(v);
  return n === null ? fb : Math.min(hi, Math.max(lo, Math.trunc(n)));
};

// Validates a bot draft from the form (create and edit share it).
interface CleanBot {
  name: string;
  mode: BotMode;
  leagues: string[];
  minute_from: number;
  minute_to: number;
  period: BotPeriod;
  score: string;
  market: BotMarket;
  min_prob: number | null;
  min_odd: number | null;
  stats: BotStat[];
  pregame: PregameRow[];
  goal_rules: GoalRules;
  silent: boolean;
  refire: boolean;
  enabled: boolean;
}

function clean(input: Record<string, unknown>): CleanBot | { error: string } {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 40) : "";
  if (!name) return { error: "Dá um nome ao bot." };
  const mode: BotMode = input.mode === "or" ? "or" : "and";
  const leagues = Array.isArray(input.leagues) ? input.leagues.filter((l): l is string => typeof l === "string").slice(0, 40) : [];
  const minute_from = int(input.minute_from, 1, 120, 1);
  const minute_to = int(input.minute_to, 1, 120, 90);
  if (minute_from > minute_to) return { error: "O minuto inicial é depois do final." };
  const period: BotPeriod = ["first", "second", "half"].includes(String(input.period)) ? (input.period as BotPeriod) : "any";
  const score = BOT_SCORES.some((s) => s.key === input.score) ? String(input.score) : "any";
  const market: BotMarket = BOT_MARKETS.some((m) => m.key === input.market) ? (input.market as BotMarket) : "mais1";
  const min_prob_raw = num(input.min_prob);
  const min_prob = min_prob_raw === null ? null : Math.min(0.95, Math.max(0.35, min_prob_raw));
  const min_odd_raw = num(input.min_odd);
  const min_odd = min_odd_raw === null ? null : Math.min(20, Math.max(1.01, min_odd_raw));
  const statKeys = new Set(BOT_STATS.map((s) => s.k));
  const stats: BotStat[] = Array.isArray(input.stats)
    ? (input.stats as unknown[]).flatMap((s): BotStat[] => {
        if (typeof s !== "object" || s === null) return [];
        const r = s as Record<string, unknown>;
        if (typeof r.k !== "string" || !statKeys.has(r.k)) return [];
        const v = num(r.v);
        if (v === null || v < 0 || v > 100) return [];
        return [{ k: r.k, v }];
      }).slice(0, 14)
    : [];
  const metrics = new Set<string>(PREGAME_METRICS.map((m) => m.key));
  // «Antes do jogo»: hist rows (old bots, no kind), avg and odd rules.
  // Malformed rows drop out instead of failing the whole save.
  const sideOf = (v: unknown): PregameSide | null =>
    v === "home" || v === "away" || v === "either" ? v : null;
  const avgStats = new Set<string>(PREGAME_AVG_STATS.map((m) => m.key));
  const floatOf = (v: unknown, lo: number, hi: number, fb: number): number => {
    const n = num(v);
    return n === null ? fb : Math.min(hi, Math.max(lo, Math.round(n * 100) / 100));
  };
  const pregame: PregameRow[] = Array.isArray(input.pregame)
    ? (input.pregame as unknown[]).flatMap((r): PregameRow[] => {
        if (typeof r !== "object" || r === null) return [];
        const q = r as Record<string, unknown>;
        if (q.kind === "avg") {
          const side = sideOf(q.side);
          if (!side || typeof q.metric !== "string" || !avgStats.has(q.metric)) return [];
          return [{
            kind: "avg",
            side,
            metric: q.metric as PregameAvgStat,
            n: 10,
            cmp: q.cmp === "lte" ? "lte" : "gte",
            v: floatOf(q.v, 0, 40, 5),
          }];
        }
        if (q.kind === "odd") {
          const which = q.which === "home" || q.which === "away" || q.which === "fav" ? q.which : null;
          if (!which) return [];
          const states = new Set<string>(PREGAME_FAV_STATES.map((s) => s.key));
          return [{
            kind: "odd",
            which,
            cmp: q.cmp === "gte" ? "gte" : "lte",
            v: floatOf(q.v, 1, 20, 1.6),
            favState: states.has(String(q.favState)) ? (q.favState as PregameFavState) : "any",
          }];
        }
        if (typeof r === "object" && r !== null) {
          const side = sideOf((r as Record<string, unknown>).side);
          if (!side || typeof (r as Record<string, unknown>).metric !== "string" || !metrics.has((r as Record<string, unknown>).metric as string)) return [];
          const n = (r as Record<string, unknown>).n === 5 || (r as Record<string, unknown>).n === 20 ? (r as Record<string, unknown>).n as number : 10;
          return [{ side, metric: (r as Record<string, unknown>).metric as PregameRule["metric"], n, pct: int((r as Record<string, unknown>).pct, 10, 100, 60) }];
        }
        return [];
      }).slice(0, 6)
    : [];
  // The 4 goal filters (total, difference, per half): unknown or malformed
  // keys fall back to neutral, so old drafts keep firing as before.
  const goalsRaw = typeof input.goals === "object" && input.goals !== null ? (input.goals as Record<string, unknown>) : null;
  const cmpOf = (v: unknown, allowed: GoalCmp[], fb: GoalCmp): GoalCmp =>
    allowed.includes(String(v) as GoalCmp) ? (v as GoalCmp) : fb;
  const valOf = (v: unknown, fb: number): number => (num(v) === null ? fb : Math.min(20, Math.max(0, Math.trunc(num(v) as number))));
  const goal_rules: GoalRules = {
      total: cmpOf(goalsRaw?.total, ["any", "lt", "gte"], "any"),
      totalV: valOf(goalsRaw?.totalV, 3),
      diff: cmpOf(goalsRaw?.diff, ["any", "lt", "gte"], "any"),
      diffV: valOf(goalsRaw?.diffV, 3),
      fh: cmpOf(goalsRaw?.fh, ["any", "exact", "lt", "gte"], "any"),
      fhV: valOf(goalsRaw?.fhV, 1),
      sh: cmpOf(goalsRaw?.sh, ["any", "exact", "lt", "gte"], "any"),
      shV: valOf(goalsRaw?.shV, 0),
    };
  return {
    name,
    mode,
    leagues,
    minute_from,
    minute_to,
    period,
    score,
    market,
    min_prob,
    min_odd,
    stats,
    pregame,
    goal_rules,
    silent: input.silent === true,
    refire: input.refire === true,
    enabled: input.enabled !== false,
  };
}

export async function saveBotAction(
  id: string | null,
  input: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user } = await authed();
  const cleanBot = clean(input);
  if ("error" in cleanBot) return { ok: false, error: cleanBot.error };
  if (id) {
    const { error } = await supabase.from("bots").update(cleanBot).eq("user_id", user.id).eq("id", id);
    if (error) return { ok: false, error: "Não foi possível guardar." };
  } else {
    const { error } = await supabase.from("bots").insert({ ...cleanBot, user_id: user.id });
    if (error) return { ok: false, error: "Não foi possível guardar (migração 0039 corrida?)." };
  }
  revalidatePath("/bots");
  return { ok: true };
}

export async function toggleBotAction(id: string, enabled: boolean): Promise<void> {
  const { supabase, user } = await authed();
  await supabase.from("bots").update({ enabled }).eq("user_id", user.id).eq("id", id);
  revalidatePath("/bots");
}

export async function deleteBotAction(id: string): Promise<void> {
  const { supabase, user } = await authed();
  await supabase.from("bots").delete().eq("user_id", user.id).eq("id", id);
  revalidatePath("/bots");
}

// Test template: fires on ANY live game (minute 1–90, no thresholds), so the
// user can check the alert pipeline end to end. One alert per game.
export async function createTestBotAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  return saveBotAction(null, {
    name: "🔔 Teste de alertas",
    mode: "and",
    leagues: [],
    minute_from: 1,
    minute_to: 90,
    period: "any",
    score: "any",
    market: "mais1",
    min_prob: null,
    min_odd: null,
    stats: [],
    pregame: [],
    silent: false,
    refire: false,
    enabled: true,
  });
}

export async function clearAlertsAction(): Promise<void> {
  const { supabase, user } = await authed();
  await supabase.from("bot_alerts").delete().eq("user_id", user.id);
  revalidatePath("/bots");
}
