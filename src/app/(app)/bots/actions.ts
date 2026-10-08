"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BotMarket, BotMode, BotPeriod, BotStat, PregameRule } from "@/lib/bots";
import { BOT_MARKETS, BOT_SCORES, BOT_STATS, PREGAME_METRICS } from "@/lib/bots";

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
  pregame: PregameRule[];
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
  const pregame: PregameRule[] = Array.isArray(input.pregame)
    ? (input.pregame as unknown[]).flatMap((r): PregameRule[] => {
        if (typeof r !== "object" || r === null) return [];
        const q = r as Record<string, unknown>;
        if (q.side !== "home" && q.side !== "away" && q.side !== "either") return [];
        if (typeof q.metric !== "string" || !metrics.has(q.metric)) return [];
        return [{ side: q.side, metric: q.metric as PregameRule["metric"], n: 10, pct: int(q.pct, 10, 95, 60) }];
      }).slice(0, 4)
    : [];
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
