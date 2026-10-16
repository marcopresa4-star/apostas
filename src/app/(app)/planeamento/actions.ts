"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sanitizeTable, type LiveTableDef } from "@/lib/planeamento";

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  return { supabase, user };
}

export async function saveLiveTableAction(input: LiveTableDef): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = sanitizeTable(input);
  if (!clean) return { ok: false, error: "Dá um nome à tabela e pelo menos um critério." };
  const { supabase, user } = await authed();
  const row = {
    user_id: user.id,
    name: clean.name,
    leagues_mode: clean.leaguesMode,
    leagues: clean.leagues,
    sample: clean.sample,
    venue_split: clean.venueSplit,
    criteria: clean.criteria,
  };
  if (clean.id) {
    const { error } = await supabase.from("live_tables").update(row).eq("id", clean.id).eq("user_id", user.id);
    if (error) return { ok: false, error: "Não foi possível guardar (corre a migração 0042)." };
  } else {
    const { error } = await supabase.from("live_tables").insert(row);
    if (error) return { ok: false, error: "Não foi possível guardar (corre a migração 0042)." };
  }
  revalidatePath("/planeamento");
  return { ok: true };
}

export async function deleteLiveTableAction(id: string): Promise<void> {
  const { supabase, user } = await authed();
  await supabase.from("live_tables").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/planeamento");
}
