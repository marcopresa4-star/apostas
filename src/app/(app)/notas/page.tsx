import { requireAdmin } from "@/lib/requireAdmin";
import { createClient } from "@/lib/supabase/server";
import NotasClient from "@/components/NotasClient";

// Notas (Ferramentas): one free-text pad per user, autosaved to user_notes.
// Just notes — no board, no drawings.
export default async function NotasPage() {
  await requireAdmin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let initial = "";
  if (user) {
    const { data } = await supabase
      .from("user_notes")
      .select("content")
      .eq("user_id", user.id)
      .maybeSingle()
      .returns<{ content?: unknown }>();
    if (data && typeof data.content === "string") initial = data.content;
  }
  return (
    <div data-wide>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">📝 <span className="title-glow">Notas</span></h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Bloco de notas para jogos a seguir, ideias de apostas e lembretes. Guarda sozinho enquanto escreves — sem
        quadro táctico, só notas.
      </p>
      <NotasClient initial={initial} />
    </div>
  );
}
