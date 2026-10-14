import { requireAdmin } from "@/lib/requireAdmin";
import { createClient } from "@/lib/supabase/server";
import FeedCard from "@/components/FeedCard";
import FeedAdd from "@/components/FeedAdd";
import UnfavButton from "@/components/UnfavButton";

export interface FeedRow {
  id: string;
  event_id: number;
  home: string;
  away: string;
  tournament: string;
  created_at: string;
}

export default async function FeedPage() {
  await requireAdmin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <p className="text-sm text-neutral-400">Sem sessão.</p>;

  const { data } = await supabase
    .from("feed_games")
    .select("id, event_id, home, away, tournament, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .returns<FeedRow[]>();
  const rows = data ?? [];
  const { data: favs } = await supabase
    .from("favorite_games")
    .select("event_id, home, away, tournament")
    .eq("user_id", user.id)
    .is("promoted_at", null)
    .order("created_at", { ascending: true });

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">📡 Em direto</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Os teus jogos com gráfico de evolução, resultado e minuto. Adiciona antes do apito inicial — a captura começa
        sozinha e corre em qualquer página do site (de browser fechado nada corre).
      </p>
      <FeedAdd count={rows.length} />
      {(favs ?? []).length > 0 && (
        <div className="mb-4 max-w-4xl rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            A seguir · entram sozinhos ao apito
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
      {rows.length === 0 ? (
        <p className="max-w-4xl rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          Ainda sem jogos. Cola em cima o link de um jogo no SofaScore.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {rows.map((r) => (
            <FeedCard key={r.id} rowId={r.id} eventId={r.event_id} home={r.home} away={r.away} tournament={r.tournament} />
          ))}
        </div>
      )}
    </div>
  );
}
