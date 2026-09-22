import Link from "next/link";
import type { LiveGame } from "@/lib/liveBoard";
import type { Summary } from "@/lib/footballModel";

const num1 = (n: number) => n.toFixed(1).replace(".", ",");

export interface BoardStats {
  home: Summary | null;
  away: Summary | null;
  leagueLabel: string;
}

const CHIP = { V: "bg-emerald-600", E: "bg-neutral-600", D: "bg-red-600" } as const;

function Form({ form }: { form: ("V" | "E" | "D")[] }) {
  if (form.length === 0) return <span className="text-neutral-600">—</span>;
  return (
    <span className="flex gap-0.5">
      {form.map((r, i) => (
        <span key={i} className={`flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold text-white ${CHIP[r]}`}>
          {r}
        </span>
      ))}
    </span>
  );
}

function Stats({ s }: { s: Summary | null }) {
  if (!s) return <td className="px-2 py-2 text-center text-neutral-700">—</td>;
  return (
    <td className="px-2 py-2 text-center text-neutral-300">
      {num1(s.gfPerGame)}–{num1(s.gaPerGame)}
    </td>
  );
}

// Every game confirmed live or at half time right now, worldwide. `stats` has
// the last-5-game numbers of the ones whose two teams we recognise in a league
// we cover; the rest just show the score, with no columns to fill.
export default function LiveBoardTable({ games, stats, form }: { games: LiveGame[]; stats: Record<string, BoardStats>; form: Record<string, { home: ("V" | "E" | "D")[]; away: ("V" | "E" | "D")[] }> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
      <table className="w-full min-w-[62rem] text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <th className="px-3 py-2 font-semibold">Minuto</th>
            <th className="px-3 py-2 font-semibold">Liga</th>
            <th className="px-3 py-2 font-semibold">Jogo</th>
            <th className="px-3 py-2 text-center font-semibold">Resultado</th>
            <th className="px-2 py-2 text-center font-semibold" title="Golos marcados e sofridos por jogo, últimos 5">
              GM–GS casa
            </th>
            <th className="px-2 py-2 text-center font-semibold" title="Golos marcados e sofridos por jogo, últimos 5">
              GM–GS fora
            </th>
            <th className="px-2 py-2 font-semibold">Forma casa</th>
            <th className="px-2 py-2 font-semibold">Forma fora</th>
            <th className="px-3 py-2 font-semibold"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/70">
          {games.map((g) => {
            const s = stats[g.slug];
            const f = form[g.slug];
            const href = `/estatisticas/live?${new URLSearchParams({ link: `https://sportscore.com/football/match/${g.slug}/` })}`;
            return (
              <tr key={g.slug}>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {g.state.phase === "halftime" ? (
                    <span className="font-semibold text-amber-400">Intervalo</span>
                  ) : (
                    <span className="flex items-center gap-1.5 font-semibold text-red-400">
                      <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                      {g.state.minute ?? "?"}&apos;
                    </span>
                  )}
                </td>
                <td className="max-w-[9rem] truncate px-3 py-2.5 text-xs text-neutral-400" title={s?.leagueLabel ?? g.competition}>
                  {s?.leagueLabel ?? g.competition}
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-neutral-100">{g.home}</span> <span className="text-neutral-600">vs</span>{" "}
                  <span className="text-neutral-100">{g.away}</span>
                </td>
                <td className="px-3 py-2.5 text-center font-semibold text-neutral-100">
                  {g.state.homeGoals ?? "?"}–{g.state.awayGoals ?? "?"}
                </td>
                <Stats s={s?.home ?? null} />
                <Stats s={s?.away ?? null} />
                <td className="px-2 py-2.5">{f ? <Form form={f.home} /> : <span className="text-neutral-700">—</span>}</td>
                <td className="px-2 py-2.5">{f ? <Form form={f.away} /> : <span className="text-neutral-700">—</span>}</td>
                <td className="px-3 py-2.5 text-right">
                  <Link href={href} className="text-xs font-medium text-amber-400 hover:underline">
                    Analisar →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
