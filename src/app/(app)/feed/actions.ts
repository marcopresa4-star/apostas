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

// Promotes a starred favorite at kickoff (called by the global watcher):
// into the Jogos dashboard, then marks it so it promotes once. Finished
// games only get marked (nothing to follow). Never touches the Em direto
// feed: favorites pin themselves in Ao vivo straight from this table.
export async function promoteFavoriteAction(
  eventId: number,
  home: string,
  away: string,
  tournament: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user } = await authed();
  if (!Number.isInteger(eventId) || eventId <= 0) return { ok: false, error: "Jogo inválido." };
  const phase = await livePhase(eventId);
  // Unknown phase (scraper down): don't mark, retry next tick.
  if (phase === null) return { ok: false, error: "Sem leitura." };
  if (phase === "live" || phase === "halftime") {
    const { addWatchedMatch } = await import("@/app/(app)/actions");
    try {
      await addWatchedMatch(home, away, null, null, `id:${eventId}`);
    } catch {
      // Duplicate or write failure: marking below still stops retries.
    }
  }
  await supabase.from("favorite_games").update({ promoted_at: new Date().toISOString() }).eq("user_id", user.id).eq("event_id", eventId);
  return { ok: true };
}

async function livePhase(eventId: number): Promise<string | null> {
  try {
    const body = await sofaRaw<unknown>(`/event/${eventId}`);
    const event = obj(obj(body)?.event ?? body) ?? {};
    const st = obj(event.status) ?? {};
    const type = String(st.type ?? "").toLowerCase();
    const desc = String(st.description ?? "");
    if (type === "finished" || /\b(ended|full.?time|after (extra|penalt)|apito final)/.test(desc)) return "finished";
    if (/half.?time|intervalo|pausa|break/.test(desc) && !/1st|2nd|first|second|1\.|2\./.test(desc)) return "halftime";
    if (type === "inprogress" || /1st|2nd|first half|second half|extra|penalt/.test(desc)) return "live";
    return String(st.type ?? "") || null;
  } catch {
    return null;
  }
}
