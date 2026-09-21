import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, loadLeague } from "@/lib/footballData";
import MatchupForm, { type AdjustValues } from "@/components/MatchupForm";
import MatchupReport from "@/components/MatchupReport";
import { ADJUST_KEYS, adjustFromParams } from "@/lib/adjustments";

const DAY_MS = 86_400_000;

export default async function EstatisticasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const { liga = "", casa = "", fora = "" } = params;
  const raw: Record<string, string> = Object.fromEntries(
    ADJUST_KEYS.map((key) => [key, params[key] ?? ""])
  );
  const adjust = { home: adjustFromParams(raw, "casa"), away: adjustFromParams(raw, "fora") };

  const league = LEAGUES.find((l) => l.code === liga) ?? null;
  const now = new Date();
  const data = league ? await loadLeague(league.code, now) : null;

  const teams = data?.teams ?? [];
  const ready = data !== null && casa !== "" && fora !== "" && teams.includes(casa) && teams.includes(fora);
  const sameTeam = casa !== "" && casa === fora;

  // Swapping home and away swaps the adjustments too.
  const swapped: Record<string, string> = { liga, casa: fora, fora: casa };
  for (const key of ADJUST_KEYS) {
    const other = key.endsWith("_casa") ? key.replace("_casa", "_fora") : key.replace("_fora", "_casa");
    swapped[other] = raw[key];
  }
  const swapHref = `/estatisticas?${new URLSearchParams(swapped)}`;

  // The date of a team's last game in the data, to help fill in its rest days.
  const restHint = (team: string) => {
    if (!data || !team) return "";
    const last = data.fixtures
      .filter((f) => f.ft && (f.team1 === team || f.team2 === team))
      .map((f) => f.date)
      .sort()
      .at(-1);
    if (!last) return "";
    const days = Math.round((now.getTime() - new Date(`${last}T12:00:00`).getTime()) / DAY_MS);
    return `Último jogo nos dados: ${last.slice(8, 10)}/${last.slice(5, 7)} (há ${days} dias). A fonte pode estar atrasada.`;
  };

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Escolhe duas equipas da mesma liga e vê como têm jogado e a probabilidade de cada resultado se se
        enfrentassem.
      </p>

      <MatchupForm
        leagues={LEAGUES}
        liga={league?.code ?? ""}
        teams={teams}
        casa={casa}
        fora={fora}
        adjust={raw as unknown as AdjustValues}
        restHint={{ casa: restHint(casa), fora: restHint(fora) }}
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
          home={casa}
          away={fora}
          leagueLabel={league.label}
          latest={data.latest}
          swapHref={swapHref}
          now={now}
          fixtures={data.fixtures}
          adjust={adjust}
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
