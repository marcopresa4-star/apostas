"use client";

import { useState } from "react";
import { formatOdd } from "@/lib/multiples";

export interface OddMarket {
  group: string;
  label: string;
  p: number;
}

// Type the odd a bookmaker offers for one of the markets and see how it
// compares with the model: the chance the odd implies against the model's, and
// how much a bet at that odd would win or lose on average.
export default function OddChecker({ markets }: { markets: OddMarket[] }) {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");

  const market = markets[index];
  const odd = Number(text.replace(",", "."));
  const valid = Number.isFinite(odd) && odd > 1;
  // Average result of a 1 unit bet: win (odd - 1) with chance p, lose 1 otherwise.
  const value = valid ? market.p * odd - 1 : null;

  const groups = [...new Set(markets.map((m) => m.group))];
  const percent = (p: number) => `${(p * 100).toFixed(1).replace(".", ",")}%`;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-300">Comparar com a odd da casa</h3>
      <p className="mb-3 text-xs text-neutral-500">
        Escolhe o mercado e escreve a odd que a casa de apostas oferece.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <select
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-amber-500"
        >
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {markets.map((m, i) =>
                m.group === group ? (
                  <option key={i} value={i}>
                    {m.label}
                  </option>
                ) : null
              )}
            </optgroup>
          ))}
        </select>
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex: 1.85"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-amber-500"
        />
      </div>

      <div className="mt-3 text-sm text-neutral-300">
        <p>
          Modelo: <span className="font-medium text-neutral-100">{percent(market.p)}</span>{" "}
          · odd justa{" "}
          <span className="font-medium text-neutral-100">{formatOdd(1 / market.p)}</span>
        </p>
        {valid && value !== null && (
          <>
            <p className="mt-1">
              A odd {formatOdd(odd)} implica{" "}
              <span className="font-medium text-neutral-100">{percent(1 / odd)}</span>.
            </p>
            <p
              className={`mt-1 font-medium ${value >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {value >= 0
                ? `Segundo o modelo compensa: +${percent(value)} em média por unidade apostada.`
                : `Segundo o modelo não compensa: ${percent(value)} em média por unidade apostada.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
