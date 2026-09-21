import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, isInternational, loadLeague } from "@/lib/footballData";
import { fitInternational, predictInternational } from "@/lib/internationalModel";
import { leagueRates, predict } from "@/lib/footballModel";
import { first } from "@/lib/searchParams";
import { parseSportscoreMatch } from "@/lib/sportscoreLink";
import { findGame, prettySlug } from "@/lib/liveMatch";
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
  let liga = first(params.liga);
  let casa = first(params.casa);
  let fora = first(params.fora);
  // National teams at a neutral venue (World Cup, finals) have no home advantage.
  const neutral = first(params.neutro) === "1";
  // `novo` skips going back to the last game by itself.
  const fresh = first(params.novo) === "1";
  const now = new Date();

  // A pasted Sportscore link gives the two teams; they are looked for in every
  // league, and when both are found in the same one, the game is set up from it.
  const parsed = link ? parseSportscoreMatch(link) : null;
  let seen: { home: string; away: string; found: boolean } | null = null;
  if (parsed) {
    const all = await Promise.all(
      LEAGUES.map(async (l) => {
        const d = await loadLeague(l.code, now);
        return d ? { code: l.code, label: l.label, teams: d.teams } : null;
      })
    );
    const found = findGame(parsed.slugs, all.filter((l) => l !== null));
    if (found) {
      liga = found.code;
      casa = found.home;
      fora = found.away;
      seen = { home: found.home, away: found.away, found: true };
    } else {
      liga = "";
      casa = "";
      fora = "";
      seen = { home: prettySlug(parsed.slugs[0]), away: prettySlug(parsed.slugs[1]), found: false };
    }
  }

  const league = LEAGUES.find((l) => l.code === liga) ?? null;
  const data = league ? await loadLeague(league.code, now) : null;
  const teams = data?.teams ?? [];
  const chosen = data !== null && casa !== "" && fora !== "" && casa !== fora && teams.includes(casa) && teams.includes(fora);

  // With two teams, the expected goals of the game are the model's own.
  let expected = TYPICAL;
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
  } else if (data) {
    expected = { ...TYPICAL, firstHalfShare: leagueRates(data.matches, now).firstHalfShare };
  }

  const embed = parsed ? `${parsed.slugs[0]}-vs-${parsed.slugs[1]}` : null;

  // What to remember the game by, and how to get back to it.
  const extra: Record<string, string> = neutral ? { neutro: "1" } : {};
  const game = parsed
    ? { key: `sc:${embed}`, href: `/estatisticas/live?${new URLSearchParams({ link, ...extra })}` }
    : chosen
      ? { key: `m:${liga}|${casa}|${fora}`, href: `/estatisticas/live?${new URLSearchParams({ liga, casa, fora, ...extra })}` }
      : null;
  const field =
    "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-amber-500";

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Um jogo a decorrer: cola o link do jogo no Sportscore e vê o que ainda pode acontecer, com a odd justa para
        comparares com a odd live da casa. O resultado e o minuto tens de os escrever tu (lês no widget ao lado).
      </p>

      <EstatisticasTabs />

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
            Não encontrei as duas equipas na mesma liga dos dados (pode ser uma taça, um jogo entre países ou uma liga
            que não temos), por isso uso valores típicos de uma liga. Podes mudá-los por baixo, em &quot;Golos
            esperados antes do jogo&quot;.
          </p>
        )}
      </form>

      {game ? (
        <p className="mb-4 max-w-4xl text-xs text-neutral-500">
          Este jogo fica guardado neste navegador, com o minuto e o resultado.{" "}
          <Link href="/estatisticas/live?novo=1" className="font-medium text-amber-400 hover:underline">
            Outro jogo
          </Link>
        </p>
      ) : (
        <LiveSavedGames autoResume={!fresh && link === "" && liga === "" && casa === "" && fora === ""} />
      )}

      <details className="mb-4 max-w-4xl" open={!parsed && (league !== null || casa !== "")}>
        <summary className="cursor-pointer text-xs font-medium text-neutral-400 hover:text-neutral-200">
          Ou escolher as equipas à mão
        </summary>
        <div className="mt-2">
          <LiveTeamsForm leagues={LEAGUES} liga={parsed ? "" : (league?.code ?? "")} teams={parsed ? [] : teams} casa={parsed ? "" : casa} fora={parsed ? "" : fora} />
        </div>
      </details>

      {league && data === null && (
        <p className="mb-4 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Não foi possível carregar os dados desta liga. Podes usar a calculadora com valores típicos.
        </p>
      )}
      {casa !== "" && casa === fora && (
        <p className="mb-4 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">Escolhe duas equipas diferentes.</p>
      )}

      <div className={embed ? "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]" : ""}>
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
          key={`${embed ?? ""}|${league?.code ?? ""}|${chosen ? casa : ""}|${chosen ? fora : ""}`}
          home={seen ? seen.home : chosen ? casa : ""}
          away={seen ? seen.away : chosen ? fora : ""}
          lambdaHome={expected.home}
          lambdaAway={expected.away}
          firstHalfShare={expected.firstHalfShare}
          fromModel={chosen}
          gameKey={game?.key}
          href={game?.href}
        />
      </div>
    </div>
  );
}
