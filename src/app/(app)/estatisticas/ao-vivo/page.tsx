import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps, seasonTeamNames, tournamentSeasons } from "@/lib/sofaHistory";
import { loadSofaLeague } from "@/lib/sofaLeague";
import { fetchSofaLiveNow } from "@/lib/sofaBoard";
import { findGameByNames } from "@/lib/liveMatch";
import { gamesOf, summarize, type PlayedMatch, type TeamGame } from "@/lib/footballModel";
import { Suspense } from "react";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import SofaLiveTable, { type SofaBoardStats } from "@/components/SofaLiveTable";

const RECENT = 5;
const form = (games: TeamGame[]) => games.slice(0, RECENT).map((g) => g.result);

export default async function AoVivoPage() {
  await requireAdmin();

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Todos os jogos em direto agora, do mundo inteiro, via SofaScore. Nas ligas mapeadas vêm também os golos por jogo e a forma
        de cada equipa; nas outras só o resultado.
      </p>

      <EstatisticasTabs />

      <Suspense
        fallback={
          <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
            A procurar jogos em direto… (a primeira vez demora, depois é cache)
          </p>
        }
      >
        <AoVivoBoard />
      </Suspense>

      <div className="mt-4 max-w-4xl space-y-2 text-xs leading-relaxed text-neutral-500">
        <p>
          <span className="font-medium text-neutral-400">Como é feito:</span> a lista de jogos em direto vem do
          SofaScore, lida pelo scraper local (CloakBrowser) — é a mesma fonte que a calculadora live usa, jogo a jogo.
        </p>
        <p>
          <span className="font-medium text-neutral-400">Limites:</span> sem scraper ligado não há direto. Não há odds de casas de
          apostas nem estatísticas das ligas que não cobrimos.
        </p>
      </div>
    </div>
  );
}

// The slow part streams in after the shell: live list plus one history load
// per mapped league (cached afterwards). Refreshing mid-load used to abort
// the whole page with "destination stream closed early".
async function AoVivoBoard() {
  const now = new Date();
  // Live list from SofaScore via the local CloakBrowser scraper. Scraper
  // offline -> offline: true, and the page says so instead of showing nothing.
  const { games, offline } = await fetchSofaLiveNow(now.getTime());

  // Only loaded when there is something to look up: most of the time this page
  // has nothing live and costs nothing beyond the SofaScore call above.
  // Form/averages come from the mapped leagues' SofaScore history (cached);
  // games whose clubs aren't linked show score only.
  const stats: Record<number, SofaBoardStats> = {};
  const forms: Record<number, { home: ("V" | "E" | "D")[]; away: ("V" | "E" | "D")[] }> = {};
  if (games.length > 0) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const maps = await loadMaps(supabase, user.id, "tournament");
      const teamMaps = await loadMaps(supabase, user.id, "team");
      const toLocal = new Map(teamMaps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
      const labelByCode = new Map(LEAGUES.map((l) => [l.code, l.label as string]));
      const loaded = await Promise.all(
        maps.map(async (m) => {
          const seasons = await tournamentSeasons(supabase, user.id, m.sofascore_id).catch(() => []);
          if (seasons.length === 0) return null;
          const teams = await seasonTeamNames(supabase, user.id, m.sofascore_id, seasons[0].id, true).catch(() => [] as string[]);
          return teams.length > 0 ? { code: m.name_key, teams } : null;
        })
      );
      const leagues = (loaded.filter(Boolean) as { code: (typeof LEAGUES)[number]["code"]; teams: string[] }[]).map((l) => ({
        code: l.code,
        label: labelByCode.get(l.code) ?? l.code,
        teams: l.teams,
      }));
      const matchesByCode = new Map<string, PlayedMatch[]>();
      const matchesFor = async (code: (typeof LEAGUES)[number]["code"]): Promise<PlayedMatch[]> => {
        const hit = matchesByCode.get(code);
        if (hit) return hit;
        const loaded = await loadSofaLeague(supabase, user.id, code, { shots: false }).catch(() => null);
        const matches = loaded?.data.matches ?? [];
        matchesByCode.set(code, matches);
        return matches;
      };
      for (const g of games) {
        const found = findGameByNames([g.home], [g.away], leagues);
        if (!found) continue;
        const local = (name: string): string => toLocal.get(name) ?? name;
        const matches = await matchesFor(found.code as (typeof LEAGUES)[number]["code"]);
        if (matches.length === 0) continue;
        const homeGames = gamesOf(matches, local(found.home));
        const awayGames = gamesOf(matches, local(found.away));
        if (homeGames.length === 0 && awayGames.length === 0) continue;
        stats[g.id] = { home: summarize(homeGames.slice(0, RECENT)), away: summarize(awayGames.slice(0, RECENT)), leagueLabel: found.label };
        forms[g.id] = { home: form(homeGames), away: form(awayGames) };
      }
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-neutral-400">
          {offline
            ? "Scraper SofaScore desligado"
            : `${games.length} ${games.length === 1 ? "jogo em direto" : "jogos em direto"} agora`}
        </p>
        <a href="/estatisticas/ao-vivo" className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500">
          Atualizar
        </a>
      </div>

      {offline ? (
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          O scraper local do SofaScore está desligado. Liga-o com <code className="text-neutral-300">cd scraper {"&&"} npm start</code> e
          atualiza — sem ele não há de onde ler o direto.
        </p>
      ) : games.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          Não encontrei nenhum jogo em direto agora. Ou não há mesmo nenhum a decorrer, ou a fonte não o mostrou desta
          vez — tenta atualizar daqui a pouco.
        </p>
      ) : (
        <SofaLiveTable games={games} stats={stats} form={forms} />
      )}
    </>
  );
}
