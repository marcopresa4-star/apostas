import type { TeamGame } from "@/lib/footballModel";

// The last games as a timeline, oldest on the left: for each game a bar with
// the goals scored and one with the goals conceded. Blue and orange are the
// first two slots of the chart palette (they stay apart for colour-blind
// readers, and are not the result colours used by the chips above).
const MAX_GAMES = 12;
const PLOT_PX = 96;
const SCORED = "bg-[#3987e5]";
const CONCEDED = "bg-[#d95926]";

const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const dot = (n: number) => n.toFixed(1).replace(".", ",");

export default function FormChart({ name, games }: { name: string; games: TeamGame[] }) {
  // `games` come most recent first.
  const shown = games.slice(0, MAX_GAMES).reverse();
  if (shown.length < 2) return null;

  const top = Math.max(3, ...shown.flatMap((g) => [g.gf, g.ga]));
  const step = top > 5 ? 2 : 1;
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  const avgFor = shown.reduce((s, g) => s + g.gf, 0) / shown.length;
  const avgAgainst = shown.reduce((s, g) => s + g.ga, 0) / shown.length;

  return (
    <div className="mt-3">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Golos por jogo · últimos {shown.length}
        </p>
        <p className="flex items-center gap-3 text-[11px] text-neutral-400">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${SCORED}`} />
            Marcados (média {dot(avgFor)})
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${CONCEDED}`} />
            Sofridos (média {dot(avgAgainst)})
          </span>
        </p>
      </div>

      {/* The top of the scale sticks out above the plot, hence the room. */}
      <div className="mt-3 flex gap-1.5">
        {/* Scale, in whole goals. */}
        <div className="relative w-4 shrink-0 text-right text-[10px] text-neutral-500" style={{ height: PLOT_PX }}>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 leading-none"
              style={{ bottom: `${(t / top) * 100}%` }}
            >
              {t}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div
            role="img"
            aria-label={`${name}: golos marcados e sofridos nos últimos ${shown.length} jogos, do mais antigo para o mais recente`}
            className="relative"
            style={{ height: PLOT_PX }}
          >
            {ticks.map((t) => (
              <div
                key={t}
                aria-hidden
                className="absolute inset-x-0 border-t border-neutral-800"
                style={{ bottom: `${(t / top) * 100}%` }}
              />
            ))}
            <div className="absolute inset-0 flex items-end justify-between gap-1">
              {shown.map((g) => (
                <span key={`${g.date}-${g.opponent}`} className="group relative flex h-full flex-1 items-end justify-center gap-0.5">
                  <span
                    className={`w-full max-w-3 rounded-t-[4px] ${SCORED}`}
                    style={{ height: `${(g.gf / top) * 100}%` }}
                  />
                  <span
                    className={`w-full max-w-3 rounded-t-[4px] ${CONCEDED}`}
                    style={{ height: `${(g.ga / top) * 100}%` }}
                  />
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-max max-w-[16rem] -translate-x-1/2 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-left shadow-xl group-hover:block"
                  >
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                      {dayMonth(g.date)} · {g.competition ? `${g.competition} · ` : ""}
                      {g.neutral ? "campo neutro" : g.home ? "em casa" : "fora"}
                    </span>
                    <span className="block text-xs text-neutral-200">
                      {g.home ? name : g.opponent}{" "}
                      <span className="font-bold text-neutral-100">{g.home ? `${g.gf}–${g.ga}` : `${g.ga}–${g.gf}`}</span>{" "}
                      {g.home ? g.opponent : name}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* Result of each game under its bars, and the dates at the ends. */}
          <div className="mt-1 flex justify-between gap-1">
            {shown.map((g) => (
              <span key={`r-${g.date}-${g.opponent}`} className="flex-1 text-center text-[10px] font-semibold text-neutral-400">
                {g.result}
              </span>
            ))}
          </div>
          <div className="mt-0.5 flex justify-between text-[10px] text-neutral-500">
            <span>{dayMonth(shown[0].date)}</span>
            <span>{dayMonth(shown[shown.length - 1].date)}</span>
          </div>
        </div>
      </div>

      <details className="mt-1.5 text-[11px] text-neutral-500">
        <summary className="cursor-pointer hover:text-neutral-300">Ver em tabela</summary>
        <table className="mt-1 w-full text-left text-neutral-400">
          <thead>
            <tr className="text-neutral-500">
              <th className="py-0.5 pr-2 font-medium">Data</th>
              <th className="py-0.5 pr-2 font-medium">Adversário</th>
              <th className="py-0.5 pr-2 font-medium">Marcou</th>
              <th className="py-0.5 pr-2 font-medium">Sofreu</th>
              <th className="py-0.5 font-medium">Res.</th>
            </tr>
          </thead>
          <tbody>
            {[...shown].reverse().map((g) => (
              <tr key={`t-${g.date}-${g.opponent}`}>
                <td className="py-0.5 pr-2">{dayMonth(g.date)}</td>
                <td className="py-0.5 pr-2">
                  {g.opponent} ({g.neutral ? "neutro" : g.home ? "casa" : "fora"})
                </td>
                <td className="py-0.5 pr-2">{g.gf}</td>
                <td className="py-0.5 pr-2">{g.ga}</td>
                <td className="py-0.5">{g.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
