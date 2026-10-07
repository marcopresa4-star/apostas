"use client";

import type { EloPoint } from "@/lib/elo";
import CurveChart from "./CurveChart";

// Elo rating curves of the two sides (last games each): rising means the
// team has been beating expectations, falling the opposite. Every dot is one
// game — hover it for date, opponent, score and the rating change.
export default function EloChart({
  home,
  away,
  homeCurve,
  awayCurve,
}: {
  home: string;
  away: string;
  homeCurve: EloPoint[];
  awayCurve: EloPoint[];
}) {
  const n = Math.max(homeCurve.length, awayCurve.length);
  if (n < 2) return null;
  const tip = (p: EloPoint) => {
    const result = p.gf > p.ga ? "V" : p.gf < p.ga ? "D" : "E";
    return (
      <>
        <p className="text-neutral-400">
          vs {p.opponent} ({p.atHome ? "C" : "F"})
        </p>
        <p className="text-neutral-200">
          {result} {p.gf}–{p.ga} ·{" "}
          <span className={p.delta >= 0 ? "text-emerald-400" : "text-red-400"}>
            {p.delta >= 0 ? "+" : ""}
            {p.delta}
          </span>{" "}
          → {p.elo}
        </p>
      </>
    );
  };
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-300">Elo das equipas (últimos {n} jogos)</h3>
      <CurveChart
        aria={`Elo de ${home} e ${away}`}
        yFormat="int"
        refValue={1500}
        refLabel="base"
        minSpan={24}
        series={[
          {
            name: home,
            color: "#34d399",
            soft: "#064e3b",
            points: homeCurve.map((p) => ({ value: p.elo, date: p.date, tip: tip(p) })),
          },
          {
            name: away,
            color: "#38bdf8",
            soft: "#0c4a6e",
            points: awayCurve.map((p) => ({ value: p.elo, date: p.date, tip: tip(p) })),
          },
        ]}
      />
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
        A subir é a ganhar a expectativas, a descer o contrário. Parte de 1500 para todas, conta só jogos desta liga.
        Passa o rato por cada ponto para ver o jogo.
      </p>
    </div>
  );
}
