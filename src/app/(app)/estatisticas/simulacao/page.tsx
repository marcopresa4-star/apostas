import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, hasFixtures, loadLeague } from "@/lib/footballData";
import { simulateSeason } from "@/lib/simulation";
import { first } from "@/lib/searchParams";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import LeaguePicker from "@/components/LeaguePicker";
import SimulationTable from "@/components/SimulationTable";

// Leagues here are ones a full calendar exists for (openfootball): the others
// only have the next few days' fixtures, too little to play out a whole season.
const SIM_LEAGUES = LEAGUES.filter((l) => hasFixtures(l.code) && l.code.split(".")[0] !== "int");
const TRIALS = 4000;

export default async function SimulacaoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const liga = first(params.liga);
  const grid = first(params.grid) === "1";

  const league = SIM_LEAGUES.find((l) => l.code === liga) ?? null;
  const now = new Date();
  const data = league ? await loadLeague(league.code, now) : null;
  const sim = data && data.calendar === "rounds" ? simulateSeason(data.fixtures, data.matches, now, { trials: TRIALS }) : null;

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Joga o resto da época milhares de vezes com a força atual de cada equipa, e conta em quantas delas cada uma
        fica em cada lugar.
      </p>

      <EstatisticasTabs />
      <LeaguePicker leagues={SIM_LEAGUES} liga={league?.code ?? ""} action="/estatisticas/simulacao" keep={grid ? { grid: "1" } : {}} />

      {league && data === null && (
        <p className="mb-4 max-w-4xl rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Não foi possível carregar os dados desta liga. Tenta outra vez daqui a pouco.
        </p>
      )}
      {league && data && data.calendar !== "rounds" && (
        <p className="mb-4 max-w-4xl rounded-lg bg-amber-950 px-4 py-3 text-sm text-amber-300">
          Esta liga só tem os jogos dos próximos dias, não o calendário todo da época, por isso não dá para a jogar até
          ao fim.
        </p>
      )}
      {league && sim && sim.teams.every((t) => t.remaining === 0) && (
        <p className="mb-4 max-w-4xl rounded-lg bg-neutral-900 px-4 py-3 text-sm text-neutral-400">
          Não há jogos por disputar nos dados: a época já está fechada aqui, sem nada para simular.
        </p>
      )}

      {sim && (
        <>
          <SimulationTable sim={sim} grid={grid} />
          <p className="mt-2 text-xs text-neutral-500">
            {sim.trials.toLocaleString("pt-PT")} épocas simuladas.{" "}
            {grid ? (
              <a href={`/estatisticas/simulacao?${new URLSearchParams({ liga: league!.code })}`} className="text-amber-400 hover:underline">
                Esconder a probabilidade de cada posição
              </a>
            ) : (
              <a
                href={`/estatisticas/simulacao?${new URLSearchParams({ liga: league!.code, grid: "1" })}`}
                className="text-amber-400 hover:underline"
              >
                Mostrar a probabilidade de cada posição
              </a>
            )}
          </p>

          <div className="mt-4 max-w-4xl space-y-2 text-xs leading-relaxed text-neutral-500">
            <p>
              <span className="font-medium text-neutral-400">Como é feito:</span> para cada jogo por disputar, o modelo
              dá os golos esperados de cada equipa (a mesma força usada na comparação de equipas e na Classificação), e
              sorteia-se um resultado ao acaso com essa força — {sim.trials.toLocaleString("pt-PT")} vezes seguidas. Em
              cada uma dessas épocas conta-se o lugar final de cada equipa; a percentagem é quantas vezes calhou esse
              lugar.
            </p>
            <p>
              <span className="font-medium text-neutral-400">Limites:</span> a força de cada equipa fica fixa como está
              hoje — não sabe que uma equipa pode melhorar, piorar, contratar ou perder um jogador importante a meio da
              época. Os desempates (pontos, diferença de golos, golos marcados) são os mesmos da tabela desta app, e
              podem não ser exatamente os da competição. Não sabe de fases finais, grupos nem play-offs.
            </p>
          </div>
        </>
      )}

      {!league && <p className="text-sm text-neutral-500">Escolhe uma liga para simular o resto da época.</p>}
    </div>
  );
}
