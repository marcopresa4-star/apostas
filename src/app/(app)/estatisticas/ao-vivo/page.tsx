import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps, seasonTeamNames, tournamentSeasons } from "@/lib/sofaHistory";
import { sofaRaw } from "@/lib/sofaRaw";
import { loadSofaLeague } from "@/lib/sofaLeague";
import { fetchSofaLiveNow } from "@/lib/sofaBoard";
import { findGameByNames } from "@/lib/liveMatch";
import { parseSofascoreId, parseSofascoreLiveList } from "@/lib/sofascore";
import { gamesOf, summarize, type PlayedMatch, type TeamGame } from "@/lib/footballModel";
import { Suspense } from "react";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import SofaLiveTable, { type SofaBoardDetail, type SofaBoardRings, type SofaBoardStats } from "@/components/SofaLiveTable";
import AoVivoFollow from "@/components/AoVivoFollow";

const obj = (x: unknown): Record<string, unknown> | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

const RECENT = 5;
const form = (games: TeamGame[]) => games.slice(0, RECENT).map((g) => g.result);

// Last-5 averages per side (overall scored/conceded, venue split, BTTS
// share): the rings on the board. Null when there is nothing to average.
function ringOf(games: TeamGame[], venue: "home" | "away"): { gm: number | null; gs: number | null; venue: number | null; btts: number | null } {
  const last = games.slice(0, RECENT);
  const avg = (list: TeamGame[], f: (g: TeamGame) => number): number | null =>
    list.length > 0 ? list.reduce((s, g) => s + f(g), 0) / list.length : null;
  const atVenue = last.filter((g) => !g.neutral && (venue === "home") === g.home);
  return {
    gm: avg(last, (g) => g.gf),
    gs: avg(last, (g) => g.ga),
    venue: venue === "home" ? avg(atVenue, (g) => g.gf) : avg(atVenue, (g) => g.ga),
    btts: last.length > 0 ? last.filter((g) => g.gf > 0 && g.ga > 0).length / last.length : null,
  };
}

export default async function AoVivoPage() {
  await requireAdmin();

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Os jogos em direto agora nas tuas ligas mapeadas — e qualquer jogo estrelado ou que sigas pelo link do SofaScore
        (cola lá em baixo) — via SofaScore. Ligas fora do mapa não aparecem: o mundo tem 500+ em direto nas horas de
        ponta e nenhuma delas teria estatísticas aqui.
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

// Fast pass: the live list, the mapping and the per-league history (all
// cached) render the board; live 1X2 odds load client-side afterwards (see
// SofaLiveTable), and the interval score comes free in the list rows.
async function AoVivoBoard() {
  const now = new Date();
  // Live list from SofaScore via the local CloakBrowser scraper. Scraper
  // offline -> offline: true, and the page says so instead of showing nothing.
  const { games, offline } = await fetchSofaLiveNow(now.getTime());

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Starred games that are live pin themselves at the top, mapped or not:
  // they keep their row even though the board shows the mapped leagues only.
  const favorites = new Set(await feedPinned(games.map((g) => g.id)));

  // Games followed by SofaScore link (the Vista widgets share this table):
  // they join the board as their own rows even when no mapped league covers
  // them. One event read per followed game per refresh — few, and capped.
  const watchedRows = user
    ? (await supabase
        .from("watched_matches")
        .select("id, home_team, away_team, sofascore_url")
        .eq("user_id", user.id)).data ?? []
    : [];
  const watched = watchedRows.flatMap((w) => {
    const eventId = w.sofascore_url ? parseSofascoreId(String(w.sofascore_url)) : null;
    return eventId !== null
      ? [{ rowId: w.id as string, eventId, label: `${w.home_team} vs ${w.away_team}` }]
      : [];
  });

  // Only built when there is something to look up: most of the time this page
  // has nothing mapped live and costs nothing beyond the SofaScore call above.
  // Form/averages come from the mapped leagues' SofaScore history (cached);
  const stats: Record<number, SofaBoardStats> = {};
  const forms: Record<number, { home: ("V" | "E" | "D")[]; away: ("V" | "E" | "D")[] }> = {};
  const rings: Record<number, SofaBoardRings> = {};
  const detail: Record<number, SofaBoardDetail> = {};
  const labels: Record<number, string> = {};
  const mappedIds = new Set<number>();
  if (games.length > 0 && user) {
    const maps = await loadMaps(supabase, user.id, "tournament");
      const teamMaps = await loadMaps(supabase, user.id, "team");
      const toLocal = new Map(teamMaps.filter((m) => m.local_name).map((m) => [m.name, m.local_name]));
      const labelByCode = new Map<string, string>(LEAGUES.map((l) => [l.code, l.label as string]));
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
        // fixtures:false: the board reads results only, and the loader's
        // fixture walk is the expensive half per league.
        const loaded = await loadSofaLeague(supabase, user.id, code, { shots: false, fixtures: false }).catch(() => null);
        const matches = loaded?.data.matches ?? [];
        matchesByCode.set(code, matches);
        return matches;
      };
      // Torneio mapeado pelo id (o live list traz o uniqueTournament em cada
      // fila): manter o jogo não pode depender de os nomes casarem com a
      // cache — uma grafia diferente deixa o jogo fora do quadro (Liga MX:
      // Guadalajara–Tigres desapareceu enquanto Santos–Querétaro ficava, o
      // mesmo torneio e a mesma lista ao vivo).
      const byTid = new Map<number, string>();
      for (const m of maps) {
        const label = labelByCode.get(m.name_key);
        if (label) byTid.set(m.sofascore_id, label);
      }
      for (const g of games) {
        const found = findGameByNames([g.home], [g.away], leagues);
        const mappedLabel = g.uniqueId !== null ? byTid.get(g.uniqueId) : undefined;
        if (!found && !mappedLabel) continue;
        mappedIds.add(g.id);
        if (!found) {
          // Liga mapeada mas nomes por casar: linha só-com-resultado sob o
          // cabeçalho da liga (como um jogo com estrela, sem história);
          // insinuar stats aqui seria inventar números.
          labels[g.id] = mappedLabel!;
          continue;
        }
        // A mapped-league game keeps its row even when its clubs have no
        // history yet (score-only display, like a starred game).
        const local = (name: string): string => toLocal.get(name) ?? name;
        const matches = await matchesFor(found.code as (typeof LEAGUES)[number]["code"]);
        if (matches.length === 0) continue;
        const homeGames = gamesOf(matches, local(found.home));
        const awayGames = gamesOf(matches, local(found.away));
        if (homeGames.length === 0 && awayGames.length === 0) continue;
        stats[g.id] = { home: summarize(homeGames.slice(0, RECENT)), away: summarize(awayGames.slice(0, RECENT)), leagueLabel: found.label };
        forms[g.id] = { home: form(homeGames), away: form(awayGames) };
        rings[g.id] = { home: ringOf(homeGames, "home"), away: ringOf(awayGames, "away") };
      }
  }
  // The board shows the mapped leagues only (plus starred games and followed
  // games): the world list tops 500 rows at peak time, and the extras carry no
  // useful stats. The interval score falls out of the list rows — the old
  // per-game `/event/{id}` read is gone.
  const kept = games.filter((g) => mappedIds.has(g.id) || favorites.has(g.id));
  // Followed games join as synthetic rows. The /event/{id} payload has the
  // same shape as a live-list row, so parseSofascoreLiveList builds the entry
  // (kickoff, phase, minute, HT...) — upcoming and finished games included:
  // following a game means seeing it from its kickoff, not only in play.
  const presentIds = new Set(kept.map((g) => g.id));
  if (!offline) {
    for (const w of watched.filter((w) => !presentIds.has(w.eventId)).slice(0, 12)) {
      try {
        const body = await sofaRaw<unknown>(`/event/${w.eventId}`);
        const e = obj(obj(body)?.event ?? body);
        if (!e) continue;
        const entry = parseSofascoreLiveList({ events: [e] }, now.getTime())[0];
        if (!entry || presentIds.has(entry.id)) continue;
        presentIds.add(entry.id);
        kept.push(entry);
      } catch {
        // Scraper miss: the chip stays, the row does not — next refresh tries.
      }
    }
    kept.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  }
  for (const g of kept) {
    const h1 = g.homeHt;
    const a1 = g.awayHt;
    detail[g.id] = { ht: h1 !== null && a1 !== null ? [h1, a1] : null };
  }

  const n = (x: number): string => `${x} ${x === 1 ? "jogo em direto" : "jogos em direto"}`;
  return (
    <>
      <AoVivoFollow chips={watched.map((w) => ({ id: w.rowId, label: w.label }))} />
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-neutral-400">
          {offline ? (
            "Scraper SofaScore desligado"
          ) : kept.length < games.length ? (
            <>
              {n(kept.length)} no quadro (ligas mapeadas, estrelados e seguidos)
              <span className="text-neutral-600"> · {n(games.length)} em direto no mundo</span>
            </>
          ) : (
            n(kept.length)
          )}
        </p>
        <a href="/estatisticas/ao-vivo" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500">
          Atualizar
        </a>
      </div>

      {offline ? (
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          O scraper local do SofaScore está desligado. Liga-o com <code className="text-neutral-300">cd scraper {"&&"} npm start</code> e
          atualiza — sem ele não há de onde ler o direto.
        </p>
      ) : kept.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          {games.length === 0
            ? "Não encontrei nenhum jogo em direto agora. Ou não há mesmo nenhum a decorrer, ou a fonte não o mostrou desta vez — tenta atualizar daqui a pouco."
            : `Há ${n(games.length)} no mundo, mas nenhum nas tuas ligas mapeadas, estrelado ou seguido — cola o link ao lado de cima se quiseres acompanhar um deles.`}
        </p>
      ) : (
        <SofaLiveTable games={kept} stats={stats} form={forms} rings={rings} detail={detail} autoPinned={[...favorites]} labels={labels} />
      )}
    </>
  );
}

// Starred games that are live right now: they pin themselves at the top of
// Ao vivo, marked auto. Reads favorite_games straight (never the Em direto
// feed). Needs no localStorage.
async function feedPinned(liveIds: number[]): Promise<number[]> {
  if (liveIds.length === 0) return [];
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase.from("favorite_games").select("event_id").eq("user_id", user.id);
  const live = new Set(liveIds);
  return (data ?? [])
    .map((r) => (r as { event_id?: unknown }).event_id)
    .filter((n): n is number => typeof n === "number" && live.has(n));
}
