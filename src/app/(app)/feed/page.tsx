import { requireAdmin } from "@/lib/requireAdmin";
import { createClient } from "@/lib/supabase/server";
import FeedCard from "@/components/FeedCard";
import FeedAdd from "@/components/FeedAdd";
import Icon from "@/components/Icon";

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

  return (
    <div data-wide>
      <h1 className="hero-title mb-3"><Icon name="broadcast" className="mr-2 inline-block h-8 w-8 -translate-y-0.5 text-emerald-300" /> <span className="title-glow">Em direto</span><span className="hero-underline" /></h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Os teus jogos com gráfico de evolução, resultado e minuto. Adiciona antes do apito inicial — ou envia um jogo
        do Ao vivo agora com o botão <span className="text-sky-300">📡 Em direto</span> — a captura começa sozinha e
        corre em qualquer página do site (de browser fechado nada corre).
      </p>
      <FeedAdd count={rows.length} />
      {rows.length === 0 ? (
        <p className="max-w-4xl rounded-xl border border-dashed border-white/[0.07] px-4 py-10 text-center text-sm text-neutral-500">
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
