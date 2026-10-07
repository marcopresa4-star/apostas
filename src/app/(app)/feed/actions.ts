"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseSofascoreId } from "@/lib/sofascore";
import { sofaRaw } from "@/lib/sofaRaw";
import { FEED_MAX } from "@/lib/feed";

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  return { supabase, user };
}

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Json) : null;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function addFeedGameAction(input: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user } = await authed();
  const eventId = parseSofascoreId(input.trim());
  if (!eventId) return { ok: false, error: "Não encontrei o id do jogo (cola o link do SofaScore ou id:123…)." };
  const { count } = await supabase.from("feed_games").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((count ?? 0) >= FEED_MAX) return { ok: false, error: `Máximo de ${FEED_MAX} jogos em direto de cada vez.` };
  let home = "";
  let away = "";
  let tournament = "";
  try {
    const body = await sofaRaw<unknown>(`/event/${eventId}`);
    const event = obj(obj(body)?.event ?? body) ?? {};
    home = str(obj(event.homeTeam)?.name);
    away = str(obj(event.awayTeam)?.name);
    tournament = str(obj(event.tournament)?.name);
  } catch {
    return { ok: false, error: "Não consegui ler o jogo (scraper desligado?)." };
  }
  if (!home || !away) return { ok: false, error: "O SofaScore não devolveu as equipas." };
  const { error } = await supabase
    .from("feed_games")
    .upsert({ user_id: user.id, event_id: eventId, home, away, tournament }, { onConflict: "user_id,event_id" });
  if (error) return { ok: false, error: "Não foi possível guardar (migração 0040 corrida?)." };
  revalidatePath("/feed");
  return { ok: true };
}

export async function removeFeedGameAction(id: string): Promise<void> {
  const { supabase, user } = await authed();
  await supabase.from("feed_games").delete().eq("user_id", user.id).eq("id", id);
  revalidatePath("/feed");
}
