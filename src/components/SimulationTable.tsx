import type { SeasonSimulation } from "@/lib/simulation";

const pct = (p: number) => (p > 0 && p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);
const num1 = (n: number) => n.toFixed(1).replace(".", ",");

// One hue, light (barely there) to dark (certain): a probability heatmap, never
// a rainbow. Text stays light so it reads on every shade.
function cell(p: number): { bg: string; text: string } {
  const a = Math.min(1, Math.sqrt(p)); // sqrt spreads out the low end, where most of the table sits
  return { bg: `rgba(217, 119, 6, ${(0.06 + a * 0.8).toFixed(3)})`, text: a > 0.45 ? "#fff7ed" : "#a3a3a3" };
}

const tone = (p: number, good: boolean) =>
  p >= 0.4 ? (good ? "text-emerald-400" : "text-red-400") : p >= 0.15 ? "text-neutral-200" : "text-neutral-500";

// The season simulation as a table: each team's current spot, what is left, the
// expected final points and position, and the chance of the title, a top-3 finish
// or ending in the bottom 3. `grid` additionally shows every position's chance.
export default function SimulationTable({ sim, grid }: { sim: SeasonSimulation; grid: boolean }) {
  const n = sim.teams.length;
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <th className="px-2 py-2 font-semibold">#</th>
            <th className="px-2 py-2 font-semibold">Equipa</th>
            <th className="px-2 py-2 text-right font-semibold">J</th>
            <th className="px-2 py-2 text-right font-semibold">Pts</th>
            <th className="px-2 py-2 text-right font-semibold">Restam</th>
            <th className="px-2 py-2 text-right font-semibold" title="Média de pontos finais nas simulações">
              Pts esperados
            </th>
            <th className="px-2 py-2 text-right font-semibold" title="Média da posição final nas simulações">
              Posição média
            </th>
            <th className="px-2 py-2 text-right font-semibold">Título</th>
            <th className="px-2 py-2 text-right font-semibold">Top 3</th>
            <th className="px-2 py-2 text-right font-semibold">Últimos 3</th>
            {grid &&
              Array.from({ length: n }, (_, i) => (
                <th key={i} className="px-1.5 py-2 text-right font-semibold">
                  {i + 1}
                </th>
              ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/70">
          {sim.teams.map((t, i) => (
            <tr key={t.team}>
              <td className="px-2 py-2 text-neutral-500">{i + 1}</td>
              <td className="px-2 py-2 font-medium text-neutral-100">{t.team}</td>
              <td className="px-2 py-2 text-right text-neutral-300">{t.played}</td>
              <td className="px-2 py-2 text-right font-semibold text-neutral-100">{t.points}</td>
              <td className="px-2 py-2 text-right text-neutral-400">{t.remaining}</td>
              <td className="px-2 py-2 text-right text-neutral-200">{num1(t.avgPoints)}</td>
              <td className="px-2 py-2 text-right text-neutral-200">{num1(t.avgPosition)}</td>
              <td className={`px-2 py-2 text-right font-semibold ${tone(t.title, true)}`}>{pct(t.title)}</td>
              <td className={`px-2 py-2 text-right font-medium ${tone(t.top3, true)}`}>{pct(t.top3)}</td>
              <td className={`px-2 py-2 text-right font-medium ${tone(t.lastThree, false)}`}>{pct(t.lastThree)}</td>
              {grid &&
                t.positions.map((p, k) => {
                  const c = cell(p);
                  return (
                    <td key={k} className="px-1.5 py-2 text-right tabular-nums" style={{ backgroundColor: c.bg, color: c.text }}>
                      {p < 0.005 ? "" : Math.round(p * 100)}
                    </td>
                  );
                })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
