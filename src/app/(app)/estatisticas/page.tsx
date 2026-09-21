import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, loadLeague } from "@/lib/footballData";
import MatchupForm from "@/components/MatchupForm";
import MatchupReport from "@/components/MatchupReport";

export default async function EstatisticasPage({
  searchParams,
}: {
  searchParams: Promise<{ liga?: string; casa?: string; fora?: string }>;
}) {
  await requireAdmin();
  const { liga = "", casa = "", fora = "" } = await searchParams;

  const league = LEAGUES.find((l) => l.code === liga) ?? null;
  const now = new Date();
  const data = league ? await loadLeague(league.code, now) : null;

  const teams = data?.teams ?? [];
  const ready = data !== null && casa !== "" && fora !== "" && teams.includes(casa) && teams.includes(fora);
  const sameTeam = casa !== "" && casa === fora;

  const swapHref = `/estatisticas?${new URLSearchParams({ liga, casa: fora, fora: casa })}`;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Escolhe duas equipas da mesma liga e vê como têm jogado e a probabilidade de cada resultado se se
        enfrentassem.
      </p>

      <MatchupForm leagues={LEAGUES} liga={league?.code ?? ""} teams={teams} casa={casa} fora={fora} />

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
          home={casa}
          away={fora}
          leagueLabel={league.label}
          latest={data.latest}
          swapHref={swapHref}
          now={now}
          fixtures={data.fixtures}
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
