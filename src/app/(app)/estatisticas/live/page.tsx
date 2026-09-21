import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, loadLeague } from "@/lib/footballData";
import { leagueRates, predict } from "@/lib/footballModel";
import { first } from "@/lib/searchParams";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import LiveTeamsForm from "@/components/LiveTeamsForm";
import LiveCalculator from "@/components/LiveCalculator";

// What a typical league scores when no teams are chosen, and how its goals split
// around half time.
const TYPICAL = { home: 1.4, away: 1.1, firstHalfShare: 0.44 };

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const liga = first(params.liga);
  const casa = first(params.casa);
  const fora = first(params.fora);

  const league = LEAGUES.find((l) => l.code === liga) ?? null;
  const now = new Date();
  const data = league ? await loadLeague(league.code, now) : null;
  const teams = data?.teams ?? [];
  const chosen = data !== null && casa !== "" && fora !== "" && casa !== fora && teams.includes(casa) && teams.includes(fora);

  // With two teams, the expected goals of the game are the model's own.
  let expected = TYPICAL;
  if (data && chosen) {
    const prediction = predict(data.matches, casa, fora, now);
    expected = {
      home: prediction.lambdaHome,
      away: prediction.lambdaAway,
      firstHalfShare: leagueRates(data.matches, now).firstHalfShare,
    };
  } else if (data) {
    expected = { ...TYPICAL, firstHalfShare: leagueRates(data.matches, now).firstHalfShare };
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Um jogo a decorrer: escreve o minuto e o resultado e vê a probabilidade do que falta, com a odd justa para
        comparares com a odd live da casa.
      </p>

      <EstatisticasTabs />
      <LiveTeamsForm leagues={LEAGUES} liga={league?.code ?? ""} teams={teams} casa={casa} fora={fora} />

      {league && data === null && (
        <p className="mb-4 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Não foi possível carregar os dados desta liga. Podes usar a calculadora com valores típicos.
        </p>
      )}
      {casa !== "" && casa === fora && (
        <p className="mb-4 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">Escolhe duas equipas diferentes.</p>
      )}

      {/* Keyed by the teams, so choosing others starts the calculator afresh. */}
      <LiveCalculator
        key={`${league?.code ?? ""}|${chosen ? casa : ""}|${chosen ? fora : ""}`}
        home={chosen ? casa : ""}
        away={chosen ? fora : ""}
        lambdaHome={expected.home}
        lambdaAway={expected.away}
        firstHalfShare={expected.firstHalfShare}
        fromModel={chosen}
      />
    </div>
  );
}
