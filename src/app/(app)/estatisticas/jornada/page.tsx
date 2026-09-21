import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, hasFixtures, loadLeague } from "@/lib/footballData";
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
  const data = league ? await loadLeague(league.code, now) : null;

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
        leagues={LEAGUES.filter((l) => hasFixtures(l.code))}
        liga={league?.code ?? ""}
        action="/estatisticas/jornada"
      />
      <p className="-mt-3 mb-5 text-[11px] text-neutral-600">
        Não aparecem as ligas de que só temos resultados, sem os jogos que vêm aí (Áustria, Roménia, Polónia, Dinamarca,
        Suíça, México, Japão, Brasil, Argentina, EUA, Noruega, Suécia, Finlândia, Irlanda e China): para essas usa a
        comparação de equipas.
      </p>

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

          <RoundTable rows={rows} liga={league.code} />

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
