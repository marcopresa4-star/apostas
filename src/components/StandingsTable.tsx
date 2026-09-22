import type { Rating } from "@/lib/standings";
import type { FormGame, StandingRow } from "@/lib/standings";

const num = (n: number) => n.toFixed(2).replace(".", ",");
const CHIP = { V: "bg-emerald-600", E: "bg-neutral-600", D: "bg-red-600" } as const;

// Attack above 1 is good, defence below 1 is good (it is what the team concedes).
const attackColor = (a: number) => (a >= 1.1 ? "text-emerald-400" : a <= 0.9 ? "text-red-400" : "text-neutral-300");
const defenseColor = (d: number) => (d <= 0.9 ? "text-emerald-400" : d >= 1.1 ? "text-red-400" : "text-neutral-300");

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "2-digit" });

// One result chip; hovering it spells the game out, the home team first (like the
// chips of the team cards). The first rows open it below the chip and the others
// above, so the table's own scroll box never cuts it.
function FormChip({ game, team, below }: { game: FormGame; team: string; below: boolean }) {
  return (
    <span className="group relative">
      <span
        tabIndex={0}
        className={`flex h-5 w-5 cursor-help items-center justify-center rounded text-[10px] font-bold text-white outline-none ring-white/60 focus-visible:ring-2 ${CHIP[game.result]}`}
      >
        {game.result}
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-0 z-30 hidden w-max max-w-[18rem] rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-left shadow-xl group-focus-within:block group-hover:block ${
          below ? "top-full mt-1.5" : "bottom-full mb-1.5"
        }`}
      >
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          {shortDate(game.date)} · {game.home ? "em casa" : "fora"}
        </span>
        <span className="block whitespace-nowrap text-xs text-neutral-200">
          {game.home ? team : game.opponent}{" "}
          <span className="font-bold text-neutral-100">{game.home ? `${game.gf}–${game.ga}` : `${game.ga}–${game.gf}`}</span>{" "}
          {game.home ? game.opponent : team}
        </span>
      </span>
    </span>
  );
}

export interface StandingsLine {
  standing: StandingRow;
  rating: Rating;
}

// The season's table with each team's attack, defence and overall strength. The
// two teams of a game being looked at can be `highlight`ed (home in green, away in
// blue, the colours of the chances above them).
export default function StandingsTable({
  lines,
  highlight,
}: {
  lines: StandingsLine[];
  highlight?: { home: string; away: string };
}) {
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
          {lines.map(({ standing: s, rating: r }, i) => {
            const side = highlight?.home === s.team ? "home" : highlight?.away === s.team ? "away" : null;
            return (
            <tr
              key={s.team}
              className={
                side === "home"
                  ? "bg-emerald-500/15 shadow-[inset_3px_0_0_0_var(--color-emerald-500)]"
                  : side === "away"
                    ? "bg-sky-500/15 shadow-[inset_3px_0_0_0_var(--color-sky-500)]"
                    : ""
              }
            >
              <td className="px-2 py-2 text-neutral-500">{i + 1}</td>
              <td className="px-2 py-2 font-medium text-neutral-100">
                {s.team}
                {side && (
                  <span
                    className={`ml-2 rounded px-1 text-[9px] font-semibold uppercase ${
                      side === "home" ? "bg-emerald-950 text-emerald-300" : "bg-sky-950 text-sky-300"
                    }`}
                  >
                    {side === "home" ? "casa" : "fora"}
                  </span>
                )}
              </td>
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
                  {s.form.map((game) => (
                    <FormChip key={`${game.date}-${game.opponent}`} game={game} team={s.team} below={i < 4} />
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
