import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, hasFixtures, isInternational, loadLeague } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps } from "@/lib/sofaHistory";
import { loadSofaLeague } from "@/lib/sofaLeague";
import { predict } from "@/lib/footballModel";
import { roundLabel, upcomingRounds } from "@/lib/rounds";
import { MIN_GAMES, SOLID_GAMES, baseRates, recommend } from "@/lib/recommendation";
import { first, todayISO } from "@/lib/searchParams";
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
  let sofaMeta: { games: number; latest: string | null; unlinked: string[] } | null = null;
  let data: Awaited<ReturnType<typeof loadLeague>> = null;
  if (league && mapped && user) {
    const sofa = await loadSofaLeague(supabase, user.id, league.code).catch(() => null);
    if (sofa) {
      sofaMeta = { games: sofa.data.matches.length, latest: sofa.data.latest, unlinked: sofa.unlinked };
      data = sofa.data;
    }
  }

  const rounds = upcomingRounds(data?.fixtures ?? [], today);
  const options = rounds.slice(0, MAX_ROUNDS);
  const chosen = options.find((r) => r.name === jornada) ?? options[0] ?? null;

  let rows: RoundRow[] = [];
  if (data && chosen) {
    const base = baseRates(data.matches);
    rows = chosen.fixtures.map((f): RoundRow => {
      if (f.ft) return { fixture: f, status: "played", prediction: null, pick: null, fragile: false };
      if (f.date < today) return { fixture: f, status: "missing", prediction: null, pick: null, fragile: false };
      const prediction = predict(data.matches, f.team1, f.team2, now);
      const minGames = Math.min(prediction.gamesHome, prediction.gamesAway);
      const few = minGames < MIN_GAMES;
      return {
        fixture: f,
        status: "upcoming",
        prediction,
        pick: few ? null : (recommend(prediction, base, f.team1, f.team2)[0] ?? null),
        fragile: minGames < SOLID_GAMES,
      };
    });
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Os próximos jogos de uma liga, cada um com a probabilidade de cada resultado e a aposta que o modelo sugeriria.
      </p>

      <EstatisticasTabs />
      <LeaguePicker
        leagues={LEAGUES.filter(
          (l) => !isInternational(l.code) && (hasFixtures(l.code) || maps.some((m) => m.name_key === l.code))
        )}
        liga={league?.code ?? ""}
        action="/estatisticas/jornada"
      />
      {league && !mapped && (
        <p className="mb-4 max-w-4xl rounded-xl border border-dashed border-neutral-800 px-4 py-3 text-xs leading-relaxed text-neutral-400">
          Sem dados desta liga no SofaScore.{" "}
          <Link href="/estatisticas/mapa" className="font-medium text-amber-400 hover:underline">
            Mapear no Mapa SofaScore
          </Link>
          .
        </p>
      )}
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
            {options.map((r) => (
              <Link
                key={r.name}
                href={`/estatisticas/jornada?${new URLSearchParams({ liga: league.code, jornada: r.name })}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  r.name === chosen.name
                    ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40"
                    : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
                }`}
              >
                {data.calendar === "days" ? r.name : `${roundLabel(r.name)} · ${r.first.slice(8, 10)}/${r.first.slice(5, 7)}`}
              </Link>
            ))}
          </div>

          <RoundTable rows={rows} liga={league.code} fonte="sofa" />

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
    </div>
  );
}
