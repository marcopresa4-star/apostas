import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, hasFixtures, isInternational, loadLeague } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps } from "@/lib/sofaHistory";
import { loadSofaLeague } from "@/lib/sofaLeague";
import { loadSofaInternational, loadUpcomingIntl } from "@/lib/sofaIntl";
import { isoDaysAgo, toPlayed } from "@/lib/internationalData";
import { WINDOW_YEARS, fitInternational, predictInternational } from "@/lib/internationalModel";
import { leagueRates, predict } from "@/lib/footballModel";
import { roundLabel, upcomingRounds } from "@/lib/rounds";
import { MIN_GAMES, SOLID_GAMES, baseRates, recommend } from "@/lib/recommendation";
import { fixtureEventId } from "@/lib/sofaLeague";
import { first, todayISO } from "@/lib/searchParams";
import { Suspense } from "react";
import CheckedProfit from "./profit";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import LeaguePicker from "@/components/LeaguePicker";
import RoundTable, { type RoundRow } from "@/components/RoundTable";

const MAX_ROUNDS = 6;

export default async function JornadaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const liga = first(params.liga);
  const jornada = first(params.jornada);

  const league = LEAGUES.find((l) => l.code === liga) ?? null;
  const now = new Date();
  const today = todayISO(now);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const maps = user ? await loadMaps(supabase, user.id, "tournament") : [];
  const mapped = league !== null && maps.some((m) => m.name_key === league.code);
  const intlLinked =
    user !== null && (await loadMaps(supabase, user.id, "team")).some((m) => m.name_key.startsWith("int:"));

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Os próximos jogos de uma liga, cada um com a probabilidade de cada resultado e a aposta que o modelo sugeriria.
      </p>

      <EstatisticasTabs />
      <LeaguePicker
        leagues={LEAGUES.filter(
          (l) =>
            (!isInternational(l.code) && (hasFixtures(l.code) || maps.some((m) => m.name_key === l.code))) ||
            (isInternational(l.code) && intlLinked)
        )}
        liga={league?.code ?? ""}
        action="/estatisticas/jornada"
      />
      {league && !mapped && !intlLinked && (
        <p className="mb-4 max-w-4xl rounded-xl border border-dashed border-neutral-800 px-4 py-3 text-xs leading-relaxed text-neutral-400">
          Sem dados desta liga no SofaScore.{" "}
          <Link href="/estatisticas/mapa" className="font-medium text-amber-400 hover:underline">
            Mapear no Mapa SofaScore
          </Link>
          .
        </p>
      )}

      <Suspense
        fallback={
          <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
            A carregar os jogos… (seleções e primeiras cargas demoram; depois é cache)
          </p>
        }
      >
        <JornadaBody
          liga={liga}
          jornada={jornada}
          today={today}
          nowISO={now.toISOString()}
          userId={user?.id ?? null}
        />
      </Suspense>
    </div>
  );
}

// Everything below the picker streams in: slow league loads (selections most
// of all) no longer hold the shell, so refreshing mid-load stops aborting the
// page with "destination stream closed early".
async function JornadaBody({
  liga,
  jornada,
  today,
  nowISO,
  userId,
}: {
  liga: string;
  jornada: string;
  today: string;
  nowISO: string;
  userId: string | null;
}) {
  const league = LEAGUES.find((l) => l.code === liga) ?? null;
  const now = new Date(nowISO);
  const supabase = await createClient();
  const maps = userId ? await loadMaps(supabase, userId, "tournament") : [];
  const mapped = league !== null && maps.some((m) => m.name_key === league.code);
  const intlLinked =
    userId !== null && (await loadMaps(supabase, userId, "team")).some((m) => m.name_key.startsWith("int:"));
  let sofaMeta: { games: number; latest: string | null; unlinked: string[] } | null = null;
  let intlMeta: { games: number; latest: string | null } | null = null;
  let intlFit: ReturnType<typeof fitInternational> | null = null;
  let data: Awaited<ReturnType<typeof loadLeague>> = null;
  if (league && mapped && userId) {
    const sofa = await loadSofaLeague(supabase, userId, league.code).catch(() => null);
    if (sofa) {
      sofaMeta = { games: sofa.data.matches.length, latest: sofa.data.latest, unlinked: sofa.unlinked };
      data = sofa.data;
    }
  } else if (league && intlLinked && userId) {
    // National sides have no rounds: upcoming games come from the teams' own
    // lists (grouped by competition), predictions from the international fit.
    const [intl, upcoming] = await Promise.all([
      loadSofaInternational(supabase, userId, now).catch(() => null),
      loadUpcomingIntl(supabase, userId, today, league.code === "int.nl").catch(() => []),
    ]);
    if (intl) {
      const windowFrom = isoDaysAgo(now, WINDOW_YEARS * 365);
      const recent = intl.games.filter((g) => g.date >= windowFrom);
      intlFit = fitInternational(recent, now);
      const fixtures = upcoming.map((g) => ({
        date: g.date,
        team1: g.home,
        team2: g.away,
        ft: null as [number, number] | null,
        round: g.tournament,
        time: g.time ?? undefined,
      }));
      data = {
        matches: recent.map(toPlayed),
        teams: intl.teams,
        fixtures,
        latest: recent.at(-1)?.date ?? null,
        seasons: [],
        history: intl.games.filter((g) => g.date < windowFrom).map(toPlayed),
        historyFrom: null,
        source: "sofascore",
        season: { id: "12m", from: isoDaysAgo(now, 365), to: today, label: "últimos 12 meses" },
        calendar: "rounds",
      };
      intlMeta = { games: recent.length, latest: recent.at(-1)?.date ?? null };
    }
  }

  const rounds = upcomingRounds(data?.fixtures ?? [], today);
  const options = rounds.slice(0, MAX_ROUNDS);
  const chosen = options.find((r) => r.name === jornada) ?? options[0] ?? null;
  // Month groups (leagues without rounds) hold a whole month: played games
  // would drown the few upcoming ones, so only the upcoming show (the played
  // ones live in the Conferido below). Proper rounds keep everything.

  let rows: RoundRow[] = [];
  if (data && chosen) {
    const base = baseRates(data.matches);
    rows = chosen.fixtures.map((f): RoundRow => {
      if (f.ft) return { fixture: f, status: "played", prediction: null, pick: null, fragile: false };
      if (f.date < today) return { fixture: f, status: "missing", prediction: null, pick: null, fragile: false };
      // National sides use the international fit (group games have a host).
      const prediction = intlFit
        ? predictInternational(intlFit, f.team1, f.team2, { neutral: false })
        : predict(data.matches, f.team1, f.team2, now);
      const minGames = Math.min(prediction.gamesHome, prediction.gamesAway);
      const few = minGames < MIN_GAMES;
      return {
        fixture: f,
        status: "upcoming",
        prediction,
        pick: few
          ? null
          : (recommend(
              prediction,
              base,
              f.team1,
              f.team2,
              intlFit ? 0.44 : leagueRates(data.matches, now).firstHalfShare
            )[0] ?? null),
        fragile: minGames < SOLID_GAMES,
      };
    });
  }

  // Checked suggestions: every finished game of this season, re-predicted with
  // only what was known BEFORE it (no peeking at the future), keeping the
  // model's first pick. Hit rate only — without the bookmaker's real odds
  // there is no profit to count.
  interface Checked {
    date: string;
    home: string;
    away: string;
    ft: [number, number];
    label: string;
    key: string;
    eventId: number | null;
    won: boolean;
  }
  const checked: Checked[] = [];
  // Clubs only: the international fit is one joint fit, refitting it per past
  // date would cost a full fit per game.
  if (data && !intlFit) {
    const pool = [...data.history, ...data.matches].sort((a, b) => a.date.localeCompare(b.date));
    for (const f of data.fixtures) {
      if (!f.ft || f.date >= today) continue;
      const before = pool.filter((m) => m.date < f.date);
      if (before.length === 0) continue;
      const gameDate = new Date(`${f.date}T12:00:00`);
      const prediction = predict(before, f.team1, f.team2, gameDate);
      if (Math.min(prediction.gamesHome, prediction.gamesAway) < MIN_GAMES) continue;
      const pick = recommend(
        prediction,
        baseRates(before),
        f.team1,
        f.team2,
        leagueRates(before, gameDate).firstHalfShare
      )[0];
      // Halves markets need the half-time score to check: fixtures don't
      // carry it, so they stay out of the checked count.
      if (!pick || pick.group === "halves") continue;
      checked.push({
        date: f.date,
        home: f.team1,
        away: f.team2,
        ft: f.ft,
        label: pick.label,
        key: pick.key,
        eventId: fixtureEventId(f),
        won: pick.won(f.ft),
      });
    }
    checked.sort((a, b) => b.date.localeCompare(a.date) || b.home.localeCompare(a.home));
  }
  const checkedWon = checked.filter((c) => c.won).length;

  return (
    <>
      {sofaMeta && (
        <p className="-mt-1 mb-3 rounded-xl border border-sky-800/50 bg-sky-950/20 px-4 py-2.5 text-xs leading-relaxed text-neutral-300">
          <span className="font-medium text-sky-300">Dados SofaScore:</span> {sofaMeta.games} jogos para o modelo
          {sofaMeta.latest ? `, até ${sofaMeta.latest.slice(8, 10)}/${sofaMeta.latest.slice(5, 7)}` : ""}
          {sofaMeta.unlinked.length > 0 ? `. Grafias por ligar no Mapa: ${sofaMeta.unlinked.join(", ")}.` : "."}
        </p>
      )}
      {league && data === null && (
        <p className="rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Não foi possível carregar os dados desta liga. Tenta outra vez daqui a pouco.
        </p>
      )}
      {intlMeta && (
        <p className="mb-3 rounded-xl border border-sky-800/50 bg-sky-950/20 px-4 py-2.5 text-xs leading-relaxed text-neutral-300">
          <span className="font-medium text-sky-300">Dados SofaScore (seleções):</span> {intlMeta.games} jogos nos
          últimos 8 anos{intlMeta.latest ? `, até ${intlMeta.latest.slice(8, 10)}/${intlMeta.latest.slice(5, 7)}` : ""}.
          Jogos de grupo têm dono da casa.
        </p>
      )}

      {league && data && !chosen && (
        <p className="text-sm text-neutral-500">
          {data.calendar === "days"
            ? "Desta liga só temos os jogos dos próximos dias, e neste momento não há nenhum nos dados. A fonte atualiza o calendário duas vezes por semana, por isso os próximos jogos aparecem lá para o meio da semana."
            : "Não há jogos por disputar nos dados desta liga."}
        </p>
      )}

      {league && data && chosen && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {options.map((r) => {
              // Month groups (leagues without rounds on SofaScore) are named
              // by month already: no first-date suffix like the Jornada tabs.
              const dated = roundLabel(r.name) !== r.name;
              const label =
                data.calendar === "days" || !dated
                  ? r.name
                  : `${roundLabel(r.name)} · ${r.first.slice(8, 10)}/${r.first.slice(5, 7)}`;
              return (
                <Link
                  key={r.name}
                  href={`/estatisticas/jornada?${new URLSearchParams({ liga: league.code, jornada: r.name })}`}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    r.name === chosen.name
                      ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40"
                      : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </div>

          <RoundTable
            rows={roundLabel(chosen.name) === chosen.name ? rows.filter((r) => r.status === "upcoming") : rows}
            liga={league.code}
            fonte="sofa"
            matches={data.matches}
          />

          {checked.length > 0 && (
            <details className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-neutral-200 hover:text-neutral-100">
                Conferido esta época: {checkedWon} em {checked.length} sugestões certas (
                {Math.round((checkedWon / checked.length) * 100)}
                %)
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {checked.slice(0, 12).map((c, i) => (
                  <li key={`${c.date}-${c.home}-${i}`} className="flex items-center gap-2">
                    <span className="shrink-0 text-neutral-500">
                      {c.date.slice(8, 10)}/{c.date.slice(5, 7)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-neutral-300">
                      {c.home} {c.ft[0]}–{c.ft[1]} {c.away} · {c.label}
                    </span>
                    <span className={c.won ? "shrink-0 font-bold text-emerald-400" : "shrink-0 font-bold text-red-400"}>
                      {c.won ? "✓" : "✗"}
                    </span>
                  </li>
                ))}
              </ul>
              {checked.length > 12 && (
                <p className="mt-1 text-[11px] text-neutral-500">e mais {checked.length - 12} anteriores.</p>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                Cada jogo foi previsto só com o que se sabia antes dele (sem espreitar o futuro). É taxa de acerto,
                não lucro: sem as odds reais da casa não há como contar dinheiro. Mercados de partes ficam de fora
                (os calendários não trazem o intervalo para conferir).
              </p>
              {userId && (
                <Suspense
                  fallback={
                    <p className="mt-3 text-xs text-neutral-500">A ir buscar as odds reais para contar o lucro…</p>
                  }
                >
                  <CheckedProfit
                    games={checked
                      .filter((c) => c.eventId !== null)
                      .map((c) => ({
                        eventId: c.eventId as number,
                        date: c.date,
                        home: c.home,
                        away: c.away,
                        ft: c.ft,
                        label: c.label,
                        key: c.key,
                        won: c.won,
                      }))}
                    userId={userId}
                  />
                </Suspense>
              )}
            </details>
          )}

          <p className="mt-3 text-xs leading-relaxed text-neutral-500">
            Clica num jogo para abrir a comparação das duas equipas, onde podes fazer ajustes (lesões, descanso...). Aqui
            as estimativas são as do modelo sem ajustes: não sabe de lesões, castigos nem motivação. A aposta sugerida só
            aparece quando o modelo vê claramente mais do que a média da liga, e o número é a odd a partir da qual
            compensaria; sem isso, o traço quer dizer que não há sugestão. Dados até{" "}
            {data.latest ? `${data.latest.slice(8, 10)}/${data.latest.slice(5, 7)}` : "?"}, a fonte atrasa-se alguns dias.
            Em Golos, o número é o esperado para a casa e o de fora.
            {data.calendar === "days" &&
              " Nesta liga o calendário só tem os jogos dos próximos dias (não há jornadas), com as horas de Portugal."}
          </p>
        </>
      )}

      {!league && (
        <p className="text-sm text-neutral-500">Escolhe uma liga para ver os próximos jogos.</p>
      )}
    </>
  );
}
