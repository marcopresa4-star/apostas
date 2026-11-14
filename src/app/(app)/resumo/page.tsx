import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import { createClient } from "@/lib/supabase/server";
import Icon, { type IconName } from "@/components/Icon";
import { Badge, CountUp, Crest, Ring } from "@/components/ui";

// "Resumo do dia": the front page of the day. What is being followed, which
// bots are working and where to go next.
export default async function ResumoPage() {
  await requireAdmin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: watched }, { data: favs }, { data: bots }] = await Promise.all([
    supabase.from("watched_matches").select("id, home_team, away_team"),
    user
      ? supabase
          .from("favorite_games")
          .select("event_id, home, away, tournament")
          .eq("user_id", user.id)
          .is("promoted_at", null)
      : Promise.resolve({ data: null }),
    user ? supabase.from("bots").select("id, enabled").eq("user_id", user.id) : Promise.resolve({ data: null }),
  ]);

  const nWatched = (watched ?? []).length;
  const nFavs = (favs ?? []).length;
  const allBots = (bots ?? []) as { enabled?: boolean }[];
  const nBots = allBots.length;
  const nBotsOn = allBots.filter((b) => b.enabled).length;
  const botsPct = nBots === 0 ? 0 : (nBotsOn / nBots) * 100;

  const links: { href: string; icon: IconName; title: string; text: string; tone: string }[] = [
    { href: "/previsoes", icon: "sparkle", title: "Previsões do dia", text: "Os resultados mais prováveis de hoje", tone: "from-sky-500/30" },
    { href: "/value", icon: "gem", title: "Value Bets", text: "Odds que pagam acima do risco", tone: "from-emerald-500/30" },
    { href: "/estatisticas/jogos-dia", icon: "calendar", title: "Jogos por dia", text: "O calendário completo", tone: "from-sky-500/30" },
    { href: "/bots", icon: "bot", title: "Bots", text: "Alertas automáticos", tone: "from-sky-500/30" },
  ];

  return (
    <div data-wide>
      <h1 className="hero-title">
        <span className="title-glow">Resumo do dia</span>
        <span className="hero-underline" />
      </h1>
      <p className="mb-6 mt-3 max-w-2xl text-sm text-neutral-400">A capa do teu dia: o que estás a seguir, o que os bots estão a vigiar e para onde ir a seguir.</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="tile rounded-2xl p-5">
          <p className="text-[11px] uppercase tracking-wider text-neutral-400">Jogos a seguir</p>
          <p className="mt-2 font-display text-5xl font-extrabold text-amber-300">
            <CountUp value={nFavs} />
          </p>
          <p className="mt-1 text-xs text-neutral-500">afixam sozinhos ao apito</p>
        </div>
        <div className="tile rounded-2xl p-5">
          <p className="text-[11px] uppercase tracking-wider text-neutral-400">Em acompanhamento</p>
          <p className="mt-2 font-display text-5xl font-extrabold text-sky-300">
            <CountUp value={nWatched} />
          </p>
          <p className="mt-1 text-xs text-neutral-500">widgets no ecrã inicial</p>
        </div>
        <div className="tile flex items-center justify-between rounded-2xl p-5">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-neutral-400">Bots ativos</p>
            <p className="mt-2 font-display text-5xl font-extrabold text-emerald-300">
              <CountUp value={nBotsOn} />
              <span className="text-2xl text-neutral-500">/{nBots}</span>
            </p>
          </div>
          <Ring value={botsPct} size={72} color="#34d399" />
        </div>
      </div>

      <div className="glass mt-4 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">A seguir</h2>
          <Badge kind="warn">★ {nFavs}</Badge>
        </div>
        {nFavs === 0 ? (
          <p className="text-sm text-neutral-500">Ainda não estás a seguir nenhum jogo. Adiciona-os em “Ao vivo agora”.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {(favs ?? []).slice(0, 4).map((f) => {
              const g = f as { event_id?: unknown; home?: unknown; away?: unknown; tournament?: unknown };
              if (typeof g.event_id !== "number") return null;
              const home = typeof g.home === "string" ? g.home : "";
              const away = typeof g.away === "string" ? g.away : "";
              return (
                <li key={g.event_id} className="card-row flex items-center gap-3 rounded-xl px-3 py-2.5">
                  <Crest name={home} />
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-100">
                    {home} <span className="text-neutral-500">vs</span> {away}
                    {typeof g.tournament === "string" && g.tournament && (
                      <span className="block text-[11px] text-neutral-500">{g.tournament}</span>
                    )}
                  </span>
                  <Crest name={away} />
                </li>
              );
            })}
          </ul>
        )}
        {nFavs > 4 && (
          <Link href="/" className="mt-3 inline-block text-xs font-medium text-sky-300 hover:underline">
            Ver todos os {nFavs} na página inicial →
          </Link>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="tile group relative flex items-center gap-4 overflow-hidden rounded-2xl p-5">
            <span aria-hidden className={`absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br ${l.tone} to-transparent blur-2xl transition-all duration-500 group-hover:scale-150`} />
            <span className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.07] text-emerald-300 ring-1 ring-white/10">
              <Icon name={l.icon} className="h-6 w-6" />
            </span>
            <span className="relative flex-1">
              <span className="block font-display font-semibold text-white">{l.title}</span>
              <span className="block text-xs text-neutral-400">{l.text}</span>
            </span>
            <Icon name="arrow" className="relative h-5 w-5 text-neutral-500 transition group-hover:translate-x-1 group-hover:text-emerald-300" />
          </Link>
        ))}
      </div>
    </div>
  );
}
