"use client";

import { useState } from "react";
import { MAX_EXTRAS, cleanText, decodeExtra, encodeExtra, type ExtraGame } from "@/lib/extraGames";

interface Row {
  id: number;
  date: string;
  competition: string;
  opponent: string;
  home: "1" | "0";
  gf: string;
  ga: string;
}

let nextId = 1;
const emptyRow = (): Row => ({ id: nextId++, date: "", competition: "", opponent: "", home: "1", gf: "", ga: "" });

const toRow = (g: ExtraGame): Row => ({
  id: nextId++,
  date: g.date,
  competition: g.competition,
  opponent: g.opponent,
  home: g.home ? "1" : "0",
  gf: String(g.gf),
  ga: String(g.ga),
});

const INPUT =
  "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-amber-500";

// A team's games that the free data does not have (cups, Europe, friendlies).
// Each complete row travels in the form as one hidden field, so an unfinished
// row is simply left out.
export default function ExtraGames({ name, initial }: { name: string; initial: ExtraGame[] }) {
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));

  const update = (id: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const game = decodeExtra(
          [row.date, cleanText(row.competition), cleanText(row.opponent), row.home, row.gf, row.ga].join("|")
        );
        return (
          <div key={row.id} className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[8rem_1fr_1fr]">
              <input
                type="date"
                aria-label="Data"
                value={row.date}
                onChange={(e) => update(row.id, { date: e.target.value })}
                className={INPUT}
              />
              <input
                type="text"
                aria-label="Competição"
                placeholder="Competição (ex: Liga Europa)"
                value={row.competition}
                onChange={(e) => update(row.id, { competition: e.target.value })}
                className={INPUT}
              />
              <input
                type="text"
                aria-label="Adversário"
                placeholder="Adversário"
                value={row.opponent}
                onChange={(e) => update(row.id, { opponent: e.target.value })}
                className={`${INPUT} col-span-2 sm:col-span-1`}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                aria-label="Local"
                value={row.home}
                onChange={(e) => update(row.id, { home: e.target.value as "1" | "0" })}
                className={`${INPUT} w-24`}
              >
                <option value="1">Em casa</option>
                <option value="0">Fora</option>
              </select>
              <span className="text-[11px] text-neutral-500">Golos da equipa</span>
              <input
                type="number"
                aria-label="Golos da equipa"
                min="0"
                max="99"
                value={row.gf}
                onChange={(e) => update(row.id, { gf: e.target.value })}
                className={`${INPUT} w-14`}
              />
              <span className="text-[11px] text-neutral-500">do adversário</span>
              <input
                type="number"
                aria-label="Golos do adversário"
                min="0"
                max="99"
                value={row.ga}
                onChange={(e) => update(row.id, { ga: e.target.value })}
                className={`${INPUT} w-14`}
              />
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                className="ml-auto text-xs text-neutral-500 hover:text-red-400"
              >
                Remover
              </button>
            </div>
            {game && <input type="hidden" name={name} value={encodeExtra(game)} />}
            {!game && (row.date || row.opponent || row.gf || row.ga) && (
              <p className="mt-1 text-[11px] text-amber-400">
                Falta a data, o adversário ou o resultado: este jogo ainda não conta.
              </p>
            )}
          </div>
        );
      })}
      {rows.length < MAX_EXTRAS && (
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, emptyRow()])}
          className="text-xs font-medium text-amber-400 hover:underline"
        >
          + Adicionar jogo
        </button>
      )}
    </div>
  );
}
