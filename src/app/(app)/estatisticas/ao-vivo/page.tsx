import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, isInternational, loadLeague } from "@/lib/footballData";
import { fetchLiveNow, type LiveGame } from "@/lib/liveBoard";
import { findGameByNames } from "@/lib/liveMatch";
import { gamesOf, summarize, type PlayedMatch, type TeamGame } from "@/lib/footballModel";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import LiveBoardTable, { type BoardStats } from "@/components/LiveBoardTable";

const RECENT = 5;
const form = (games: TeamGame[]) => games.slice(0, RECENT).map((g) => g.result);

export default async function AoVivoPage() {
  await requireAdmin();
  const now = new Date();
  const games: LiveGame[] = await fetchLiveNow(now.getTime());

  // Only loaded when there is something to look up: most of the time this page
  // has nothing live and costs nothing beyond the SportScore calls above.
  const stats: Record<string, BoardStats> = {};
  const forms: Record<string, { home: ("V" | "E" | "D")[]; away: ("V" | "E" | "D")[] }> = {};
  if (games.length > 0) {
    const loaded = await Promise.all(
      LEAGUES.filter((l) => !isInternational(l.code)).map(async (l) => ({ code: l.code, label: l.label as string, data: await loadLeague(l.code, now) }))
    );
    const leagues: { code: string; label: string; teams: string[] }[] = [];
    const matchesByCode = new Map<string, PlayedMatch[]>();
    for (const l of loaded) {
      if (!l.data) continue;
      leagues.push({ code: l.code, label: l.label, teams: l.data.teams });
      matchesByCode.set(l.code, l.data.matches);
    }
    for (const g of games) {
      const found = findGameByNames([g.home], [g.away], leagues);
      if (!found) continue;
      const matches = matchesByCode.get(found.code);
      if (!matches) continue;
      const homeGames = gamesOf(matches, found.home);
      const awayGames = gamesOf(matches, found.away);
      stats[g.slug] = { home: summarize(homeGames.slice(0, RECENT)), away: summarize(awayGames.slice(0, RECENT)), leagueLabel: found.label };
      forms[g.slug] = { home: form(homeGames), away: form(awayGames) };
    }
  }

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Todos os jogos em direto agora, do mundo inteiro. Nas ligas que cobrimos vêm também os golos por jogo e a forma
        de cada equipa; nas outras só o resultado, porque não temos os dados delas.
      </p>

      <EstatisticasTabs />

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-neutral-400">
          {games.length} {games.length === 1 ? "jogo em direto" : "jogos em direto"} agora
        </p>
        <a href="/estatisticas/ao-vivo" className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500">
          Atualizar
        </a>
      </div>

      {games.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          Não encontrei nenhum jogo em direto agora. Ou não há mesmo nenhum a decorrer, ou a fonte não o mostrou desta
          vez — tenta atualizar daqui a pouco.
        </p>
      ) : (
        <LiveBoardTable games={games} stats={stats} form={forms} />
      )}

      <div className="mt-4 max-w-4xl space-y-2 text-xs leading-relaxed text-neutral-500">
        <p>
          <span className="font-medium text-neutral-400">Como é feito:</span> vem de uma lista pública de jogos
          recentes do Sportscore, mas essa lista atrasa-se (um jogo de há horas pode continuar a aparecer como
          &quot;ainda não começou&quot;). Por isso cada jogo é confirmado um a um, do mesmo jeito fiável que a
          calculadora live já usa, e só entra aqui o que vier mesmo como em direto ou ao intervalo agora.
        </p>
        <p>
          <span className="font-medium text-neutral-400">Limites:</span> a lista só traz os 50 jogos mais recentes de
          todo o mundo, por isso num dia com muitos jogos em simultâneo pode faltar algum. Não há odds de casas de
          apostas (não temos essa fonte de graça) nem estatísticas das ligas que não cobrimos.
        </p>
      </div>
    </div>
  );
}
