import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, isInternational, loadLeague } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps } from "@/lib/sofaHistory";
import { loadSofaLeague } from "@/lib/sofaLeague";

// Leagues that split into phases or groups: a table adding up every game is not the official one.
const PHASED = new Set(["ro.1", "dk.1", "ch.1", "sco.1", "be.1", "at.1", "mx.1", "ar.1", "us.1", "tr.1", "gr.1", "eu.1", "eu.2", "eu.3"]);
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
  const fonteParam = first(params.fonte);

  // National teams have no table.
  const league = LEAGUES.find((l) => l.code === liga && !isInternational(l.code)) ?? null;
  const now = new Date();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const maps = user ? await loadMaps(supabase, user.id, "tournament") : [];
  const tournamentMap = league ? maps.find((m) => m.name_key === league.code) : null;
  // SofaScore first where mapped, files otherwise (explicit ?fonte=ficheiros
  // always respected).
  const useSofa = (fonteParam === "sofa" || (fonteParam === "" && tournamentMap)) && league !== null && tournamentMap != null && user !== null;

  let data: Awaited<ReturnType<typeof loadLeague>> = null;
  let sofa: { seasons: string[]; games: number; latest: string | null; unlinked: string[] } | null = null;
  if (league) {
    if (useSofa) {
      const loaded = await loadSofaLeague(supabase, user!.id, league.code).catch(() => null);
      if (loaded) {
        data = loaded.data;
        sofa = { seasons: loaded.seasonNames.slice(0, 3), games: loaded.data.matches.length, latest: loaded.data.latest, unlinked: loaded.unlinked };
      }
    } else {
      data = await loadLeague(league.code, now);
    }
  }

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
      <LeaguePicker
        leagues={LEAGUES.filter((l) => !isInternational(l.code))}
        liga={league?.code ?? ""}
        action="/estatisticas/classificacao"
        keep={{ ordem: order }}
      />
      {league && !tournamentMap && (
        <p className="mb-4 max-w-4xl rounded-xl border border-dashed border-neutral-800 px-4 py-3 text-xs leading-relaxed text-neutral-400">
          Sem dados desta liga no SofaScore.{" "}
          <Link href="/estatisticas/mapa" className="font-medium text-amber-400 hover:underline">
            Mapear no Mapa SofaScore
          </Link>
          .
        </p>
      )}

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

          {useSofa && sofa === null && (
            <p className="mb-3 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
              Não foi possível ler o SofaScore (scraper desligado?). A fonte Ficheiros continua a funcionar.
            </p>
          )}
          {sofa && (
            <div className="mb-3 rounded-xl border border-sky-800/50 bg-sky-950/20 px-4 py-3 text-xs leading-relaxed text-neutral-300">
              <p>
                <span className="font-medium text-sky-300">Dados SofaScore:</span> {sofa.games} jogos (
                {sofa.seasons.join(" · ")}); último resultado{" "}
                {sofa.latest ? `${sofa.latest.slice(8, 10)}/${sofa.latest.slice(5, 7)}` : "—"}.
                Primeira carga demora ~1 min (lê jornada a jornada); depois é cache.
              </p>
              {sofa.unlinked.length > 0 && (
                <p className="mt-1 text-amber-300/90">
                  Grafias por ligar no Mapa ({sofa.unlinked.length}): {sofa.unlinked.join(", ")}. Contam separadas na
                  tabela.
                </p>
              )}
            </div>
          )}

          <StandingsTable lines={lines} />

          <div className="mt-3 space-y-1.5 text-xs leading-relaxed text-neutral-500">
            {PHASED.has(league.code) && (
              <p className="text-amber-400/90">
                Esta liga tem fases finais, grupos ou pontos que se dividem a meio da época: a tabela soma todos os
                jogos que estão nos dados e pode não ser igual à oficial.
              </p>
            )}
            <p>
              <span className="font-medium text-neutral-400">Ataque</span> e{" "}
              <span className="font-medium text-neutral-400">Defesa</span> comparam a equipa com a média da liga (1,00).
              Ataque 1,30 é marcar 30% acima da média; defesa 0,70 é sofrer 30% abaixo (menos é melhor). A{" "}
              <span className="font-medium text-neutral-400">Força</span> é a diferença de golos esperada por jogo contra
              uma equipa média.
            </p>
            <p>
              A classificação usa só os jogos desta época, com os resultados que a fonte já tem (
              {sofa && sofa.latest
                ? `SofaScore até ${sofa.latest.slice(8, 10)}/${sofa.latest.slice(5, 7)}`
                : data.latest
                  ? `até ${data.latest.slice(8, 10)}/${data.latest.slice(5, 7)}`
                  : "sem jogos"}
              ), por isso pode faltar um jogo ou outro. A força usa também as épocas anteriores, com menos peso, e puxa as equipas com
              poucos jogos para a média: é a mesma que sustenta as probabilidades, e pode não bater com a tabela.
            </p>
          </div>
        </>
      )}

      {!league && <p className="text-sm text-neutral-500">Escolhe uma liga para ver a classificação.</p>}
    </div>
  );
}
