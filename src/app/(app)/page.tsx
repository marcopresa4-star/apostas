import { requireAdmin } from "@/lib/requireAdmin";
import { createClient } from "@/lib/supabase/server";
import LiveWidgetsPanel from "@/components/LiveWidgetsPanel";
import UnfavButton from "@/components/UnfavButton";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: favs } = user
    ? await supabase
        .from("favorite_games")
        .select("event_id, home, away, tournament")
        .eq("user_id", user.id)
        .is("promoted_at", null)
        .order("created_at", { ascending: true })
    : { data: null };

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">⚽ Jogos</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Jogos para acompanhar em direto: adiciona-os e o widget aparece aqui à hora do jogo.
      </p>

      {(favs ?? []).length > 0 && (
        <div className="mb-4 max-w-4xl rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            A seguir ★ · entram sozinhos ao apito
          </p>
          <div className="space-y-1.5">
            {(favs ?? []).map((f) => {
              const g = f as { event_id?: unknown; home?: unknown; away?: unknown; tournament?: unknown };
              if (typeof g.event_id !== "number") return null;
              const home = typeof g.home === "string" ? g.home : "";
              const away = typeof g.away === "string" ? g.away : "";
              return (
                <div key={g.event_id} className="flex items-center justify-between gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-neutral-200">
                    <span className="mr-1.5 text-amber-300">★</span>
                    {home} <span className="text-neutral-500">vs</span> {away}
                    {typeof g.tournament === "string" && g.tournament && (
                      <span className="ml-1 text-[10px] text-neutral-500">{g.tournament}</span>
                    )}
                  </span>
                  <UnfavButton eventId={g.event_id} label={`${home} vs ${away}`} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <LiveWidgetsPanel watched={watchedMatches ?? []} />
    </div>
  );
}
