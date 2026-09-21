import { gain, type Reliability } from "@/lib/reliability";

export interface ReliabilityLine {
  label: string;
  result: Reliability | null;
}

const pct = (p: number) => `${(p * 100).toFixed(1).replace(".", ",")}%`;
const FEW_GAMES = 60;

// How much better (green) or worse (red) than the naive guess; close to zero is
// "about the average", since a couple of percent is well within the noise.
function Gain({ value }: { value: number }) {
  const color = value >= 2 ? "text-emerald-400" : value <= -2 ? "text-red-400" : "text-neutral-400";
  const text = value >= 2 || value <= -2 ? `${value > 0 ? "+" : ""}${value.toFixed(1).replace(".", ",")}%` : "≈ média";
  return <span className={`font-medium ${color}`}>{text}</span>;
}

// The model's record league by league, and overall.
export default function ReliabilityTable({ lines }: { lines: ReliabilityLine[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <th className="px-3 py-2 font-semibold">Liga</th>
            <th className="px-3 py-2 text-right font-semibold">Jogos</th>
            <th className="px-3 py-2 text-right font-semibold">Quem ganha: acertou</th>
            <th className="px-3 py-2 text-right font-semibold">Melhor que a média</th>
            <th className="px-3 py-2 text-right font-semibold">+2,5 golos</th>
            <th className="px-3 py-2 text-right font-semibold">Ambas marcam</th>
            <th className="px-3 py-2 font-semibold">Aposta sugerida principal</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/70">
          {lines.map(({ label, result: r }) => {
            const total = label === "Todas as ligas";
            const few = r !== null && r.games < FEW_GAMES;
            return (
              <tr key={label} className={total ? "bg-neutral-800/40 font-semibold" : few ? "opacity-60" : ""}>
                <td className="px-3 py-2.5 text-neutral-100">
                  {label}
                  {few && <span className="block text-[10px] font-normal text-amber-400">poucos jogos</span>}
                </td>
                {r === null ? (
                  <td colSpan={6} className="px-3 py-2.5 text-xs text-neutral-500">
                    Sem jogos nesta época.
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-2.5 text-right text-neutral-300">{r.games}</td>
                    <td className="px-3 py-2.5 text-right text-neutral-200">
                      {pct(r.accuracy)} <span className="text-[11px] text-neutral-500">(média: {pct(r.baselineAccuracy)})</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Gain value={gain(r.logLoss, r.baselineLogLoss)} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Gain value={gain(r.over25, r.baselineOver25)} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Gain value={gain(r.btts, r.baselineBtts)} />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-neutral-300">
                      {r.picks.count === 0 ? (
                        <span className="text-neutral-500">sem sugestões</span>
                      ) : (
                        <>
                          <span className="font-medium text-neutral-100">{pct(r.picks.hitRate)}</span> em {r.picks.count}
                          <span className="block text-[11px] text-neutral-500">
                            o modelo dizia {pct(r.picks.claimed)}; a média da liga é {pct(r.picks.leagueRate)}
                          </span>
                        </>
                      )}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
