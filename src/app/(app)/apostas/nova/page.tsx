import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/requireAdmin";
import TicketForm from "@/components/TicketForm";
import type { ComboItem, ComboCountry } from "@/components/EntityCombobox";
import type { TagItem } from "@/components/CategoryCombobox";

interface NamedEntityRow {
  id: string;
  name: string;
  country: { name: string } | null;
}

export default async function NovaApostaPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: countries }, { data: competitions }, { data: teams }, { data: categories }] =
    await Promise.all([
      supabase.from("countries").select("id, name").order("name").returns<ComboCountry[]>(),
      supabase
        .from("competitions")
        .select("id, name, country:countries(name)")
        .order("name")
        .returns<NamedEntityRow[]>(),
      supabase
        .from("teams")
        .select("id, name, country:countries(name)")
        .order("name")
        .returns<NamedEntityRow[]>(),
      supabase.from("bet_categories").select("id, name").order("name").returns<TagItem[]>(),
    ]);

  const comboCountries: ComboCountry[] = (countries ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const comboCompetitions: ComboItem[] = (competitions ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    countryName: c.country?.name ?? "",
  }));

  const comboTeams: ComboItem[] = (teams ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    countryName: t.country?.name ?? "",
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
