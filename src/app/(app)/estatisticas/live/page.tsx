import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, isInternational, loadLeague } from "@/lib/footballData";
import { fitInternational, predictInternational } from "@/lib/internationalModel";
import { leagueRates, predict } from "@/lib/footballModel";
import { MIN_GAMES, SOLID_GAMES } from "@/lib/recommendation";
import { first } from "@/lib/searchParams";
import { parseSportscoreMatch } from "@/lib/sportscoreLink";
import { findGame, findGameByNames, prettySlug, sideOfGame } from "@/lib/liveMatch";
import { createClient } from "@/lib/supabase/server";
import { MULTIPLE_SELECT, type MultipleRow } from "@/lib/multiples";
import { dashboardGames, type TicketIn, type WatchedIn } from "@/lib/dashboardGames";
import SportscoreWidget from "@/components/SportscoreWidget";
import { loadSportscoreHints } from "@/lib/sportscoreHints";
import { pairCandidates, slugCandidates } from "@/lib/sportscoreSlug";
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
  const link = first(params.link).trim();
  const jogo = first(params.jogo);
  let liga = first(params.liga);
  let casa = first(params.casa);
  let fora = first(params.fora);
  // National teams at a neutral venue (World Cup, finals) have no home advantage.
  const neutral = first(params.neutro) === "1";
  const now = new Date();

  // A pasted Sportscore link gives the two teams; they are looked for in every
  // league, and when both are found in the same one, the game is set up from it.
  const parsed = link ? parseSportscoreMatch(link) : null;
  let seen: { home: string; away: string; found: boolean; side: string | null } | null = null;

  // The games already on the Dashboard can be picked instead of pasting a link.
  const supabase = await createClient();
  const yesterday = new Date(now.getTime() - 86_400_000);
  const since = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  const [{ data: ticketRows }, { data: multipleRows }, { data: watchedRows }] = await Promise.all([
    supabase
      .from("tickets")
      .select(
        `id, match_date, match_time,
         competition:competitions(name),
         home_team:teams!tickets_home_team_id_fkey(id, name, aliases),
         away_team:teams!tickets_away_team_id_fkey(id, name, aliases),
         picks(stage, status)`
      )
      .gte("match_date", since)
      .returns<TicketIn[]>(),
    // Left empty (never an error) if the multiples migration has not run yet.
    supabase.from("multiples").select(MULTIPLE_SELECT).returns<MultipleRow[]>(),
    // The games added by hand to "Ao vivo agora" (the widgets of the Dashboard).
    supabase
      .from("watched_matches")
      .select("id, home_team, away_team, home_aliases, away_aliases")
      .order("created_at", { ascending: true })
      .returns<WatchedIn[]>(),
  ]);
  const dashGames = dashboardGames(ticketRows ?? [], multipleRows ?? [], since, watchedRows ?? []);
  const dash = jogo ? (dashGames.find((g) => g.id === jogo) ?? null) : null;

  if (parsed || dash) {
    const all = await Promise.all(
      LEAGUES.map(async (l) => {
        const d = await loadLeague(l.code, now);
        return d ? { code: l.code, label: l.label, teams: d.teams } : null;
      })
    );
    const leagues = all.filter((l) => l !== null);
    const found = parsed ? findGame(parsed.slugs, leagues) : dash ? findGameByNames(dash.homeNames, dash.awayNames, leagues) : null;
    if (found) {
      liga = found.code;
      casa = found.home;
      fora = found.away;
      seen = { home: found.home, away: found.away, found: true, side: null };
    } else {
      liga = "";
      casa = "";
      fora = "";
      seen = parsed
        ? {
            home: prettySlug(parsed.slugs[0]),
            away: prettySlug(parsed.slugs[1]),
            found: false,
            side: sideOfGame(parsed.slugs),
          }
        : { home: dash!.home, away: dash!.away, found: false, side: null };
    }
    // A game of the Dashboard is shown by the names it has there.
    if (dash && seen) seen = { ...seen, home: dash.home, away: dash.away };
  }

  const league = LEAGUES.find((l) => l.code === liga) ?? null;
  const data = league ? await loadLeague(league.code, now) : null;
  const teams = data?.teams ?? [];
  const chosen = data !== null && casa !== "" && fora !== "" && casa !== fora && teams.includes(casa) && teams.includes(fora);

  // With two teams, the expected goals of the game are the model's own.
  let expected = TYPICAL;
  // Where the expected goals come from, to show under the calculator.
  const sourceLines: string[] = [];
  const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(2, 4)}`;
  if (data && chosen) {
    const prediction =
      league && isInternational(league.code)
        ? predictInternational(fitInternational(data.intl ?? [], now), casa, fora, { neutral })
        : predict(data.matches, casa, fora, now);
    expected = {
      home: prediction.lambdaHome,
      away: prediction.lambdaAway,
      firstHalfShare: leagueRates(data.matches, now).firstHalfShare,
    };
    const international = league !== null && isInternational(league.code);
    sourceLines.push(
      `Golos esperados do modelo, a partir dos resultados de ${league?.label} (fonte: ${data.source}${data.latest ? `, com resultados até ${shortDate(data.latest)}` : ""}).`,
      international
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

  const embed = parsed ? `${parsed.slugs[0]}-vs-${parsed.slugs[1]}` : null;
  // Without a game the calculator only shows typical figures, which say nothing
  // about any game: it opens on purpose, not by default.
  const typical = first(params.tipico) === "1";
  const showCalculator = parsed !== null || dash !== null || chosen || typical;

  // What to remember the game by, and how to get back to it.
  const extra: Record<string, string> = neutral ? { neutro: "1" } : {};
  const game = parsed
    ? { key: `sc:${embed}`, href: `/estatisticas/live?${new URLSearchParams({ link, ...extra })}` }
    : dash
      ? { key: `d:${dash.id}`, href: `/estatisticas/live?${new URLSearchParams({ jogo: dash.id, ...extra })}` }
      : chosen
        ? { key: `m:${liga}|${casa}|${fora}`, href: `/estatisticas/live?${new URLSearchParams({ liga, casa, fora, ...extra })}` }
        : null;
  // How the calculator finds the game on SportScore to read it: from the pasted
  // link the slug is known; from names (Dashboard, teams picked) the likely slugs
  // are tried, first the ones taught for these clubs.
  const names = dash ? { home: dash.homeNames, away: dash.awayNames } : chosen && !parsed ? { home: [casa], away: [fora] } : null;
  let sync:
    | {
        slug: string | null;
        pairs: { slug: string; home: string; away: string }[];
        hints: { home: string | null; away: string | null };
        homeVariants: string[];
        awayVariants: string[];
      }
    | undefined;
  if (parsed) {
    sync = { slug: embed, pairs: [], hints: { home: null, away: null }, homeVariants: [], awayVariants: [] };
  } else if (names) {
    const hints = await loadSportscoreHints(supabase, names.home, names.away);
    const homeVariants = slugCandidates(names.home);
    const awayVariants = slugCandidates(names.away);
    const withHint = (hint: string | null, variants: string[]) => (hint ? [hint, ...variants.filter((v) => v !== hint)] : variants);
    sync = {
      slug: null,
      pairs: pairCandidates(withHint(hints.home, homeVariants), withHint(hints.away, awayVariants))
        .slice(0, 12)
        .map((p) => ({ slug: `${p.home}-vs-${p.away}`, home: p.home, away: p.away })),
      hints,
      homeVariants,
      awayVariants,
    };
  }
  const field =
    "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-amber-500";

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Um jogo a decorrer: escolhe um dos jogos da tua Dashboard ou cola o link do jogo no Sportscore, e vê o que ainda
        pode acontecer, com a odd justa para comparares com a odd live da casa. O resultado, o minuto e os cartões
        são lidos do Sportscore, de minuto a minuto, e podes escrevê-los à mão se o jogo não for encontrado.
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
                  {g.manual
                    ? "Ao vivo agora, adicionado por ti"
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
        <label className="mb-1 block text-sm text-neutral-300">Link do jogo no Sportscore</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            name="link"
            defaultValue={link}
            placeholder="https://sportscore.com/football/match/equipa-a-vs-equipa-b/..."
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
        {link && !parsed && (
          <p className="mt-2 text-xs text-red-300">
            Não percebi este link. Tem de ser o endereço de um jogo, com as duas equipas no formato
            &quot;equipa-a-vs-equipa-b&quot;.
          </p>
        )}
        {seen?.found && league && (
          <p className="mt-2 text-xs text-emerald-400">
            Reconheci o jogo: {seen.home} vs {seen.away} · {league.label}. Os golos esperados vêm do modelo.
          </p>
        )}
        {seen && !seen.found && (
          <p className="mt-2 text-xs text-amber-400">
            {seen.side
              ? `Este parece um jogo de futebol ${seen.side === "equipa B" ? "de uma equipa B" : seen.side}: não tenho dados dessas equipas (só das primeiras equipas masculinas)`
              : "Não encontrei as duas equipas na mesma liga dos dados (pode ser uma taça, um jogo entre países ou uma liga que não temos)"}
            , por isso uso valores típicos de uma liga. Podes mudá-los por baixo, em &quot;Golos esperados antes do
            jogo&quot;.
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

      <details className="mb-4 max-w-4xl" open={!parsed && !dash && (league !== null || casa !== "")}>
        <summary className="cursor-pointer text-xs font-medium text-neutral-400 hover:text-neutral-200">
          Ou escolher as equipas à mão
        </summary>
        <div className="mt-2">
          <LiveTeamsForm leagues={LEAGUES} liga={parsed || dash ? "" : (league?.code ?? "")} teams={parsed || dash ? [] : teams} casa={parsed || dash ? "" : casa} fora={parsed || dash ? "" : fora} />
        </div>
      </details>

      {league && data === null && (
        <p className="mb-4 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Não foi possível carregar os dados desta liga. Podes usar a{" "}
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
          Ainda não escolheste nenhum jogo. Escolhe um da tua Dashboard, cola em cima o link do Sportscore ou escolhe as
          equipas à mão. Se só quiseres experimentar, podes abrir{" "}
          <Link href="/estatisticas/live?tipico=1" className="text-amber-400 hover:underline">
            a calculadora sem jogo
          </Link>
          , que usa valores típicos de uma liga (1,4 e 1,1 golos esperados) e não diz nada sobre nenhum jogo em concreto.
        </p>
      )}
      {typical && !parsed && !chosen && (
        <p className="mb-4 max-w-4xl rounded-lg bg-amber-950 px-4 py-3 text-xs text-amber-300">
          Sem jogo escolhido: os golos esperados são os valores típicos de uma liga (1,4 e 1,1) e o minuto e o resultado
          são só um exemplo. Serve para experimentar; para um jogo a sério, cola o link ou escolhe as equipas.
        </p>
      )}

      {showCalculator && (
      <div className={embed || dash ? "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]" : ""}>
        {dash && !embed && (
          <div className="lg:sticky lg:top-4 lg:self-start">
            <SportscoreWidget
              homeTeam={dash.home}
              awayTeam={dash.away}
              homeAliases={dash.homeNames.slice(1)}
              awayAliases={dash.awayNames.slice(1)}
            />
            <p className="mt-1.5 text-[11px] text-neutral-500">Lê aqui o resultado e o minuto.</p>
          </div>
        )}
        {embed && (
          <div className="lg:sticky lg:top-4 lg:self-start">
            <div className="w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
              <iframe
                src={`https://sportscore.com/embed/match/football/${embed}/`}
                scrolling="no"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title={`${seen?.home ?? ""} vs ${seen?.away ?? ""}`}
                className="h-[900px] w-full border-0"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-neutral-500">
              Lê aqui o resultado e o minuto. Se o widget não abrir, o link pode estar errado ou o jogo já não estar no
              Sportscore.
            </p>
          </div>
        )}
        {/* Keyed by the teams, so choosing others starts the calculator afresh. */}
        <LiveCalculator
          key={`${embed ?? ""}|${dash?.id ?? ""}|${league?.code ?? ""}|${chosen ? casa : ""}|${chosen ? fora : ""}`}
          home={seen ? seen.home : chosen ? casa : ""}
          away={seen ? seen.away : chosen ? fora : ""}
          lambdaHome={expected.home}
          lambdaAway={expected.away}
          firstHalfShare={expected.firstHalfShare}
          fromModel={chosen}
          gameKey={game?.key}
          href={game?.href}
          sourceLines={sourceLines}
          sync={sync}
        />
      </div>
      )}
    </div>
  );
}
