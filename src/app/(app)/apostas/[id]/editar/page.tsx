import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/requireAdmin";
import EditTicketForm from "@/components/EditTicketForm";
import type { ComboCountry } from "@/components/EntityCombobox";
import { fetchUsedEntities } from "@/lib/entityOptions";

interface TicketDetailRow {
  id: string;
  match_date: string;
  match_time: string;
  competition: { id: string; name: string; country: { name: string } | null } | null;
  home_team: { id: string; name: string; country: { name: string } | null } | null;
  away_team: { id: string; name: string; country: { name: string } | null } | null;
  picks: { bet_type: string }[];
}

export default async function EditarApostaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: ticket }, { data: countries }, comboCompetitions, comboTeams] =
    await Promise.all([
      supabase
        .from("tickets")
        .select(
          `id, match_date, match_time,
           competition:competitions(id, name, country:countries(name)),
           home_team:teams!tickets_home_team_id_fkey(id, name, country:countries(name)),
           away_team:teams!tickets_away_team_id_fkey(id, name, country:countries(name)),
           picks(bet_type)`
        )
        .eq("id", id)
        .single()
        .returns<TicketDetailRow>(),
      supabase.from("countries").select("id, name").order("name").returns<ComboCountry[]>(),
      fetchUsedEntities(supabase, "competitions"),
      fetchUsedEntities(supabase, "teams"),
    ]);

  if (!ticket || !ticket.competition || !ticket.home_team || !ticket.away_team) {
    notFound();
  }

  const returnTo = ticket.picks.some((p) => p.bet_type === "live") ? "/live" : "/apostas";

  const comboCountries: ComboCountry[] = (countries ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <div>
      <Link
        href={returnTo}
        className="mb-2 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-300"
      >
        ← Voltar
      </Link>
      <h1 className="mb-6 text-xl font-semibold">Editar jogo</h1>
      <EditTicketForm
        ticketId={ticket.id}
        returnTo={returnTo}
        initialCompetition={{
          id: ticket.competition.id,
          name: ticket.competition.name,
          countryName: ticket.competition.country?.name ?? "",
        }}
        initialHomeTeam={{
          id: ticket.home_team.id,
          name: ticket.home_team.name,
          countryName: ticket.home_team.country?.name ?? "",
        }}
        initialAwayTeam={{
          id: ticket.away_team.id,
          name: ticket.away_team.name,
          countryName: ticket.away_team.country?.name ?? "",
        }}
        initialMatchDate={ticket.match_date}
        initialMatchTime={ticket.match_time?.slice(0, 5)}
        initialCompetitions={comboCompetitions}
        initialTeams={comboTeams}
        countries={comboCountries}
      />
    </div>
  );
}
