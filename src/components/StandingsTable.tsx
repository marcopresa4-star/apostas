import type { Rating } from "@/lib/standings";
import type { StandingRow } from "@/lib/standings";

const num = (n: number) => n.toFixed(2).replace(".", ",");
const CHIP = { V: "bg-emerald-600", E: "bg-neutral-600", D: "bg-red-600" } as const;

// Attack above 1 is good, defence below 1 is good (it is what the team concedes).
const attackColor = (a: number) => (a >= 1.1 ? "text-emerald-400" : a <= 0.9 ? "text-red-400" : "text-neutral-300");
const defenseColor = (d: number) => (d <= 0.9 ? "text-emerald-400" : d >= 1.1 ? "text-red-400" : "text-neutral-300");

export interface StandingsLine {
  standing: StandingRow;
  rating: Rating;
}

// The season's table with each team's attack, defence and overall strength.
export default function StandingsTable({ lines }: { lines: StandingsLine[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-[11px] uppercase tracking-wide text-neutral-500">
            <th className="px-2 py-2 text-left font-semibold">#</th>
            <th className="px-2 py-2 text-left font-semibold">Equipa</th>
            <th className="px-2 py-2 text-right font-semibold">J</th>
            <th className="px-2 py-2 text-right font-semibold">V</th>
            <th className="px-2 py-2 text-right font-semibold">E</th>
            <th className="px-2 py-2 text-right font-semibold">D</th>
            <th className="px-2 py-2 text-right font-semibold">Golos</th>
            <th className="px-2 py-2 text-right font-semibold">DG</th>
            <th className="px-2 py-2 text-right font-semibold">Pts</th>
            <th className="px-2 py-2 text-left font-semibold">Forma</th>
            <th className="px-2 py-2 text-right font-semibold" title="Golos que marca, contra a média da liga (1,00)">
              Ataque
            </th>
            <th className="px-2 py-2 text-right font-semibold" title="Golos que sofre, contra a média da liga (1,00): menos é melhor">
              Defesa
            </th>
            <th className="px-2 py-2 text-right font-semibold" title="Diferença de golos esperada por jogo contra uma equipa média">
              Força
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/70">
          {lines.map(({ standing: s, rating: r }, i) => (
            <tr key={s.team}>
              <td className="px-2 py-2 text-neutral-500">{i + 1}</td>
              <td className="px-2 py-2 font-medium text-neutral-100">{s.team}</td>
              <td className="px-2 py-2 text-right text-neutral-300">{s.played}</td>
              <td className="px-2 py-2 text-right text-neutral-300">{s.wins}</td>
              <td className="px-2 py-2 text-right text-neutral-300">{s.draws}</td>
              <td className="px-2 py-2 text-right text-neutral-300">{s.losses}</td>
              <td className="px-2 py-2 text-right text-neutral-400">
                {s.gf}:{s.ga}
              </td>
              <td className="px-2 py-2 text-right text-neutral-300">{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
              <td className="px-2 py-2 text-right font-bold text-neutral-100">{s.points}</td>
              <td className="px-2 py-2">
                <div className="flex gap-1">
                  {s.form.map((f, k) => (
                    <span
                      key={k}
                      className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white ${CHIP[f]}`}
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </td>
              <td className={`px-2 py-2 text-right font-medium ${attackColor(r.attack)}`}>{num(r.attack)}</td>
              <td className={`px-2 py-2 text-right font-medium ${defenseColor(r.defense)}`}>{num(r.defense)}</td>
              <td
                className={`px-2 py-2 text-right font-semibold ${r.goalDiff >= 0.2 ? "text-emerald-400" : r.goalDiff <= -0.2 ? "text-red-400" : "text-neutral-300"}`}
              >
                {r.goalDiff > 0 ? "+" : ""}
                {num(r.goalDiff)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
