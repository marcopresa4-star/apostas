import type { ReliabilityRow, ReliabilitySummary } from "@/lib/betReliability";

const pct = (p: number) => `${(p * 100).toFixed(1).replace(".", ",")}%`;
const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(2, 4)}`;

function Tile({ label, value, tone = "text-neutral-100" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-center">
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
    </div>
  );
}

// Compares your own settled bets with what the model would have said about them
// at the time (only for leagues we cover, and only for the plainest wordings of
// selection). Shows if you tend to pick above or below the model's own sense of
// value, not just whether you win.
export default function BetReliabilityCard({ summary, rows }: { summary: ReliabilitySummary; rows: ReliabilityRow[] }) {
  if (summary.matched === 0) {
    return (
      <div className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="mb-1 text-sm font-semibold text-neutral-300">Fiabilidade das tuas apostas</h3>
        <p className="text-xs text-neutral-500">
          Ainda não há apostas resolvidas em ligas que cobrimos com uma seleção que perceba (vitória, 1X/X2, mais/menos
          golos, ambas marcam). {summary.unmatched > 0 ? `${summary.unmatched} não deram para comparar.` : ""}
        </p>
      </div>
    );
  }

  const matched = rows.filter((r) => r.modelP !== null && ["green", "red", "half_green", "half_red"].includes(r.status));

  return (
    <div className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-300">Fiabilidade das tuas apostas</h3>
      <p className="mb-3 text-xs text-neutral-500">
        Para {summary.matched} apostas resolvidas ({summary.unmatched} não deram para comparar), o que o modelo dizia
        na altura, com só os jogos anteriores.
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Comparadas" value={String(summary.matched)} />
        <Tile
          label="O teu acerto"
          value={summary.hitRate === null ? "—" : pct(summary.hitRate)}
          tone={summary.hitRate !== null && summary.hitRate >= 0.5 ? "text-emerald-400" : "text-neutral-100"}
        />
        <Tile label="O modelo dizia" value={summary.claimed === null ? "—" : pct(summary.claimed)} />
        <Tile label="Média da liga" value={summary.leagueRate === null ? "—" : pct(summary.leagueRate)} />
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-2">
          <p className="text-xs text-emerald-300">
            <span className="font-semibold">{summary.aboveAverage.count}</span> apostas em que o modelo achava mais
            provável do que a média da liga
          </p>
          <p className="text-lg font-bold text-neutral-100">
            {summary.aboveAverage.hitRate === null ? "—" : pct(summary.aboveAverage.hitRate)}
            <span className="ml-1 text-xs font-normal text-neutral-500">de acerto</span>
          </p>
        </div>
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2">
          <p className="text-xs text-amber-300">
            <span className="font-semibold">{summary.belowAverage.count}</span> apostas em que o modelo achava menos
            provável do que a média da liga
          </p>
          <p className="text-lg font-bold text-neutral-100">
            {summary.belowAverage.hitRate === null ? "—" : pct(summary.belowAverage.hitRate)}
            <span className="ml-1 text-xs font-normal text-neutral-500">de acerto</span>
          </p>
        </div>
      </div>

      {matched.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-amber-400 hover:underline">
            Ver as {matched.length} apostas usadas
          </summary>
          <div className="mt-2 max-h-64 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-neutral-500">
                  <th className="py-1 pr-2 font-medium">Data</th>
                  <th className="py-1 pr-2 font-medium">Jogo</th>
                  <th className="py-1 pr-2 font-medium">Aposta</th>
                  <th className="py-1 pr-2 text-right font-medium">Modelo</th>
                  <th className="py-1 pr-2 text-right font-medium">Liga</th>
                  <th className="py-1 text-right font-medium">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {matched.map((r) => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td className="py-1 pr-2 text-neutral-500">{shortDate(r.date)}</td>
                    <td className="py-1 pr-2 text-neutral-300">
                      {r.home} <span className="text-neutral-600">v</span> {r.away}
                    </td>
                    <td className="py-1 pr-2 text-neutral-200">
                      {r.selection}
                      {r.fragile && (
                        <span className="ml-1 rounded bg-amber-950 px-1 text-[9px] font-semibold text-amber-400">frágil</span>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-right font-medium text-neutral-100">{pct(r.modelP!)}</td>
                    <td className="py-1 pr-2 text-right text-neutral-400">{pct(r.base!)}</td>
                    <td className="py-1 text-right">
                      <span
                        className={
                          r.status === "green" || r.status === "half_green" ? "text-emerald-400" : "text-red-400"
                        }
                      >
                        {r.status === "green" ? "Green" : r.status === "red" ? "Red" : r.status === "half_green" ? "Meia ganha" : "Meia perdida"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
        Só entram apostas de ligas que cobrimos e escritas de forma clara (vitória de uma equipa, 1X/X2, mais/menos
        golos, ambas marcam); handicaps, marcadores exatos e outras não dão para comparar. &quot;Frágil&quot; marca uma
        estimativa com poucos jogos de uma das equipas nos dados, como no resto da app.
      </p>
    </div>
  );
}
