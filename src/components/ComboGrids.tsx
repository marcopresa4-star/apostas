"use client";

import { useMemo } from "react";
import {
  COMBO_LINES,
  COMBO_ROWS_1X2,
  COMBO_ROWS_DC,
  comboTable,
  type ComboTable,
} from "@/lib/comboGrids";
import type { PlayedMatch } from "@/lib/footballModel";

const pct1 = (p: number): string => `${(p * 100).toFixed(1).replace(".", ",")}%`;

function ppText(pp: number): { text: string; cls: string } {
  if (Math.abs(pp) < 0.05) return { text: "±0,0pp", cls: "text-neutral-500" };
  const arrow = pp > 0 ? "↑" : "↓";
  const sign = pp > 0 ? "+" : "−";
  return {
    text: `${arrow} ${sign}${Math.abs(pp).toFixed(1).replace(".", ",")}pp`,
    cls: pp > 0 ? "text-emerald-400" : "text-red-400",
  };
}

function Grid({ title, table, lines }: { title: string; table: ComboTable; lines: number[] }) {
  return (
    <div className="mb-5 last:mb-0">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
      <div className="overflow-hidden rounded-xl border border-neutral-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800">
              <th className="w-36 px-4 py-2 text-left font-normal" />
              {lines.map((line) => (
                <th key={line} className="px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Mais de {String(line).replace(".", ",")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.key} className="border-b border-neutral-800/60 last:border-0">
                <td className="px-4 py-2.5 text-neutral-200">{r.label}</td>
                {r.cells.map((c, i) => {
                  const pp = ppText(c.pp);
                  return (
                    <td key={i} className="px-4 py-2.5 text-center">
                      <p className="font-semibold tabular-nums text-neutral-100">{pct1(c.p)}</p>
                      <p className={`text-[11px] tabular-nums ${pp.cls}`}>{pp.text}</p>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Result × goals combination grids for one analysed game: model chance per
// cell with the pp delta vs the league average over the same games.
export default function ComboGrids({
  lambdaHome,
  lambdaAway,
  matches,
}: {
  lambdaHome: number;
  lambdaAway: number;
  matches: PlayedMatch[];
}) {
  const t1 = useMemo(
    () => comboTable(lambdaHome, lambdaAway, COMBO_ROWS_1X2, COMBO_LINES, matches),
    [lambdaHome, lambdaAway, matches]
  );
  const t2 = useMemo(
    () => comboTable(lambdaHome, lambdaAway, COMBO_ROWS_DC, COMBO_LINES, matches),
    [lambdaHome, lambdaAway, matches]
  );
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-neutral-300">Combinação</h3>
      <Grid title="Vencedor & mais golos" table={t1} lines={COMBO_LINES} />
      <Grid title="Dupla hipótese & mais golos" table={t2} lines={COMBO_LINES} />
    </div>
  );
}
