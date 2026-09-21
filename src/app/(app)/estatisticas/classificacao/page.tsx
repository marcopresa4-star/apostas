import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, loadLeague } from "@/lib/footballData";
import { buildStandings, ratings } from "@/lib/standings";
import { first } from "@/lib/searchParams";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import LeaguePicker from "@/components/LeaguePicker";
import StandingsTable, { type StandingsLine } from "@/components/StandingsTable";

export default async function ClassificacaoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const liga = first(params.liga);
  const order = first(params.ordem) === "forca" ? "forca" : "pontos";

  const league = LEAGUES.find((l) => l.code === liga) ?? null;
  const now = new Date();
  const data = league ? await loadLeague(league.code, now) : null;

  let lines: StandingsLine[] = [];
  if (data) {
    const { rows } = ratings(data.matches, data.teams, now);
    const byTeam = new Map(rows.map((r) => [r.team, r]));
    lines = buildStandings(data.fixtures)
      .map((standing) => ({ standing, rating: byTeam.get(standing.team)! }))
      .filter((line) => line.rating);
    if (order === "forca") lines.sort((a, b) => b.rating.goalDiff - a.rating.goalDiff);
  }

  const tab = (value: "pontos" | "forca", label: string) => (
    <Link
      href={`/estatisticas/classificacao?${new URLSearchParams({ liga, ordem: value })}`}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
        order === value
          ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40"
          : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 text-sm text-neutral-500">
        A classificação da época e a força de cada equipa a marcar e a defender, calculadas a partir dos resultados.
      </p>

      <EstatisticasTabs />
      <LeaguePicker leagues={LEAGUES} liga={league?.code ?? ""} action="/estatisticas/classificacao" keep={{ ordem: order }} />

      {league && data === null && (
        <p className="rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Não foi possível carregar os dados desta liga. Tenta outra vez daqui a pouco.
        </p>
      )}

      {league && data && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-500">Ordenar por</span>
            {tab("pontos", "Pontos")}
            {tab("forca", "Força")}
          </div>

          <StandingsTable lines={lines} />

          <div className="mt-3 space-y-1.5 text-xs leading-relaxed text-neutral-500">
            <p>
              <span className="font-medium text-neutral-400">Ataque</span> e{" "}
              <span className="font-medium text-neutral-400">Defesa</span> comparam a equipa com a média da liga (1,00).
              Ataque 1,30 é marcar 30% acima da média; defesa 0,70 é sofrer 30% abaixo (menos é melhor). A{" "}
              <span className="font-medium text-neutral-400">Força</span> é a diferença de golos esperada por jogo contra
              uma equipa média.
            </p>
            <p>
              A classificação usa só os jogos desta época, com os resultados que a fonte já tem (
              {data.latest ? `até ${data.latest.slice(8, 10)}/${data.latest.slice(5, 7)}` : "sem jogos"}), por isso pode
              faltar um jogo ou outro. A força usa também as épocas anteriores, com menos peso, e puxa as equipas com
              poucos jogos para a média: é a mesma que sustenta as probabilidades, e pode não bater com a tabela.
            </p>
          </div>
        </>
      )}

      {!league && <p className="text-sm text-neutral-500">Escolhe uma liga para ver a classificação.</p>}
    </div>
  );
}
