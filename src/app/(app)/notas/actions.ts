"use server";

import { createClient } from "@/lib/supabase/server";

// The notepad has one row per user (upsert): autosave sends the whole text,
// there is no history to merge. Bounded so a paste-storm cannot pile up MBs.
export async function saveNotaAction(content: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = typeof content === "string" ? content.slice(0, 100_000) : "";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sem sessão." };
  const { error } = await supabase.from("user_notes").upsert({
    user_id: user.id,
    content: clean,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "Não foi possível guardar (corre a migração 0043)." };
  return { ok: true };
}
