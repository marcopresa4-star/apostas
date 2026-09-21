import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, hasFixtures, loadLeague, type LeagueData } from "@/lib/footballData";
import { topBets } from "@/lib/topBets";
import type { PickGroup } from "@/lib/recommendation";
import { first, list, todayISO } from "@/lib/searchParams";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import TopBetsTable from "@/components/TopBetsTable";

const DEFAULT_ODD = 1.6;
const COUNTS = [5, 10, 20];
// Only leagues with games still to come can have a top.
const TOP_LEAGUES = LEAGUES.filter((l) => hasFixtures(l.code));
const DAYS = [
  { value: 0, label: "Toda a jornada" },
  { value: 1, label: "Só hoje" },
  { value: 2, label: "Hoje e amanhã" },
  { value: 3, label: "Próximos 3 dias" },
  { value: 7, label: "Próximos 7 dias" },
];
const GROUPS: { value: PickGroup; label: string }[] = [
  { value: "result", label: "Resultado" },
  { value: "goals", label: "Golos" },
  { value: "btts", label: "Ambas marcam" },
];

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
  const days = DAYS.some((d) => d.value === Number(first(params.dias))) ? Number(first(params.dias)) : 0;
  // Nothing ticked means everything: only what the page offers is accepted.
  const groups = GROUPS.map((g) => g.value).filter((g) => list(params.tipo).includes(g));
  const chosenLeagues = TOP_LEAGUES.map((l) => l.code as string).filter((code) => list(params.liga).includes(code));
  const filtered = days > 0 || groups.length > 0 || chosenLeagues.length > 0;

  const now = new Date();
  const today = todayISO(now);
  const loaded = await Promise.all(
    TOP_LEAGUES.filter((l) => chosenLeagues.length === 0 || chosenLeagues.includes(l.code)).map(async (l) => ({ code: l.code, label: l.label, data: await loadLeague(l.code, now) }))
  );
  const leagues: { code: string; label: string; data: LeagueData }[] = [];
  for (const l of loaded) if (l.data) leagues.push({ code: l.code, label: l.label, data: l.data });
  const { bets, games, leagues: withRound } = topBets(leagues, today, now, { minOdd, count, days, groups });
  // Some leagues only have the next few days' games, so they come and go.
  const daysOnly = leagues.filter((l) => l.data.calendar === "days");
  const used = new Set(bets.map((b) => b.leagueCode));

  const field =
    "rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-amber-500";

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
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
        <div>
          <label className="mb-1 block text-sm text-neutral-300">Dias</label>
          <select name="dias" defaultValue={String(days)} className={`${field} w-44`}>
            {DAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="mb-1 block text-sm text-neutral-300">
            Tipo de aposta <span className="text-neutral-500">(nenhum = todos)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {GROUPS.map((g) => (
              <label key={g.value} className="cursor-pointer">
                <input
                  type="checkbox"
                  name="tipo"
                  value={g.value}
                  defaultChecked={groups.includes(g.value)}
                  className="peer sr-only"
                />
                <span className="block rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-400 transition peer-checked:border-amber-500 peer-checked:bg-amber-950 peer-checked:text-amber-300 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-amber-500">
                  {g.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="submit"
          className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white shadow-lg shadow-amber-600/20 transition hover:bg-amber-500"
        >
          Atualizar
        </button>
        {filtered && (
          <Link
            href={`/estatisticas/top?odd=${String(minOdd)}&n=${count}`}
            className="py-2 text-sm text-neutral-500 hover:text-neutral-300"
          >
            Limpar filtros
          </Link>
        )}

        <details className="w-full rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2" open={chosenLeagues.length > 0}>
          <summary className="cursor-pointer text-sm text-neutral-300">
            Ligas{" "}
            <span className="text-neutral-500">
              ({chosenLeagues.length === 0 ? "todas" : `${chosenLeagues.length} de ${TOP_LEAGUES.length}`}; nenhuma marcada = todas)
            </span>
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {TOP_LEAGUES.map((l) => (
              <label key={l.code} className="cursor-pointer">
                <input
                  type="checkbox"
                  name="liga"
                  value={l.code}
                  defaultChecked={chosenLeagues.includes(l.code)}
                  className="peer sr-only"
                />
                <span className="block rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-400 transition peer-checked:border-amber-500 peer-checked:bg-amber-950 peer-checked:text-amber-300 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-amber-500">
                  {l.label}
                </span>
              </label>
            ))}
          </div>
        </details>
      </form>

      {bets.length === 0 ? (
        <p className="text-sm text-neutral-500">
          {filtered
            ? "Com estes filtros não há jogos por disputar nos dados, ou nenhuma aposta chega à odd mínima. Alarga os filtros ou baixa a odd."
            : "Não há jogos por disputar nos dados, ou nenhuma aposta chega à odd mínima. Baixa-a e tenta outra vez."}
        </p>
      ) : (
        <>
          <TopBetsTable bets={bets} />
          <p className="mt-2 text-xs text-neutral-500">
            {games} jogos analisados em {withRound} {withRound === 1 ? "liga" : "ligas"} (
            {days > 0
              ? "só entram jogos nos dias escolhidos que já estejam nos dados"
              : `das ${chosenLeagues.length || TOP_LEAGUES.length}: só entram as que já têm a próxima jornada nos dados`}
            )
            {used.size > 0 ? `; a lista vem de ${used.size} ${used.size === 1 ? "liga" : "ligas"}` : ""}.
          </p>
        </>
      )}

      <div className="mt-4 max-w-4xl space-y-2 text-xs leading-relaxed text-neutral-500">
        {daysOnly.length > 0 && (
          <p>
            <span className="font-medium text-neutral-400">Ligas só com os próximos dias:</span>{" "}
            {daysOnly.map((l) => l.label.split(" · ")[1] ?? l.label).join(", ")}. Nestas o calendário só tem os jogos
            dos próximos dias e atualiza-se duas vezes por semana, por isso só entram aqui quando há jogos nesse
            período (a hora é a de Portugal).
          </p>
        )}
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
