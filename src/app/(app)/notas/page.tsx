import { requireAdmin } from "@/lib/requireAdmin";
import { createClient } from "@/lib/supabase/server";
import NotasClient from "@/components/NotasClient";
import Icon from "@/components/Icon";

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
      <h1 className="hero-title mb-3"><Icon name="note" className="mr-2 inline-block h-8 w-8 -translate-y-0.5 text-emerald-300" /> <span className="title-glow">Notas</span><span className="hero-underline" /></h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Bloco de notas para jogos a seguir, ideias de apostas e lembretes. Guarda sozinho enquanto escreves — sem
        quadro táctico, só notas.
      </p>
      <NotasClient initial={initial} />
    </div>
  );
}
