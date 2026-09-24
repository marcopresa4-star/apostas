import Link from "next/link";
import { formatOdd } from "@/lib/multiples";
import type { Fixture, PlayedMatch, Prediction } from "@/lib/footballModel";
import { pickWhy, type Pick } from "@/lib/recommendation";

export interface RoundRow {
  fixture: Fixture;
  // "upcoming": predicted; "played": has its score; "missing": the date has
  // passed but the data has no result yet.
  status: "upcoming" | "played" | "missing";
  prediction: Prediction | null;
  pick: Pick | null;
  // A team with few games in the data: the estimate is shaky.
  fragile: boolean;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const dot = (n: number) => n.toFixed(1).replace(".", ",");
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

// The games of one round with what the model thinks of each: who wins, expected
// goals, over 2.5, both teams to score, and the bet it would suggest.
export default function RoundTable({
  rows,
  liga,
  fonte,
  matches,
}: {
  rows: RoundRow[];
  liga: string;
  fonte?: string;
  matches?: PlayedMatch[];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <th className="px-3 py-2 font-semibold">Jogo</th>
            <th className="px-3 py-2 font-semibold">Casa · Empate · Fora</th>
            <th className="px-3 py-2 text-right font-semibold">Golos</th>
            <th className="px-3 py-2 text-right font-semibold">+2,5</th>
            <th className="px-3 py-2 text-right font-semibold">Ambas</th>
            <th className="px-3 py-2 font-semibold">Aposta sugerida</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/70">
          {rows.map(({ fixture: f, status, prediction: p, pick, fragile }, i) => (
            <tr key={`${f.date}-${f.team1}-${f.team2}-${i}`} className="align-top">
              <td className="px-3 py-2.5">
                <p className="text-[11px] text-neutral-500">
                  {dayMonth(f.date)}
                  {f.time ? ` · ${f.time}` : ""}
                </p>
                <Link
                  href={`/estatisticas?${new URLSearchParams({ liga, casa: f.team1, fora: f.team2, ...(fonte === "sofa" ? { fonte: "sofa" } : {}) })}`}
                  className="font-medium text-neutral-100 hover:text-amber-300 hover:underline"
                  title="Abrir a comparação destas equipas"
                >
                  {f.team1} <span className="text-neutral-500">vs</span> {f.team2}
                </Link>
              </td>

              {status === "played" && f.ft && (
                <td colSpan={5} className="px-3 py-2.5 text-neutral-400">
                  Jogado: <span className="font-semibold text-neutral-200">{f.ft[0]}–{f.ft[1]}</span>
                </td>
              )}
              {status === "missing" && (
                <td colSpan={5} className="px-3 py-2.5 text-xs text-amber-400">
                  Já foi jogado, mas o resultado ainda não está nos dados.
                </td>
              )}

              {status === "upcoming" && p && (
                <>
                  <td className="px-3 py-2.5">
                    <div className="flex h-2 w-40 overflow-hidden rounded-full bg-neutral-800">
                      <div className="bg-emerald-500" style={{ width: `${p.fullTime.home * 100}%` }} />
                      <div className="bg-neutral-500" style={{ width: `${p.fullTime.draw * 100}%` }} />
                      <div className="bg-sky-500" style={{ width: `${p.fullTime.away * 100}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-neutral-300">
                      <span className="text-emerald-400">{pct(p.fullTime.home)}</span> ·{" "}
                      <span className="text-neutral-400">{pct(p.fullTime.draw)}</span> ·{" "}
                      <span className="text-sky-400">{pct(p.fullTime.away)}</span>
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-neutral-300">
                    {dot(p.lambdaHome)} – {dot(p.lambdaAway)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-neutral-300">{pct(p.over["2.5"])}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-neutral-300">{pct(p.bothScore)}</td>
                  <td className="px-3 py-2.5">
                    {pick ? (
                      <>
                        <p className="text-xs font-medium text-neutral-100">
                          {pick.label}
                          {fragile && (
                            <span
                              title="Uma das equipas tem poucos jogos nos dados: o modelo ainda não ganha à média da liga"
                              className="ml-1.5 rounded bg-amber-950 px-1 text-[10px] font-semibold text-amber-300"
                            >
                              frágil
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-neutral-500">
                          {pct(pick.p)} · <span className="text-emerald-400">compensa a partir de {formatOdd(pick.minOdd)}</span>
                        </p>
                        {matches && p && (
                          <p className="mt-0.5 max-w-64 text-[10px] leading-snug text-neutral-600">
                            Porquê: {pickWhy(pick, { matches, home: f.team1, away: f.team2, prediction: p })}
                          </p>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-neutral-600">—</span>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
