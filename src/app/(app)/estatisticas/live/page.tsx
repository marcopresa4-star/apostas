import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, isInternational } from "@/lib/footballData";
import { fitInternational, predictInternational } from "@/lib/internationalModel";
import { leagueRates, predict } from "@/lib/footballModel";
import { MIN_GAMES, SOLID_GAMES } from "@/lib/recommendation";
import { first } from "@/lib/searchParams";
import { parseSofascoreId } from "@/lib/sofascore";
import { findSofaLeague, loadSofaLeague } from "@/lib/sofaLeague";
import { loadSofaInternational } from "@/lib/sofaIntl";
import { activeTeams, isoDaysAgo, toPlayed } from "@/lib/internationalData";
import { WINDOW_YEARS } from "@/lib/internationalModel";
import { loadMaps } from "@/lib/sofaHistory";
import { createClient } from "@/lib/supabase/server";
import { dashboardGames, type WatchedIn } from "@/lib/dashboardGames";
import SofaScoreWidget from "@/components/SofaScoreWidget";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import LiveTeamsForm from "@/components/LiveTeamsForm";
import LiveCalculator from "@/components/LiveCalculator";
import LiveSavedGames from "@/components/LiveSavedGames";
import Link from "next/link";

// What a typical league scores when no teams are chosen, and how its goals split
// around half time.
const TYPICAL = { home: 1.4, away: 1.1, firstHalfShare: 0.44 };

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  // Preferred: a pasted SofaScore link (or bare event id). Read live through
  // the local CloakBrowser scraper; no slug guessing needed.
  const sofaRaw = first(params.sofascore).trim();
  const sofaLinkId = sofaRaw ? parseSofascoreId(sofaRaw) : null;
  const jogo = first(params.jogo);
  let liga = first(params.liga);
  let casa = first(params.casa);
  let fora = first(params.fora);
  // National teams at a neutral venue (World Cup, finals) have no home advantage.
  const neutral = first(params.neutro) === "1";
  const now = new Date();

  // The games already on the Dashboard can be picked instead of pasting a link.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;
  const yesterday = new Date(now.getTime() - 86_400_000);
  const since = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  const [{ data: watchedRows }] = await Promise.all([
    supabase
      .from("watched_matches")
      .select("id, home_team, away_team, home_aliases, away_aliases, sofascore_url")
      .order("created_at", { ascending: true })
      .returns<WatchedIn[]>(),
  ]);
  const dashGames = dashboardGames([], [], since, watchedRows ?? []);
  const dash = jogo ? (dashGames.find((g) => g.id === jogo) ?? null) : null;

  const sofaEventId = sofaLinkId ?? dash?.sofaEventId ?? null;

  // Expected goals: from a dashboard game (league resolved via the team links)
  // or from hand-picked teams of a mapped league. Otherwise typical figures.
  if (dash && !sofaLinkId) {
    const found = userId
      ? await findSofaLeague(supabase, userId, dash.homeNames, dash.awayNames).catch(() => null)
      : null;
    if (found) {
      liga = found.code;
      casa = dash.home;
      fora = dash.away;
    }
  }

  const league = LEAGUES.find((l) => l.code === liga) ?? null;
  const mappedLeagues = await (async () => {
    if (!userId) return [];
    const maps = await loadMaps(supabase, userId, "tournament");
    const codes = new Set(maps.map((m) => m.name_key));
    return LEAGUES.filter((l) => codes.has(l.code));
  })();
  const intlAvailable =
    userId && league && isInternational(league.code)
      ? await loadMaps(supabase, userId, "team").then(
          (maps) => maps.some((m) => m.name_key.startsWith("int:")),
          () => false
        )
      : false;
  const sofaLeague =
    league && userId && mappedLeagues.some((l) => l.code === league.code)
      ? await loadSofaLeague(supabase, userId, league.code).catch(() => null)
      : null;
  const sofaIntl =
    league && userId && isInternational(league.code) && intlAvailable
      ? await loadSofaInternational(supabase, userId, now).catch(() => null)
      : null;
  const data = sofaLeague?.data ?? null;
  const intlTeams = sofaIntl ? activeTeams(sofaIntl.games, now) : [];
  const intlWindowFrom = isoDaysAgo(now, WINDOW_YEARS * 365);
  const intlRecent = sofaIntl ? sofaIntl.games.filter((g) => g.date >= intlWindowFrom) : [];
  const teams = league && isInternational(league.code) ? intlTeams : (data?.teams ?? []);
  const isIntl = league !== null && isInternational(league.code);
  const chosen = league !== null && casa !== "" && fora !== "" && casa !== fora && teams.includes(casa) && teams.includes(fora);

  // With two teams, the expected goals of the game are the model's own.
  let expected = TYPICAL;
  // Where the expected goals come from, to show under the calculator.
  const sourceLines: string[] = [];
  const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(2, 4)}`;
  if (chosen && (data || isIntl)) {
    const prediction = isIntl
      ? predictInternational(fitInternational(intlRecent, now), casa, fora, { neutral })
      : predict(data!.matches, casa, fora, now);
    const latestDate = isIntl
      ? intlRecent.at(-1)?.date ?? null
      : (data?.latest ?? null);
    expected = {
      home: prediction.lambdaHome,
      away: prediction.lambdaAway,
      firstHalfShare: isIntl
        ? leagueRates(intlRecent.map(toPlayed), now).firstHalfShare
        : leagueRates(data!.matches, now).firstHalfShare,
    };
    sourceLines.push(
      `Golos esperados do modelo, a partir dos resultados de ${league?.label} no SofaScore${latestDate ? `, com resultados até ${shortDate(latestDate)}` : ""}.`,
      isIntl
        ? "Usa os jogos entre seleções dos últimos 8 anos, dando mais peso aos recentes e descontando a força de quem cada uma enfrentou."
        : "Usa os jogos das últimas 3 épocas da liga, dando mais peso aos recentes.",
      `Jogos de cada equipa nos dados: ${casa} ${prediction.gamesHome}, ${fora} ${prediction.gamesAway}.`
    );
    const fewest = Math.min(prediction.gamesHome, prediction.gamesAway);
    if (fewest < SOLID_GAMES) {
      sourceLines.push(
        fewest < MIN_GAMES
          ? "Há poucos jogos de uma das equipas: a estimativa é frágil."
          : `Uma das equipas só tem ${fewest} jogos nos dados: abaixo de ${SOLID_GAMES} o modelo ainda não ganha à média da liga.`
      );
    }
  } else if (data) {
    expected = { ...TYPICAL, firstHalfShare: leagueRates(data.matches, now).firstHalfShare };
  }
  if (!chosen) {
    sourceLines.push(
      "Valores típicos de uma liga (1,4 e 1,1 golos): não há dados destas equipas. Não dizem nada sobre a força de cada uma."
    );
  }

  // Without a game the calculator only shows typical figures, which say nothing
  // about any game: it opens on purpose, not by default.
  const typical = first(params.tipico) === "1";
  const showCalculator = sofaEventId !== null || dash !== null || chosen || typical;

  // What to remember the game by, and how to get back to it.
  const extra: Record<string, string> = neutral ? { neutro: "1" } : {};
  const game = sofaEventId !== null
    ? { key: `sf:${sofaEventId}`, href: `/estatisticas/live?${new URLSearchParams({ sofascore: sofaRaw || `id:${sofaEventId}`, ...extra })}` }
    : dash
      ? { key: `d:${dash.id}`, href: `/estatisticas/live?${new URLSearchParams({ jogo: dash.id, ...extra })}` }
      : chosen
        ? { key: `m:${liga}|${casa}|${fora}`, href: `/estatisticas/live?${new URLSearchParams({ liga, casa, fora, ...extra })}` }
        : null;
  const field =
    "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-amber-500";

  // Leagues for the hand picker: mapped clubs plus internationals when linked.
  const intlForm = intlAvailable ? LEAGUES.filter((l) => isInternational(l.code)) : [];
  const formLeagues = [...mappedLeagues, ...intlForm];
  const formTeams = league ? teams : [];

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Um jogo a decorrer: cola o link do jogo no SofaScore (lido pelo scraper local, de minuto a minuto) ou escolhe um
        dos jogos da tua Dashboard, e vê o que ainda pode acontecer, com a odd justa para comparares com a odd live da
        casa. Sem scraper ligado, escreve o resultado e o minuto à mão.
      </p>

      <EstatisticasTabs />

      {dashGames.length > 0 && (
        <section className="mb-4 max-w-4xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-neutral-300">Os teus jogos da Dashboard</h2>
          <div className="flex flex-wrap gap-2">
            {dashGames.map((g) => (
              <Link
                key={g.id}
                href={`/estatisticas/live?${new URLSearchParams({ jogo: g.id })}`}
                className={`rounded-xl border px-3 py-2 transition ${
                  dash?.id === g.id
                    ? "border-amber-500/60 bg-amber-500/10"
                    : "border-neutral-800 bg-neutral-950 hover:border-neutral-600"
                }`}
              >
                <p className="text-sm font-medium text-neutral-100">
                  {g.home} <span className="text-neutral-500">vs</span> {g.away}
                </p>
                <p className="text-[11px] text-neutral-500">
                  {g.sofaEventId !== null
                    ? `SofaScore · evento ${g.sofaEventId}`
                    : g.manual
                      ? "Ao vivo agora, adicionado por ti (sem link SofaScore)"
                      : `${g.date.slice(8, 10)}/${g.date.slice(5, 7)} às ${g.time.slice(0, 5)}${g.competition ? ` · ${g.competition}` : ""}`}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
      {jogo !== "" && !dash && (
        <p className="mb-4 max-w-4xl text-xs text-amber-400">
          Esse jogo já não está na Dashboard (já não tem apostas por decidir). Escolhe outro ou cola o link.
        </p>
      )}

      <form method="get" action="/estatisticas/live" className="mb-4 max-w-4xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
        <label className="mb-1 block text-sm text-neutral-300">Link do jogo no SofaScore</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            name="sofascore"
            defaultValue={sofaRaw}
            placeholder="https://www.sofascore.com/football/match/.../id:12345678"
            className={field}
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 font-medium text-white shadow-lg shadow-amber-600/20 transition hover:bg-amber-500"
          >
            Analisar
          </button>
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-neutral-400">
          <input type="checkbox" name="neutro" value="1" defaultChecked={neutral} className="accent-amber-500" />
          Campo neutro (só conta nas seleções: Mundial, fases finais)
        </label>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          Precisa do scraper local ligado (<code className="text-neutral-400">scraper/npm start</code>). Vale o link
          completo ou só o id (<code className="text-neutral-400">id:12345678</code>). É o mesmo link do campo
          “SofaScore” das apostas.
        </p>
        {sofaRaw && sofaEventId === null && (
          <p className="mt-2 text-xs text-red-300">
            Não encontrei o id do jogo neste link. Cola o endereço da página do jogo no SofaScore (tem
            &quot;id:12345678&quot; no fim) ou só o número.
          </p>
        )}
      </form>

      {game ? (
        <p className="mb-4 max-w-4xl text-xs text-neutral-500">
          Este jogo fica guardado neste navegador, com o minuto e o resultado.{" "}
          <Link href="/estatisticas/live" className="font-medium text-amber-400 hover:underline">
            Outro jogo
          </Link>
        </p>
      ) : (
        <LiveSavedGames />
      )}

      <details className="mb-4 max-w-4xl" open={!sofaEventId && !dash && (league !== null || casa !== "")}>
        <summary className="cursor-pointer text-xs font-medium text-neutral-400 hover:text-neutral-200">
          Ou escolher as equipas à mão
        </summary>
        <div className="mt-2">
          <LiveTeamsForm leagues={formLeagues} liga={sofaEventId || dash ? "" : (league?.code ?? "")} teams={sofaEventId || dash ? [] : formTeams} casa={sofaEventId || dash ? "" : casa} fora={sofaEventId || dash ? "" : fora} />
        </div>
        {formLeagues.length === 0 && (
          <p className="mt-2 text-xs text-amber-400">
            Nenhuma liga mapeada ainda.{" "}
            <Link href="/estatisticas/mapa" className="font-medium text-amber-400 hover:underline">
              Mapear ligas no Mapa SofaScore
            </Link>
            .
          </p>
        )}
      </details>

      {league && data === null && (
        <p className="mb-4 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Não foi possível carregar os dados desta liga (scraper desligado ou liga por mapear?). Podes usar a{" "}
          <Link href="/estatisticas/live?tipico=1" className="underline">
            calculadora com valores típicos
          </Link>
          .
        </p>
      )}
      {casa !== "" && casa === fora && (
        <p className="mb-4 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">Escolhe duas equipas diferentes.</p>
      )}

      {!showCalculator && (
        <p className="max-w-4xl rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-sm leading-relaxed text-neutral-500">
          Ainda não escolheste nenhum jogo. Cola em cima o link do SofaScore, escolhe um da tua Dashboard ou escolhe as
          equipas à mão. Se só quiseres experimentar, podes abrir{" "}
          <Link href="/estatisticas/live?tipico=1" className="text-amber-400 hover:underline">
            a calculadora sem jogo
          </Link>
          , que usa valores típicos de uma liga (1,4 e 1,1 golos esperados) e não diz nada sobre nenhum jogo em concreto.
        </p>
      )}
      {typical && sofaEventId === null && !chosen && (
        <p className="mb-4 max-w-4xl rounded-lg bg-amber-950 px-4 py-3 text-xs text-amber-300">
          Sem jogo escolhido: os golos esperados são os valores típicos de uma liga (1,4 e 1,1) e o minuto e o resultado
          são só um exemplo. Serve para experimentar; para um jogo a sério, cola o link ou escolhe as equipas.
        </p>
      )}

      {showCalculator && (
      <div className={sofaEventId !== null ? "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]" : ""}>
        {sofaEventId !== null && (
          <div className="lg:sticky lg:top-4 lg:self-start">
            <SofaScoreWidget eventId={sofaEventId} expectedHome={expected.home} expectedAway={expected.away} />
          </div>
        )}
        {/* Keyed by the teams, so choosing others starts the calculator afresh. */}
        <LiveCalculator
          key={`${sofaEventId ?? ""}|${dash?.id ?? ""}|${league?.code ?? ""}|${chosen ? casa : ""}|${chosen ? fora : ""}`}
          home={dash ? dash.home : chosen ? casa : ""}
          away={dash ? dash.away : chosen ? fora : ""}
          lambdaHome={expected.home}
          lambdaAway={expected.away}
          firstHalfShare={expected.firstHalfShare}
          fromModel={chosen}
          gameKey={game?.key}
          href={game?.href}
          sourceLines={sourceLines}
          sofaEventId={sofaEventId}
        />
      </div>
      )}
    </div>
  );
}
