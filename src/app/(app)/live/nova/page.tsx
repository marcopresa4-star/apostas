import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/requireAdmin";
import NovaVigilanciaTabs from "@/components/NovaVigilanciaTabs";
import type { ComboItem, ComboCountry } from "@/components/EntityCombobox";
import type { TicketOption } from "@/components/ExistingTicketPicker";
import type { TagItem } from "@/components/CategoryCombobox";

interface NamedEntityRow {
  id: string;
  name: string;
  country: { name: string } | null;
}

interface ExistingTicketRow {
  id: string;
  match_date: string;
  match_time: string;
  competition: { name: string } | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  picks: { bet_type: string }[];
}

export default async function NovaVigilanciaLivePage() {
  await requireAdmin();
  const supabase = await createClient();

  const [
    { data: countries },
    { data: competitions },
    { data: teams },
    { data: existingTickets },
    { data: categories },
  ] = await Promise.all([
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
    supabase
      .from("tickets")
      .select(
        `id, match_date, match_time,
         competition:competitions(name),
         home_team:teams!tickets_home_team_id_fkey(name),
         away_team:teams!tickets_away_team_id_fkey(name),
         picks(bet_type)`
      )
      .order("match_date", { ascending: true })
      .order("match_time", { ascending: true })
      .returns<ExistingTicketRow[]>(),
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

  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;

  const ticketOptions: TicketOption[] = (existingTickets ?? [])
    .filter((t) => t.match_date >= todayISO && t.picks.some((p) => p.bet_type === "pre_jogo"))
    .map((t) => ({
      id: t.id,
      label: `${t.home_team?.name ?? "?"} vs ${t.away_team?.name ?? "?"}`,
      subtitle: `${t.competition?.name ?? ""} · ${new Date(
        `${t.match_date}T00:00:00`
      ).toLocaleDateString("pt-PT")} ${t.match_time?.slice(0, 5) ?? ""}`,
    }));

  return (
    <div>
      <Link
        href="/live"
        className="mb-2 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-300"
      >
        ← Voltar
      </Link>
      <h1 className="mb-6 text-xl font-semibold">🔴 Nova live</h1>
      <NovaVigilanciaTabs
        initialCompetitions={comboCompetitions}
        initialTeams={comboTeams}
        countries={comboCountries}
        existingTickets={ticketOptions}
        initialCategories={categories ?? []}
      />
    </div>
  );
}
