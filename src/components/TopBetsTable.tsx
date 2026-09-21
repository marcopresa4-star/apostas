import Link from "next/link";
import { formatOdd } from "@/lib/multiples";
import { roundLabel } from "@/lib/rounds";
import type { TopBet } from "@/lib/topBets";

const pct = (p: number) => `${(p * 100).toFixed(1).replace(".", ",")}%`;
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

const GROUP = {
  result: { label: "Resultado", style: "bg-emerald-950 text-emerald-300" },
  goals: { label: "Golos", style: "bg-sky-950 text-sky-300" },
  btts: { label: "Ambas marcam", style: "bg-violet-950 text-violet-300" },
} as const;

// The most probable bets of the nearest rounds, one per game.
export default function TopBetsTable({ bets }: { bets: TopBet[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
      <table className="w-full min-w-[66rem] text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <th className="px-3 py-2 font-semibold">#</th>
            <th className="px-3 py-2 font-semibold">Jogo</th>
            <th className="px-3 py-2 font-semibold">Aposta</th>
            <th className="px-3 py-2 text-right font-semibold">Probabilidade</th>
            <th className="px-3 py-2 text-right font-semibold">Odd justa</th>
            <th className="px-3 py-2 text-right font-semibold">Compensa a partir de</th>
            <th className="px-3 py-2 font-semibold">Porquê</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/70">
          {bets.map((b, i) => {
            const f = b.fixture;
            const group = GROUP[b.group];
            return (
              <tr key={`${b.leagueCode}-${f.date}-${f.team1}`} className="align-top">
                <td className="px-3 py-2.5 font-semibold text-neutral-500">{i + 1}</td>
                <td className="px-3 py-2.5">
                  <p className="text-[11px] text-neutral-500">
                    {b.leagueLabel} · {roundLabel(b.round)} · {dayMonth(f.date)}
                    {f.time ? ` · ${f.time}` : ""}
                  </p>
                  <Link
                    href={`/estatisticas?${new URLSearchParams({ liga: b.leagueCode, casa: f.team1, fora: f.team2 })}`}
                    className="font-medium text-neutral-100 hover:text-amber-300 hover:underline"
                    title="Abrir a comparação destas equipas"
                  >
                    {f.team1} <span className="text-neutral-500">vs</span> {f.team2}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <p className="font-medium text-neutral-100">{b.label}</p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${group.style}`}>
                    {group.label}
                  </span>
                  {b.fragile && (
                    <span
                      title={`Uma das equipas só tem ${b.minGames} jogos nos dados: abaixo de 12 o modelo ainda não ganha à média da liga`}
                      className="ml-1 mt-1 inline-block rounded-full bg-amber-950 px-2 py-0.5 text-[10px] font-semibold text-amber-300"
                    >
                      frágil
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <p className="font-semibold text-amber-300">{pct(b.p)}</p>
                  <p className="text-[11px] text-neutral-500">liga: {pct(b.base)}</p>
                  {b.p < b.base && (
                    <p
                      className="text-[10px] font-medium text-red-400"
                      title="O modelo acha esta aposta menos provável do que costuma ser nesta liga"
                    >
                      abaixo da média da liga
                    </p>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right text-neutral-300">{formatOdd(b.fairOdd)}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-emerald-400">{formatOdd(b.minOdd)}</td>
                <td className="w-[26rem] px-3 py-2.5">
                  <ul className="list-disc space-y-1 pl-4 text-[11px] leading-snug text-neutral-400 marker:text-neutral-600">
                    {b.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
