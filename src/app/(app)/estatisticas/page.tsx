import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, isInternational, loadLeague, type LeagueData } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps, sofaTeamIdFor, teamLastGame } from "@/lib/sofaHistory";
import { loadSofaLeague, teamGoalTiming, fixtureEventId, type GoalTiming, type OfficialStanding } from "@/lib/sofaLeague";
import { eventOdds } from "@/lib/sofaOdds";
import { oddsKeyFor } from "@/lib/oddsParse";
import { HOUR_MS } from "@/lib/sofaCache";
import { loadSofaInternational } from "@/lib/sofaIntl";
import { activeTeams, isoDaysAgo, toPlayed } from "@/lib/internationalData";
import { WINDOW_YEARS } from "@/lib/internationalModel";
import { fitInternational, predictInternational } from "@/lib/internationalModel";
import { lastLeagueGameDate, nextLeagueGameDate } from "@/lib/footballModel";
import { daysBetween, encodeExtra, parseExtras, restFor, type LastGame } from "@/lib/extraGames";
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
  let liga = first(params.liga);
  let casa = first(params.casa);
  let fora = first(params.fora);
  const raw: Record<string, string> = Object.fromEntries(ADJUST_KEYS.map((key) => [key, first(params[key])]));
  const formaLocal = first(params.forma_local);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Paste-a-link analysis: a SofaScore link (even pre-match) resolves to
  // league + local teams, which then flow through the normal analysis below.
  const analisarLink = first(params.analisar).trim();
  const linkNotes: string[] = [];
  if (analisarLink && user) {
    const { resolveSofaLink } = await import("@/lib/sofaLeague");
    const resolved = await resolveSofaLink(supabase, user.id, analisarLink).catch(() => ({ error: "Falhou a leitura do link." }));
    if ("error" in resolved) {
      linkNotes.push(resolved.error);
    } else {
      if (resolved.leagueCode) liga = resolved.leagueCode;
      if (resolved.casa) casa = resolved.casa;
      if (resolved.fora) fora = resolved.fora;
      linkNotes.push(`Jogo: ${resolved.homeSofa} vs ${resolved.awaySofa}${resolved.tournament ? ` · ${resolved.tournament}` : ""}.`);
      linkNotes.push(...resolved.warnings);
    }
  }

  const league = LEAGUES.find((l) => l.code === liga) ?? null;
  const international = league !== null && isInternational(league.code);
  const neutral = international && first(params.neutro) === "1";
  const venuePercent = !international && [25, 50, 75, 100].includes(Number(formaLocal)) ? Number(formaLocal) : 0;
  const askedDate = DATE.test(first(params.data_jogo)) ? first(params.data_jogo) : "";

  const maps = !international && user ? await loadMaps(supabase, user.id, "tournament") : [];
  // SofaScore only: unmapped leagues/selects fall back to a teach-me note.
  const mapped = league !== null && maps.some((m) => m.name_key === league.code);
  const intlMaps = international && user ? (await loadMaps(supabase, user.id, "team")).some((m) => m.name_key.startsWith("int:")) : false;
  const useSofa = mapped && user !== null;
  const useSofaIntl = international && intlMaps && user !== null;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Escolhe duas equipas da mesma liga e vê como têm jogado e a probabilidade de cada resultado se se
        enfrentassem.
      </p>

      <EstatisticasTabs />

      <form
        method="get"
        action="/estatisticas"
        className="mb-4 flex max-w-4xl flex-col gap-2 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm sm:flex-row"
      >
        <input
          type="text"
          name="analisar"
          defaultValue={first(params.analisar)}
          placeholder="Ou cola o link do jogo no SofaScore (mesmo por começar)…"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-amber-500"
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 font-medium text-white transition hover:bg-amber-500"
        >
          Analisar
        </button>
      </form>

      {linkNotes.length > 0 && (
        <div className="mb-3 rounded-xl border border-sky-800/50 bg-sky-950/20 px-4 py-2.5 text-xs leading-relaxed text-neutral-300">
          {linkNotes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      )}

      {league && !useSofa && !useSofaIntl && (
        <p className="mb-3 rounded-xl border border-dashed border-neutral-800 px-4 py-3 text-xs leading-relaxed text-neutral-400">
          Sem dados desta liga no SofaScore.{" "}
          <Link href="/estatisticas/mapa" className="font-medium text-amber-400 hover:underline">
            Mapear no Mapa SofaScore
          </Link>
          .
        </p>
      )}

      <Suspense
        key={`${liga}|${casa}|${fora}|${useSofa}|${useSofaIntl}|${askedDate}|${neutral}|${venuePercent}|${first(params.analisar)}`}
        fallback={
          <p className="mt-4 rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
            A carregar os jogos… (a primeira vez em modo SofaScore demora vários minutos; depois é cache)
          </p>
        }
      >
        <CompararBody
          liga={liga}
          casa={casa}
          fora={fora}
          raw={raw}
          neutral={neutral}
          askedDate={askedDate}
          venuePercent={venuePercent}
          useSofa={useSofa}
          useSofaIntl={useSofaIntl}
          userId={user?.id ?? null}
        />
      </Suspense>
    </div>
  );
}

// Everything below the tabs streams in: slow SofaScore loads no longer hold
// the whole page. Props are plain params (serializable for the boundary).
async function CompararBody({
  liga,
  casa,
  fora,
  raw,
  neutral,
  askedDate,
  venuePercent,
  useSofa,
  useSofaIntl,
  userId,
}: {
  liga: string;
  casa: string;
  fora: string;
  raw: Record<string, string>;
  neutral: boolean;
  askedDate: string;
  venuePercent: number;
  useSofa: boolean;
  useSofaIntl: boolean;
  userId: string | null;
}) {
  const typedAdjust = { home: adjustFromParams(raw, "casa"), away: adjustFromParams(raw, "fora") };

  // Games of other competitions typed in by hand, and the date of the game.
  const extras = { casa: parseExtras(raw.extra_casa), fora: parseExtras(raw.extra_fora) };
  const league = LEAGUES.find((l) => l.code === liga) ?? null;
  const international = league !== null && isInternational(league.code);

  const now = new Date();
  const supabase = await createClient();
  let sofaMeta: { games: number; latest: string | null; unlinked: string[] } | null = null;
  let data: LeagueData | null = null;
  let sofaTables: { name: string; rows: OfficialStanding[] }[] = [];
  if (league && userId) {
    if (useSofa) {
      const sofa = await loadSofaLeague(supabase, userId, league.code, { history: true }).catch(() => null);
      if (sofa) {
        sofaMeta = { games: sofa.data.matches.length, latest: sofa.data.latest, unlinked: sofa.unlinked };
        data = sofa.data;
        sofaTables = sofa.tables;
      }
    } else if (useSofaIntl) {
      const sofa = await loadSofaInternational(supabase, userId, now).catch(() => null);
      if (sofa) {
        const windowFrom = isoDaysAgo(now, WINDOW_YEARS * 365);
        const recent = sofa.games.filter((g) => g.date >= windowFrom);
        const from = isoDaysAgo(now, 365);
        const nlGames = sofa.games.filter((g) => /nations league/i.test(g.tournament));
        const teams =
          league.code === "int.nl" ? activeTeams(nlGames, now) : activeTeams(sofa.games, now);
        sofaMeta = {
          games: recent.length,
          latest: recent.at(-1)?.date ?? null,
          unlinked: sofa.unlinked,
        };
        data = {
          matches: recent.map(toPlayed),
          teams,
          fixtures: sofa.games
            .filter((g) => g.date >= from)
            .map((g) => ({ date: g.date, team1: g.home, team2: g.away, ft: [g.hg, g.ag] as [number, number], competition: g.tournament })),
          latest: sofa.games.at(-1)?.date ?? null,
          seasons: [],
          history: sofa.games.filter((g) => g.date < windowFrom).map(toPlayed),
          historyFrom: null,
          intl: recent,
          source: "sofascore",
          season: { id: "12m", from, to: now.toISOString().slice(0, 10), label: "últimos 12 meses" },
          calendar: "none",
        };
      }
    }
  }

  const teams = data?.teams ?? [];
  const ready = data !== null && casa !== "" && fora !== "" && teams.includes(casa) && teams.includes(fora);
  const sameTeam = casa !== "" && casa === fora;

  const todayISO = todayOf(now);

  // National teams have their own model: every team's attack and defence are
  // fitted together, and a neutral venue takes the home advantage away.
  const fit = ready && international && data ? fitInternational(data.intl ?? [], now) : null;
  const predictFn = fit ? (ratio: number) => predictInternational(fit, casa, fora, { neutral, ratio }) : undefined;

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
  // Clubs in cups/Europe: the real last game may not be a league game. The
  // team's SofaScore event list covers every competition; the most recent of
  // the two wins (the typed-in games are already inside the league figure).
  // National sides already list every competition, so this is clubs only.
  if (useSofa && data && matchDate && userId) {
    const lastAllComp = async (team: string): Promise<LastGame | null> => {
      if (!team) return null;
      const id = await sofaTeamIdFor(supabase, userId, team).catch(() => null);
      if (!id) return null;
      const last = await teamLastGame(supabase, userId, id, matchDate).catch(() => null);
      if (!last) return null;
      return { date: last.date, competition: last.tournament.split(",")[0], days: daysBetween(last.date, matchDate) };
    };
    const [lastCasa, lastFora] = await Promise.all([lastAllComp(casa), lastAllComp(fora)]);
    if (lastCasa && (!autoRest.home || lastCasa.date > autoRest.home.date)) autoRest.home = lastCasa;
    if (lastFora && (!autoRest.away || lastFora.date > autoRest.away.date)) autoRest.away = lastFora;
  }
  // Goal timing per 15' from the last games with incident data (cached): when
  // each side scores and concedes. Independent of the rest-days above.
  let timing: { home: GoalTiming | null; away: GoalTiming | null } | null = null;
  if (useSofa && data && userId && casa && fora) {
    const [timingCasa, timingFora] = await Promise.all([
      teamGoalTiming(supabase, userId, liga, casa).catch(() => null),
      teamGoalTiming(supabase, userId, liga, fora).catch(() => null),
    ]);
    if (timingCasa || timingFora) timing = { home: timingCasa, away: timingFora };
  }
  // Real odds for this exact fixture, when the bookmakers price it (usually
  // from a few days out): the calendar carries the SofaScore event id.
  let realByKey: Record<string, number> = {};
  if (useSofa && data && userId && matchDate && casa && fora) {
    const fx = data.fixtures.find((f) => f.team1 === casa && f.team2 === fora && f.date === matchDate);
    const eventId = fx ? fixtureEventId(fx) : null;
    if (eventId) {
      const parsed = await eventOdds(supabase, userId, eventId, HOUR_MS).catch(() => null);
      if (parsed) {
        const byKey: Record<string, number> = {};
        for (const m of parsed.markets) for (const c of m.choices) byKey[c.key] = c.odd;
        const keys = [
          "home", "draw", "away", "1x", "x2", "12",
          "btts:yes", "btts:no",
          "over:0.5", "under:0.5", "over:1.5", "under:1.5",
          "over:2.5", "under:2.5", "over:3.5", "under:3.5",
          "ht:home", "ht:draw", "ht:away",
        ];
        for (const k of keys) {
          const ok = oddsKeyFor(k, casa, fora);
          if (ok && byKey[ok] !== undefined) realByKey[k] = byKey[ok];
        }
      }
    }
  }
  if (useSofa && data && userId && casa && fora) {
    const [timingCasa, timingFora] = await Promise.all([
      teamGoalTiming(supabase, userId, liga, casa).catch(() => null),
      teamGoalTiming(supabase, userId, liga, fora).catch(() => null),
    ]);
    if (timingCasa || timingFora) timing = { home: timingCasa, away: timingFora };
  }
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
  if (neutral) swap.set("neutro", "1");
  if (venuePercent > 0) swap.set("forma_local", String(venuePercent));
  for (const game of extras.casa) swap.append("extra_fora", encodeExtra(game));
  for (const game of extras.fora) swap.append("extra_casa", encodeExtra(game));
  const swapHref = `/estatisticas?${swap}`;

  // Under the rest field: what was worked out for the game's date, or else
  // what the calendar says. All competitions count (plus the typed-in games).
  const restHint = (team: string, auto: LastGame | null) => {
    if (!data || !team) return "";
    if (auto) {
      return `Calculado para ${dayMonth(matchDate)}: ${daysText(auto.days)} (último jogo: ${auto.competition || "liga"}, ${dayMonth(auto.date)}). Conta todas as competições e os jogos que acrescentares.`;
    }
    const last = lastLeagueGameDate(data.fixtures, team, todayISO);
    const next = nextLeagueGameDate(data.fixtures, team, todayISO);
    const parts: string[] = [];
    if (last) {
      const days = Math.round((now.getTime() - new Date(`${last}T12:00:00`).getTime()) / DAY_MS);
      parts.push(`Último jogo da liga: ${dayMonth(last)} (há ${daysText(days)}).`);
    }
    if (next) parts.push(`Próximo: ${dayMonth(next)}.`);
    parts.push("Se faltar algum jogo (amigáveis), acrescenta-o abaixo ou confirma.");
    return parts.join(" ");
  };

  return (
    <>
      {useSofaIntl && sofaMeta && (
        <div className="mb-3 rounded-xl border border-sky-800/50 bg-sky-950/20 px-4 py-2.5 text-xs leading-relaxed text-neutral-300">
          <p>
            <span className="font-medium text-sky-300">Dados SofaScore (seleções):</span> {sofaMeta.games} jogos nos
            últimos 8 anos{sofaMeta.latest ? `, até ${sofaMeta.latest.slice(8, 10)}/${sofaMeta.latest.slice(5, 7)}` : ""}.
            Campo neutro estimado pelo torneio (sem recinto nos dados). Clubes, olímpicas e regiões ficam de fora sozinhos.
          </p>
          {sofaMeta.unlinked.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-amber-300/90 hover:underline">
                Grafias por ligar no Mapa ({sofaMeta.unlinked.length})
              </summary>
              <p className="mt-1 text-neutral-400">{sofaMeta.unlinked.join(", ")}.</p>
            </details>
          )}
        </div>
      )}
      {useSofa && sofaMeta && (
        <p className="mb-3 rounded-xl border border-sky-800/50 bg-sky-950/20 px-4 py-2.5 text-xs leading-relaxed text-neutral-300">
          <span className="font-medium text-sky-300">Dados SofaScore:</span> {sofaMeta.games} jogos nas últimas 3
          épocas{sofaMeta.latest ? `, até ${sofaMeta.latest.slice(8, 10)}/${sofaMeta.latest.slice(5, 7)}` : ""}
          {sofaMeta.unlinked.length > 0 ? `. Grafias por ligar no Mapa: ${sofaMeta.unlinked.join(", ")}.` : "."}
        </p>
      )}

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
        international={international}
        neutral={neutral}
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
          currentSeason={data.season}
          international={international}
          predictFn={predictFn}
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
          timing={timing}
          realByKey={realByKey}
          tables={sofaTables.length > 0 ? sofaTables : undefined}
        />
      )}

      {!league && (
        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          Ligas disponíveis: Portugal, Inglaterra (4 divisões), Espanha, Itália, Alemanha, França (2 divisões cada),
          Países Baixos, Bélgica, Áustria, Escócia, Turquia, Grécia, Roménia, Polónia, Dinamarca, Suíça, México, Japão,
          Brasil, Argentina, EUA, Noruega, Suécia, Finlândia, Irlanda e China. Também há as seleções nacionais (todas, ou
          só as da Liga das Nações), com um modelo próprio e campo neutro. Só faltam as que não têm fonte gratuita com
          os resultados (a Rússia está parada desde agosto). Os dados dos clubes vêm do projeto{" "}
          <Link
            href="https://github.com/openfootball/football.json"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 hover:underline"
          >
            openfootball
          </Link>{" "}
          e, nas ligas que ele não tem ou não atualiza, de{" "}
          <Link
            href="https://www.football-data.co.uk"
            target="_blank"
            rel="noopener noreferrer"
          >
            football-data.co.uk
          </Link>
          , e os das seleções do projeto{" "}
          <Link
            href="https://github.com/martj42/international_results"
            target="_blank"
            rel="noopener noreferrer"
          >
            international_results
          </Link>
          . Só têm golos (sem cantos, cartões nem remates).
        </p>
      )}
    </>
  );
}
