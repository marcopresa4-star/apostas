import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/requireAdmin";
import TicketForm from "@/components/TicketForm";
import type { ComboCountry } from "@/components/EntityCombobox";
import type { TagItem } from "@/components/CategoryCombobox";
import { fetchUsedEntities } from "@/lib/entityOptions";

export default async function NovaApostaPage() {
  await requireAdmin();
  const supabase = await createClient();

  // Teams and competitions are searched on the server as you type; here only
  // the ones already used in your games are loaded, as first suggestions.
  const [{ data: countries }, comboCompetitions, comboTeams, { data: categories }] =
    await Promise.all([
      supabase.from("countries").select("id, name").order("name").returns<ComboCountry[]>(),
      fetchUsedEntities(supabase, "competitions"),
      fetchUsedEntities(supabase, "teams"),
      supabase.from("bet_categories").select("id, name").order("name").returns<TagItem[]>(),
    ]);

  const comboCountries: ComboCountry[] = (countries ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <div>
      <Link
        href="/apostas"
        className="mb-2 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-300"
      >
        ← Voltar
      </Link>
      <h1 className="mb-6 text-xl font-semibold">Nova aposta</h1>
      <TicketForm
        initialCompetitions={comboCompetitions}
        initialTeams={comboTeams}
        countries={comboCountries}
        initialCategories={categories ?? []}
      />
    </div>
  );
}
