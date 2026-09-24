import { requireAdmin } from "@/lib/requireAdmin";
import { createClient } from "@/lib/supabase/server";
import LiveWidgetsPanel from "@/components/LiveWidgetsPanel";

// The Dashboard is only the live board now: games you added to follow (their
// widget shows up at kickoff time) plus games already live. Bets, analysis
// and community were removed; statistics live under Estatísticas.
export default async function DashboardPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: watchedMatches } = await supabase
    .from("watched_matches")
    .select("id, home_team, away_team, sofascore_url")
    .order("created_at", { ascending: true });

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">⚽ Jogos</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Jogos para acompanhar em direto: adiciona-os e o widget aparece aqui à hora do jogo.
      </p>

      <LiveWidgetsPanel watched={watchedMatches ?? []} />
    </div>
  );
}
