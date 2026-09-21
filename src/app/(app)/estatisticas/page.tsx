import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, loadLeague } from "@/lib/footballData";
import { lastLeagueGameDate, nextLeagueGameDate } from "@/lib/footballModel";
import { encodeExtra, parseExtras, restFor, type LastGame } from "@/lib/extraGames";
import MatchupForm, { type AdjustValues } from "@/components/MatchupForm";
import MatchupReport from "@/components/MatchupReport";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import { first, todayISO as todayOf } from "@/lib/searchParams";
import { ADJUST_KEYS, adjustFromParams } from "@/lib/adjustments";

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const daysText = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;


export default async function EstatisticasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const liga = first(params.liga);
  const casa = first(params.casa);
  const fora = first(params.fora);
  const raw: Record<string, string> = Object.fromEntries(ADJUST_KEYS.map((key) => [key, first(params[key])]));
  const typedAdjust = { home: adjustFromParams(raw, "casa"), away: adjustFromParams(raw, "fora") };

  // Games of other competitions typed in by hand, and the date of the game.
  const extras = { casa: parseExtras(params.extra_casa), fora: parseExtras(params.extra_fora) };
  // Weight of the home/away form in the model: only the offered steps count.
  const formaLocal = first(params.forma_local);
  const venuePercent = [25, 50, 75, 100].includes(Number(formaLocal)) ? Number(formaLocal) : 0;
  const askedDate = DATE.test(first(params.data_jogo)) ? first(params.data_jogo) : "";

  const league = LEAGUES.find((l) => l.code === liga) ?? null;
  const now = new Date();
  const data = league ? await loadLeague(league.code, now, { history: true }) : null;

  const teams = data?.teams ?? [];
  const ready = data !== null && casa !== "" && fora !== "" && teams.includes(casa) && teams.includes(fora);
  const sameTeam = casa !== "" && casa === fora;

  const todayISO = todayOf(now);

  // When these two meet in the league, from the calendar (home side as chosen).
  const scheduled =
    data?.fixtures
      .filter((f) => f.team1 === casa && f.team2 === fora && f.date >= todayISO)
      .map((f) => f.date)
      .sort()[0] ?? "";
  const matchDate = askedDate || scheduled;

  // Days of rest before that game, from the league calendar and the games typed
  // in. What was typed in the "Dias de descanso" field wins over it.
  const restOf = (team: string, typed: typeof extras.casa): LastGame | null =>
    data && matchDate && team ? restFor(matchDate, data.fixtures, team, typed) : null;
  const autoRest = { home: restOf(casa, extras.casa), away: restOf(fora, extras.fora) };
  const adjust = {
    home: { ...typedAdjust.home, restDays: typedAdjust.home.restDays ?? autoRest.home?.days ?? null },
    away: { ...typedAdjust.away, restDays: typedAdjust.away.restDays ?? autoRest.away?.days ?? null },
  };
  const restNote = (team: string, typed: number | null, auto: LastGame | null) =>
    auto && typed === null
      ? `Descanso de ${team}: ${daysText(auto.days)} (último jogo: ${auto.competition || "liga"}, ${dayMonth(auto.date)}), calculado para o jogo de ${dayMonth(matchDate)}.`
      : "";
  const notes = [
    restNote(casa, typedAdjust.home.restDays, autoRest.home),
    restNote(fora, typedAdjust.away.restDays, autoRest.away),
  ].filter(Boolean);

  // Swapping home and away swaps the adjustments and the games typed in too.
  const swap = new URLSearchParams({ liga, casa: fora, fora: casa });
  for (const key of ADJUST_KEYS) {
    const other = key.endsWith("_casa") ? key.replace("_casa", "_fora") : key.replace("_fora", "_casa");
    swap.set(other, raw[key]);
  }
  if (askedDate) swap.set("data_jogo", askedDate);
  if (venuePercent > 0) swap.set("forma_local", String(venuePercent));
  for (const game of extras.casa) swap.append("extra_fora", encodeExtra(game));
  for (const game of extras.fora) swap.append("extra_casa", encodeExtra(game));
  const swapHref = `/estatisticas?${swap}`;

  // Under the rest field: what was worked out for the game's date, or else
  // what the calendar says. Only the league is in the data, so games of other
  // competitions count only if they were typed in.
  const restHint = (team: string, auto: LastGame | null) => {
    if (!data || !team) return "";
    if (auto) {
      return `Calculado para ${dayMonth(matchDate)}: ${daysText(auto.days)} (último jogo: ${auto.competition || "liga"}, ${dayMonth(auto.date)}). Só conta a liga e os jogos que acrescentares.`;
    }
    const last = lastLeagueGameDate(data.fixtures, team, todayISO);
    const next = nextLeagueGameDate(data.fixtures, team, todayISO);
    const parts: string[] = [];
    if (last) {
      const days = Math.round((now.getTime() - new Date(`${last}T12:00:00`).getTime()) / DAY_MS);
      parts.push(`Último jogo da liga: ${dayMonth(last)} (há ${daysText(days)}).`);
    }
    if (next) parts.push(`Próximo: ${dayMonth(next)}.`);
    parts.push("Não inclui taças nem provas europeias: acrescenta-as abaixo ou confirma.");
    return parts.join(" ");
  };

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Escolhe duas equipas da mesma liga e vê como têm jogado e a probabilidade de cada resultado se se
        enfrentassem.
      </p>

      <EstatisticasTabs />

      <MatchupForm
        leagues={LEAGUES}
        liga={league?.code ?? ""}
        teams={teams}
        casa={casa}
        fora={fora}
        adjust={raw as unknown as AdjustValues}
        restHint={{ casa: restHint(casa, autoRest.home), fora: restHint(fora, autoRest.away) }}
        restAuto={{ casa: autoRest.home?.days ?? null, fora: autoRest.away?.days ?? null }}
        extras={extras}
        matchDate={askedDate}
        scheduledDate={scheduled}
        formaLocal={String(venuePercent)}
      />

      {league && data === null && (
        <p className="mt-4 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Não foi possível carregar os dados desta liga. Tenta outra vez daqui a pouco.
        </p>
      )}

      {sameTeam && (
        <p className="mt-4 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Escolhe duas equipas diferentes.
        </p>
      )}

      {league && data && !ready && !sameTeam && (
        <p className="mt-4 text-sm text-neutral-500">Escolhe a equipa da casa e a de fora e clica em Calcular.</p>
      )}

      {ready && league && data && (
        <MatchupReport
          matches={data.matches}
          history={data.history}
          historyFrom={data.historyFrom}
          home={casa}
          away={fora}
          leagueLabel={league.label}
          latest={data.latest}
          swapHref={swapHref}
          now={now}
          fixtures={data.fixtures}
          adjust={adjust}
          extras={{ home: extras.casa, away: extras.fora }}
          notes={notes}
          venueWeight={venuePercent / 100}
        />
      )}

      {!league && (
        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          Ligas disponíveis: Portugal, Inglaterra (4 divisões), Espanha, Itália, Alemanha, França (2 divisões cada),
          Países Baixos, Bélgica, Áustria, Escócia e Turquia. Brasil, México, EUA, Argentina e Grécia não estão
          disponíveis, porque não há fonte gratuita fiável com os resultados. Os dados vêm do projeto{" "}
          <Link
            href="https://github.com/openfootball/football.json"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 hover:underline"
          >
            openfootball
          </Link>{" "}
          e só têm golos (sem cantos, cartões nem remates).
        </p>
      )}
    </div>
  );
}
