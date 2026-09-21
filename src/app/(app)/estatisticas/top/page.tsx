import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, loadLeague, type LeagueData } from "@/lib/footballData";
import { topBets } from "@/lib/topBets";
import { first, todayISO } from "@/lib/searchParams";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import TopBetsTable from "@/components/TopBetsTable";

const DEFAULT_ODD = 1.6;
const COUNTS = [5, 10, 20];

export default async function TopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;

  // The address can be edited: anything odd falls back to the defaults.
  const asked = Number.parseFloat(first(params.odd).replace(",", "."));
  const minOdd = Number.isFinite(asked) ? Math.min(6, Math.max(1.2, asked)) : DEFAULT_ODD;
  const count = COUNTS.includes(Number(first(params.n))) ? Number(first(params.n)) : 5;

  const now = new Date();
  const today = todayISO(now);
  const loaded = await Promise.all(
    LEAGUES.map(async (l) => ({ code: l.code, label: l.label, data: await loadLeague(l.code, now) }))
  );
  const leagues: { code: string; label: string; data: LeagueData }[] = [];
  for (const l of loaded) if (l.data) leagues.push({ code: l.code, label: l.label, data: l.data });
  const { bets, games, leagues: withRound } = topBets(leagues, today, now, { minOdd, count });
  const used = new Set(bets.map((b) => b.leagueCode));

  const field =
    "rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-amber-500";

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 text-sm text-neutral-500">
        As apostas mais prováveis da jornada mais próxima de cada liga, uma por jogo, que ainda assim paguem pelo menos
        a odd mínima.
      </p>

      <EstatisticasTabs />

      <form method="get" action="/estatisticas/top" className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Odd mínima</label>
          <input
            type="text"
            inputMode="decimal"
            name="odd"
            defaultValue={String(minOdd).replace(".", ",")}
            className={`${field} w-28`}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Quantas</label>
          <select name="n" defaultValue={String(count)} className={`${field} w-24`}>
            {COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white shadow-lg shadow-amber-600/20 transition hover:bg-amber-500"
        >
          Atualizar
        </button>
      </form>

      {bets.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Não há jogos por disputar nos dados, ou nenhuma aposta chega à odd mínima. Baixa-a e tenta outra vez.
        </p>
      ) : (
        <>
          <TopBetsTable bets={bets} />
          <p className="mt-2 text-xs text-neutral-500">
            {games} jogos analisados em {withRound} {withRound === 1 ? "liga" : "ligas"} (das {LEAGUES.length}: só
            entram as que já têm a próxima jornada nos dados)
            {used.size > 0 ? `; a lista vem de ${used.size} ${used.size === 1 ? "liga" : "ligas"}` : ""}.
          </p>
        </>
      )}

      <div className="mt-4 space-y-2 text-xs leading-relaxed text-neutral-500">
        <p>
          <span className="font-medium text-neutral-400">A odd é a do modelo, não a da casa.</span> Não temos as odds
          das casas de apostas. A <span className="font-medium text-neutral-400">odd justa</span> é 1 a dividir pela
          probabilidade, por isso uma odd mínima de {String(minOdd).replace(".", ",")} quer dizer probabilidades até{" "}
          {(100 / minOdd).toFixed(1).replace(".", ",")}%. A odd que a casa realmente paga costuma ser mais baixa, por causa
          da margem.
        </p>
        <p>
          <span className="font-medium text-neutral-400">Compensa a partir de</span> é a odd que a casa teria de pagar
          para valer a pena. É mais alta do que a odd justa de propósito: testei este mesmo critério na época passada
          (2.933 apostas em 18 ligas) e, no conjunto, o modelo acertou (dizia 57,7%, aconteceu 58,1%), mas as{" "}
          <span className="text-amber-400">5 melhores de cada semana acertaram só 56,4% quando o modelo lhes dava
          62,1%</span>: ao escolher sempre as mais altas, apanha-se as que o modelo sobrestima, e não acertaram mais do
          que as outras. Por isso essa coluna usa 93% da probabilidade. Com uns 57% de acerto, uma odd de 1,60 dá
          prejuízo, e só compensa se a casa pagar bastante mais.
        </p>
        <p>
          <span className="font-medium text-neutral-400">Fiabilidade por tipo:</span> em <em>Resultado</em> o modelo
          acerta bem em quem ganha. Em <em>Golos</em> e <em>Ambas marcam</em> fica perto da média da liga, e as
          probabilidades já estão puxadas para ela. A probabilidade da liga, por baixo de cada número, é quantas vezes
          essa aposta acontece nessa liga em geral: quando a probabilidade está{" "}
          <span className="text-red-400">abaixo da média da liga</span>, o modelo acha o jogo menos favorável do que o
          normal e a aposta só está na lista porque o teto de odd corta as mais prováveis. Não sabe de lesões, castigos nem motivação: clica num jogo para
          abrir a comparação e fazer os ajustes.
        </p>
      </div>
    </div>
  );
}
