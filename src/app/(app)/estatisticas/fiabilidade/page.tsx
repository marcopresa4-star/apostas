import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, loadLeague, seasonWindow } from "@/lib/footballData";
import { backtest, combine } from "@/lib/reliability";
import { first } from "@/lib/searchParams";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import ReliabilityTable, { type ReliabilityLine } from "@/components/ReliabilityTable";

export default async function FiabilidadePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const which = first(params.epoca) === "passada" ? "passada" : "atual";

  const now = new Date();
  const window = seasonWindow(now, which);

  // Every game of the window is predicted from the games before it, in each league.
  const leagues = await Promise.all(
    LEAGUES.map(async (l) => {
      const data = await loadLeague(l.code, now);
      return { label: l.label, result: data ? backtest(data.matches, window.from, window.to) : null };
    })
  );
  const total = combine(leagues.flatMap((l) => (l.result ? [l.result] : [])));
  const lines: ReliabilityLine[] = [...leagues, { label: "Todas as ligas", result: total }];

  const tab = (value: "atual" | "passada", label: string) => (
    <Link
      href={`/estatisticas/fiabilidade?${new URLSearchParams({ epoca: value })}`}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
        which === value
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
        Quanto o modelo acertou, jogo a jogo, em cada liga. Serve para veres se merece confiança antes de o usares.
      </p>

      <EstatisticasTabs />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">Época</span>
        {tab("atual", `Esta época (${seasonWindow(now, "atual").label}) até agora`)}
        {tab("passada", `Época passada (${seasonWindow(now, "passada").label})`)}
      </div>

      <ReliabilityTable lines={lines} />

      <div className="mt-3 space-y-1.5 text-xs leading-relaxed text-neutral-500">
        <p>
          <span className="font-medium text-neutral-400">Como se faz o teste:</span> cada jogo da época é previsto só
          com os jogos anteriores a ele, e a previsão compara-se com o que aconteceu e com um palpite ingénuo (sempre a
          média da liga até essa data).
        </p>
        <p>
          <span className="font-medium text-neutral-400">Quem ganha:</span> a percentagem de jogos em que a opção mais
          provável era a certa, contra a de escolher sempre o resultado mais comum da liga.{" "}
          <span className="font-medium text-neutral-400">Melhor que a média</span> mede quanto o erro das
          probabilidades desceu em relação a esse palpite: verde é melhor, vermelho pior, e &quot;≈ média&quot; é uma
          diferença de menos de 2%, que cabe no acaso. Nos golos e em ambas marcam usa-se o mesmo critério.
        </p>
        <p>
          <span className="font-medium text-neutral-400">Aposta sugerida:</span> a principal que o cartão sugeriria em
          cada jogo, quantas vezes se acertou, o que o modelo dizia e o que acontece em média na liga com o mesmo tipo de
          aposta. Acertar acima da média da liga é o que interessa, mas isto não é lucro: o lucro depende da odd.
        </p>
        <p className="text-amber-400/90">
          Um aviso sobre a época passada: os dois parâmetros do modelo (quanto pesam os jogos antigos e quanto se
          puxa cada equipa para a média) foram escolhidos precisamente com os jogos de 2025/26, por isso esses números
          são otimistas. Os de esta época são o teste a sério, porque o modelo nunca os viu, mas ainda há poucas
          jornadas e oscilam muito.
        </p>
      </div>
    </div>
  );
}
