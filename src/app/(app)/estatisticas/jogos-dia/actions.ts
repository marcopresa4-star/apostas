"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  return { supabase, user };
}

// Star / unstar a game in Jogos por dia. The global watcher marks starred
// games once they start (or finish), clearing the waiting list; the Ao vivo
// auto-pin reads this table straight. Nothing ever goes to Em direto or Jogos.
export async function addFavoriteAction(
  eventId: number,
  home: string,
  away: string,
  tournament: string
): Promise<void> {
  const { supabase, user } = await authed();
  if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Jogo inválido.");
  const { error } = await supabase
    .from("favorite_games")
    .upsert(
      { user_id: user.id, event_id: eventId, home, away, tournament },
      { onConflict: "user_id,event_id" }
    );
  if (error) throw new Error("Não foi possível guardar (migração 0041 corrida?).");
  revalidatePath("/estatisticas/jogos-dia");
}

export async function removeFavoriteAction(eventId: number): Promise<void> {
  const { supabase, user } = await authed();
  await supabase.from("favorite_games").delete().eq("user_id", user.id).eq("event_id", eventId);
  revalidatePath("/estatisticas/jogos-dia");
}
